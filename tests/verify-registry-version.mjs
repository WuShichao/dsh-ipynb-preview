/**
 * Verify a specific version fetched from the registry, by URL rather than by
 * dist-tag.
 *
 * A staged version's tarball is served even though the packument does not list
 * it -- or lists it while `latest` still points at an older release. That means
 * a version can be installable by exact pin while `npm install <pkg>` still gets
 * the old one, so the artifact has to be checked on its own.
 *
 * Usage: node verify-registry-version.mjs <version>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
const req = createRequire(join(REPO, "package.json"));

const version = process.argv[2];
if (!version) {
  console.error("usage: node verify-registry-version.mjs <version>");
  process.exit(2);
}

const WORK = join(REPO, ".registry-check");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const url = `https://registry.npmjs.org/dsh-ipynb-preview/-/dsh-ipynb-preview-${version}.tgz`;
console.log(`=== fetching ${version} ===`);
const res = await fetch(url);
console.log(`  ${url}`);
console.log(`  HTTP ${res.status}`);
if (!res.ok) {
  console.log("\n  this version's tarball is not served by the registry");
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
writeFileSync(join(WORK, "p.tgz"), bytes);
console.log(`  ${(bytes.length / 1024).toFixed(1)} KB`);

execFileSync("tar", ["-xzf", join(WORK, "p.tgz"), "-C", WORK]);
const root = join(WORK, "package");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log(`  manifest says: ${manifest.name}@${manifest.version}`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) failures += 1;
};

const React = req("react");
const jsxRuntime = req("react/jsx-runtime");
const { renderToStaticMarkup } = req("react-dom/server");

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (r) => { captured = r; } } };
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  head: { appendChild() {} }, addEventListener() {}, removeEventListener() {},
};
globalThis.__DSH_IPYNB_TEST__ = true;
new Function("window", "document", readFileSync(join(root, "lib", "client.js"), "utf8"))(
  globalThis.window, globalThis.document
);
const t = captured.factory((spec) => {
  const table = { react: React, "react/jsx-runtime": jsxRuntime };
  if (!(spec in table)) throw new Error("no module " + spec);
  return table[spec];
}).__test__;

const md = (src) =>
  renderToStaticMarkup(React.createElement("div", null, ...t.renderBlocks(src, true)));
const cells = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;

console.log("\n=== does this registry artifact have the table work? ===");
check("a table becomes a table",
  md("| a | b |\n|---|---|\n| 1 | 2 |").includes('<table class="dshnb-table">'));
check("alignment works",
  /textAlign:"right"|text-align:\s*right/.test(md("| a | b |\n| --- | ---: |\n| 1 | 2 |")));
check("a pipe in a code span stays in one cell",
  cells(md("| a | b |\n|---|---|\n| `x | y` | z |"), "td") === 2);
check("a list inside a blockquote stays a list",
  cells(md("> **S**\n>\n> - a\n> - b"), "li") === 2);
check("task items render checkboxes",
  (md("- [ ] a\n- [x] b").match(/type="checkbox"/g) || []).length === 2);
check("table styling shipped", /\.dshnb-md table\.dshnb-table\s*\{/.test(t.css));

rmSync(WORK, { recursive: true, force: true });
console.log(failures === 0
  ? `\nREGISTRY ARTIFACT ${version} HAS THE TABLE WORK`
  : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
