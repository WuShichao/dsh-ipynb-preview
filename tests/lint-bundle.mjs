/**
 * Sweep the bundle for identifiers that are referenced but never declared.
 *
 * A blank page after a refresh means the plugin factory threw while
 * materializing; the module loader then has no exports for the row and the
 * whole client roster fails. A free variable is the classic cause, and it is
 * invisible to `node --check` because the reference is syntactically valid.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Paths come from this file's location, so the check runs from a fresh clone.
const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

const src = readFileSync(join(LIB, "client.template.js"), "utf8");

// Names the factory references as bare identifiers, filtered to the ones this
// plugin is likely to have introduced.
const interesting = [
  "zoomTranslation", "zoomScroll", "clamp", "imageViewer", "imageExtension",
  "notebookStem", "saveImage", "Figure", "ImageLightbox", "renderMath",
  "renderInline", "renderBlocks", "highlightCode", "highlightLine",
  "normalizeLanguage", "parseNotebook", "joinSource", "esc", "katex",
  "ZOOM_MIN", "ZOOM_MAX", "ZOOM_STEP",
];

console.log("=== declaration and reference counts ===");
let problems = 0;
for (const name of interesting) {
  const declared =
    new RegExp(`(?:function|const|let|var)\\s+${name}\\b`).test(src) ||
    new RegExp(`\\b${name}\\s*[,}]`).test(src.match(/exports\.__test__ = \{[\s\S]*?\}/)?.[0] || "");
  const refs = (src.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
  const declCount = (src.match(new RegExp(`(?:function|const|let|var)\\s+${name}\\b`, "g")) || []).length;
  if (declCount === 0 && refs > 0) {
    console.log(`  FREE  ${name.padEnd(20)} referenced ${refs}x, never declared`);
    problems += 1;
  } else if (declCount > 1) {
    console.log(`  DUP   ${name.padEnd(20)} declared ${declCount}x`);
    problems += 1;
  } else {
    console.log(`  ok    ${name.padEnd(20)} declared ${declCount}x, referenced ${refs}x`);
  }
}

console.log(`\nproblems: ${problems}`);

/* ---- stylesheet integrity, as the browser will parse it -------------- */

console.log("\n=== injected stylesheet ===");
const built = readFileSync(join(LIB, "client.js"), "utf8");
// Pull the CSS template literal back out of the built bundle.
const cssStart = built.indexOf("const CSS = `");
if (cssStart < 0) {
  console.log("FAIL: no CSS template found in the built bundle");
  process.exit(1);
}
const cssBody = built.slice(cssStart + "const CSS = `".length);
const cssEnd = cssBody.indexOf("`;");
if (cssEnd < 0) {
  console.log("FAIL: the CSS template literal is unterminated");
  process.exit(1);
}
const css = cssBody.slice(0, cssEnd);
console.log(`css bytes: ${Buffer.byteLength(css)}`);
let cssProblems = 0;
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
console.log(`braces: ${open} open / ${close} close`);
if (open !== close) { console.log("FAIL: unbalanced braces would corrupt every later rule"); cssProblems += 1; }

// A stray backtick or ${ would have broken the literal; catch a stray one now.
if (css.includes("${")) { console.log("FAIL: a template substitution survived into the CSS"); cssProblems += 1; }

// Every @font-face url must be a data URI, or the browser fetches nothing.
const urls = [...css.matchAll(/url\(([^)]{0,40})/g)].map((m) => m[1].replace(/["']/g, ""));
const bad = urls.filter((u) => !u.startsWith("data:"));
console.log(`url() references: ${urls.length}, non-data: ${bad.length}`);
if (bad.length) { console.log("FAIL: non-data url ->", bad.slice(0, 3).join(", ")); cssProblems += 1; }

// CSS custom properties in the token palette must each have a literal fallback,
// because a browser without light-dark() reads the first declaration.
const declLines = css.split("\n").filter((l) => /--tk-[a-z]+:/.test(l));
console.log(`token palette lines: ${declLines.length}`);
for (const line of declLines) {
  const literal = /#[0-9a-fA-F]{3,8}/.test(line);
  if (!literal) { console.log("FAIL: no literal fallback in", line.trim()); cssProblems += 1; }
}

// The lightbox classes must exist, since the component renders them.
for (const cls of [
  ".dshnb-lightbox", ".dshnb-lightbox-bar", ".dshnb-lightbox-stage",
  ".dshnb-lightbox-img", ".dshnb-zoom-group", ".dshnb-zoom-value",
  ".dshnb-lightbox-hint", ".dshnb-figure", ".dshnb-figure-actions",
]) {
  if (!css.includes(cls)) { console.log("FAIL: missing rule for", cls); cssProblems += 1; }
}
console.log(`css problems: ${cssProblems}`);

// The decisive test: evaluate the factory with a stub module table and see
// whether it throws. This is exactly what the shell does at materialization.
console.log("\n=== materialize the factory (what the shell does) ===");
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (r) => { captured = r; } } };
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: "" }),
  head: { appendChild() {} },
};
globalThis.__DSH_IPYNB_TEST__ = true;

try {
  new Function("window", "document", readFileSync(join(LIB, "client.js"), "utf8"))(globalThis.window, globalThis.document);
  console.log("bundle script executed (factory registered)");
} catch (error) {
  console.log("BUNDLE SCRIPT THREW:", error.message);
  process.exit(1);
}

const stubReact = { useState() {}, useEffect() {}, useRef() {}, useCallback() {}, createElement() {} };
try {
  const out = captured.factory((spec) => {
    if (spec === "react") return stubReact;
    if (spec === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
    throw new Error("unexpected require " + spec);
  });
  console.log("factory materialized without throwing");
  console.log("exports:", Object.keys(out).join(", "));
} catch (error) {
  console.log("FACTORY THREW:", error.constructor.name + ": " + error.message);
  console.log(error.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}
