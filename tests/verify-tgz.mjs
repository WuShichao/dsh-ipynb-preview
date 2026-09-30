/**
 * Verify a packed .tgz the way a user receives it.
 *
 * Unpacking a tarball only proves the bytes are there. This installs it into a
 * throwaway directory with pnpm -- the same tool `dsh plugin add` uses -- and
 * then loads the bundle out of the installed location, so the package manifest,
 * the exports map and the artifact are all exercised.
 *
 * Usage: node verify-tgz.mjs <path-to.tgz>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
const req = createRequire(join(REPO, "package.json"));

const tgz = process.argv[2];
if (!tgz) {
  console.error("usage: node verify-tgz.mjs <path-to.tgz>");
  process.exit(2);
}
const tgzAbs = resolve(tgz);
if (!existsSync(tgzAbs)) {
  console.error(`not found: ${tgzAbs}`);
  process.exit(2);
}

const WORK = join(REPO, ".tgz-check");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
writeFileSync(
  join(WORK, "package.json"),
  JSON.stringify({ name: "tgz-check", private: true }, null, 2) + "\n",
  "utf8"
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) failures += 1;
};

// React is a dev dependency of this repo and is supplied by the host at runtime,
// so it is deliberately absent from the package. It is passed in below.
const React = req("react");
const jsxRuntime = req("react/jsx-runtime");
const { renderToStaticMarkup } = req("react-dom/server");

console.log(`=== installing ${tgzAbs.split(/[\\/]/).pop()} with pnpm ===`);
// The bundle is prebuilt, so no build permission is needed: that is the whole
// point of shipping lib/client.js in the tarball.
execFileSync(
  process.execPath,
  [
    join(
      "C:/Users/nightwing/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs"
    ),
    "add",
    tgzAbs,
    "--dir",
    WORK,
    "--ignore-scripts",
    "--reporter=append-only",
  ],
  { stdio: "inherit" }
);

const installed = join(WORK, "node_modules", "dsh-ipynb-preview");
check("the package installed", existsSync(installed));
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
check("its name and version are right",
  manifest.name === "dsh-ipynb-preview" && /^0\.2\./.test(manifest.version),
  `${manifest.name}@${manifest.version}`);
check("it declares the bundle patch",
  manifest.dsh?.bundle?.patch === "./cordis.patch.yml");
check("the patch file shipped", existsSync(join(installed, "cordis.patch.yml")));
check("the client artifact shipped", existsSync(join(installed, "lib", "client.js")));
check("the readable template shipped",
  existsSync(join(installed, "lib", "client.template.js")));

// Resolve through the exports map, exactly as the shell resolves ./client.
const reqInstalled = createRequire(join(WORK, "package.json"));
let clientEntry = null;
try {
  clientEntry = reqInstalled.resolve("dsh-ipynb-preview/client");
} catch (error) {
  console.log(`      resolve failed: ${error.message}`);
}
check("the ./client export resolves from the installed package",
  Boolean(clientEntry) && clientEntry.includes("client.js"), clientEntry || "unresolved");

console.log("\n=== loading the installed bundle ===");
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (r) => { captured = r; } } };
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  head: { appendChild() {} }, addEventListener() {}, removeEventListener() {},
};
globalThis.__DSH_IPYNB_TEST__ = true;
const source = readFileSync(join(installed, "lib", "client.js"), "utf8");
new Function("window", "document", source)(globalThis.window, globalThis.document);
check("the installed bundle registers a factory", Boolean(captured));
check("under the package name", captured?.id === "dsh-ipynb-preview", captured?.id);

const exports = captured.factory((spec) => {
  const table = { react: React, "react/jsx-runtime": jsxRuntime };
  if (!(spec in table)) throw new Error("module table has no " + spec);
  return table[spec];
});
check("the factory materializes", typeof exports.apply === "function");

console.log("\n=== the installed bundle renders tables ===");
const t = exports.__test__;
const md = (src) =>
  renderToStaticMarkup(React.createElement("div", null, ...t.renderBlocks(src, true)));
const cells = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;

const table = md("| dimension | value |\n|---|---|\n| mass1 | 2.876e-4 |\n| mass2 | 2.391e-4 |");
check("a table becomes a table", table.includes('<table class="dshnb-table">'));
check("three rows", (table.match(/<tr[\s>]/g) || []).length === 3);
check("two header cells", cells(table, "th") === 2);
check("four body cells", cells(table, "td") === 4);
check("alignment survives",
  /textAlign:"right"|text-align:\s*right/.test(md("| a | b |\n| --- | ---: |\n| 1 | 2 |")));
check("a pipe in a code span does not split the cell",
  cells(md("| a | b |\n|---|---|\n| `x | y` | z |"), "td") === 2);
check("prose with a pipe is not a table",
  !md("A sentence with a | pipe.").includes("<table"));
check("a list inside a blockquote stays a list",
  cells(md("> **S**\n>\n> - a\n> - b"), "li") === 2);
check("task items render checkboxes",
  (md("- [ ] a\n- [x] b").match(/type="checkbox"/g) || []).length === 2);
check("table styling shipped", /\.dshnb-md table\.dshnb-table\s*\{/.test(t.css));

rmSync(WORK, { recursive: true, force: true });
console.log(failures === 0 ? "\nTARBALL OK" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
