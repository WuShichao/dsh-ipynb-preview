/**
 * Verify the published tarball's table support.
 *
 * The version check in scripts/check-published.mjs is skipped here on purpose:
 * publishing bumps the registry to 0.2.0 while package.json still says 0.1.0
 * until that bump is committed. The artifact is what matters, so this reads the
 * tarball for the version under test directly.
 *
 * Usage: node verify-published-tables.mjs <version>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const req = createRequire(join(REPO, "package.json"));
const version = process.argv[2] || "0.2.0";

const WORK = join(REPO, ".published-check");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const url = `https://registry.npmjs.org/dsh-ipynb-preview/-/dsh-ipynb-preview-${version}.tgz`;
console.log(`=== fetching dsh-ipynb-preview@${version} ===`);
const res = await fetch(url);
if (!res.ok) throw new Error(`registry returned ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
const tgz = join(WORK, "p.tgz");
writeFileSync(tgz, bytes);
console.log(`  ${(bytes.length / 1024).toFixed(1)} KB`);

execFileSync("tar", ["-xzf", tgz, "-C", WORK], { stdio: "inherit" });
const root = join(WORK, "package");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log(`  package.json version: ${pkg.version}`);

// React comes from the repository's dev dependencies; the plugin never declares it.
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
const source = readFileSync(join(root, "lib", "client.js"), "utf8");
new Function("window", "document", source)(globalThis.window, globalThis.document);

const t = captured.factory((spec) => {
  const table = { react: React, "react/jsx-runtime": jsxRuntime };
  if (!(spec in table)) throw new Error("no module " + spec);
  return table[spec];
}).__test__;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) failures += 1;
};
const md = (src) => renderToStaticMarkup(React.createElement("div", null, ...t.renderBlocks(src, true)));
const cells = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;

console.log("\n=== the published bundle renders tables ===");
const table = md("| dimension | value |\n|---|---|\n| mass1 | 2.876e-4 |\n| mass2 | 2.391e-4 |");
check("a table is a table", table.includes('<table class="dshnb-table">'));
check("three rows: one header, two body", (table.match(/<tr[\s>]/g) || []).length === 3);
check("header cells", cells(table, "th") === 2);
check("body cells", cells(table, "td") === 4);
check("alignment markers still work",
  /textAlign:"right"|text-align:\s*right/.test(md("| a | b |\n| --- | ---: |\n| 1 | 2 |")));
check("a pipe in a code span does not split the cell",
  cells(md("| a | b |\n|---|---|\n| `x | y` | z |"), "td") === 2);
check("a paragraph with a pipe stays a paragraph",
  !md("A sentence with a | pipe.").includes("<table"));

console.log("\n=== the published bundle renders the other two fixes ===");
const nested = md("> **S**\n>\n> - first\n> - second");
check("a list inside a blockquote stays a list",
  nested.includes("<blockquote>") && cells(nested, "li") === 2, nested.slice(0, 100));
const tasks = md("- [ ] unchecked\n- [x] checked");
check("task items render checkboxes", (tasks.match(/type="checkbox"/g) || []).length === 2);
check("the marker is not printed as text", !tasks.includes("[ ]"));

console.log("\n=== table styling shipped ===");
check("the stylesheet styles a table",
  /\.dshnb-md table\.dshnb-table\s*\{/.test(t.css) && /border-collapse/.test(t.css));
check("it scrolls rather than stretching the pane",
  /\.dshnb-md table\.dshnb-table\s*\{[^}]*overflow-x:\s*auto/.test(t.css));

rmSync(WORK, { recursive: true, force: true });
console.log(failures === 0 ? "\nPUBLISHED 0.2.0 OK" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
