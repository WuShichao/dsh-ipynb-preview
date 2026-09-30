/**
 * Load the client bundle straight out of the published tarball.
 *
 * The local suites verify the repository. This verifies what a user actually
 * downloads: unpack the registry tarball, materialize its bundle the way the
 * shell's module loader does, and confirm the plugin registers and renders.
 *
 * Run from the repository root, which supplies React.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const WORK = join(REPO, ".packed-check");
const req = createRequire(join(REPO, "package.json"));

const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const url = `https://registry.npmjs.org/dsh-ipynb-preview/-/dsh-ipynb-preview-${version}.tgz`;
const tgz = join(WORK, "published.tgz");

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

console.log(`=== fetching ${url} ===`);
const res = await fetch(url);
if (!res.ok) throw new Error(`registry returned ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
const { writeFileSync } = await import("node:fs");
writeFileSync(tgz, bytes);
console.log(`  ${(bytes.length / 1024).toFixed(1)} KB`);

console.log("\n=== unpacking ===");
try {
  execFileSync("tar", ["-xzf", tgz, "-C", WORK], { stdio: "inherit" });
} catch (error) {
  throw new Error(`tar failed: ${error.message}`);
}
const root = join(WORK, "package");
if (!existsSync(join(root, "lib", "client.js"))) throw new Error("no lib/client.js in the tarball");
console.log("  unpacked package/");

const React = req("react");
const jsxRuntime = req("react/jsx-runtime");
const { renderToStaticMarkup } = req("react-dom/server");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) failures += 1;
};

console.log("\n=== materialize the published bundle ===");
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (r) => { captured = r; } } };
globalThis.document = globalThis.document || {
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
  head: { appendChild() {} }, addEventListener() {}, removeEventListener() {},
};
globalThis.__DSH_IPYNB_TEST__ = true;

const source = readFileSync(join(root, "lib", "client.js"), "utf8");
new Function("window", "document", source)(globalThis.window, globalThis.document);
check("the published bundle registers a factory", Boolean(captured));
check("its id is the package name", captured?.id === "dsh-ipynb-preview", captured?.id);

const exports = captured.factory((spec) => {
  const table = { react: React, "react/jsx-runtime": jsxRuntime };
  if (!(spec in table)) throw new Error(`module table has no ${spec}`);
  return table[spec];
});
check("the factory materializes without throwing", Boolean(exports));
check("it exports apply and inject",
  typeof exports.apply === "function" && Array.isArray(exports.inject),
  `apply=${typeof exports.apply} inject=${JSON.stringify(exports.inject)}`);

console.log("\n=== the published bundle registers the preview ===");
let definition = null;
let body = null;
exports.apply({
  effect: (fn) => fn(),
  documentPreviews: { register: (d) => { definition = d; return () => {}; } },
  slots: { register: (spec, component) => { body = { spec, component }; return () => {}; } },
});
check("registers an .ipynb document preview", definition?.extensions?.includes("ipynb"));
check("with bytes-complete loading", definition?.loading === "bytes-complete");
check("and a body component", Boolean(body?.component));

console.log("\n=== render the fixture through the published bundle ===");
const t = exports.__test__;
const fixture = readFileSync(join(REPO, "tests", "fixtures", "sample-notebook.ipynb"), "utf8");
const warnings = [];
const realError = console.error;
console.error = (...a) => warnings.push(a.map(String).join(" "));
const html = renderToStaticMarkup(
  React.createElement(t.NotebookBody, {
    content: { kind: "bytes", data: new Uint8Array(Buffer.from(fixture, "utf8")) },
    wrap: true,
    resourceAddress: "dsh-resource://file/session/s/tests/fixtures/sample-notebook.ipynb",
  })
);
console.error = realError;

check("no React warnings", warnings.length === 0, warnings.slice(0, 1).join(" "));
check("code is highlighted", (html.match(/class="tok-/g) || []).length > 50);
check("math rendered", html.includes('class="katex"'));
check("figures inlined", html.includes("data:image/png;base64,"));
check("KaTeX fonts embedded, so no network at render time",
  html.includes("katex") && source.includes("data:font/woff2;base64,"));
check("the stylesheet is self-contained",
  !/url\((?!["']?data:)/.test(t.css));

rmSync(WORK, { recursive: true, force: true });
console.log(failures === 0 ? "\nPUBLISHED PACKAGE OK" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
