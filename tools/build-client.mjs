/**
 * Build lib/client.js from lib/client.template.js.
 *
 * The plugin vendors KaTeX, and its compiled engine plus a stylesheet with
 * inlined fonts is far too large to keep in a hand-edited file. The template
 * holds the readable source with two placeholders:
 *
 *   __KATEX_JS__    the compiled engine, executed inside the factory
 *   __KATEX_CSS__   the stylesheet, each woff2 font inlined as a data URI
 *
 * KaTeX's `.woff` and `.ttf` fallbacks are dropped: every engine able to run
 * this GUI supports woff2, and keeping them would roughly quadruple the payload.
 *
 * Usage:
 *   node tools/build-client.mjs [path-to-katex-dist]
 *
 * With no argument the KaTeX dist directory is resolved from this repository's
 * own dependencies, so a fresh clone builds with `npm install && npm run build`.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, "..");
const templatePath = join(pluginDir, "lib", "client.template.js");
const outputPath = join(pluginDir, "lib", "client.js");

/**
 * Find KaTeX's `dist` directory.
 *
 * @param explicit - a path from the command line, used verbatim.
 * @returns the dist directory, or null when it cannot be located.
 */
function resolveKatexDist(explicit) {
  if (explicit) return explicit;
  // Resolve the package manifest rather than guessing a path: that works
  // through npm's layout and through pnpm's symlinked store alike.
  try {
    const req = createRequire(join(pluginDir, "package.json"));
    return join(dirname(req.resolve("katex/package.json")), "dist");
  } catch {
    return null;
  }
}

const katexDist = resolveKatexDist(process.argv[2]);
if (!katexDist) {
  console.error(
    "cannot find KaTeX.\n" +
      `  run \`npm install\` in ${pluginDir}, or pass a dist path:\n` +
      "  node tools/build-client.mjs <path-to-katex-dist>"
  );
  process.exit(2);
}

const enginePath = join(katexDist, "katex.min.js");
const cssPath = join(katexDist, "katex.min.css");
const fontsDir = join(katexDist, "fonts");
for (const required of [enginePath, cssPath, fontsDir]) {
  if (!existsSync(required)) {
    console.error(`missing KaTeX asset: ${required}`);
    process.exit(1);
  }
}

/** Escape text for embedding inside a template literal in the output. */
const forTemplateLiteral = (text) =>
  text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

/** Escape text for embedding inside a single-quoted source literal. */
const forSourceLiteral = (text) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/* ---- stylesheet ------------------------------------------------------ */

const available = new Set(readdirSync(fontsDir));
let css = readFileSync(cssPath, "utf8");
let inlined = 0;
let dropped = 0;

for (const raw of new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]))) {
  const bare = raw.replace(/^["']|["']$/g, "");
  const file = bare.replace(/^fonts\//, "");
  const dropSource = () => {
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    css = css.replace(
      new RegExp(`,\\s*url\\(["']?${escaped}["']?\\)\\s*format\\(["'][^"']+["']\\)`, "g"),
      ""
    );
    dropped += 1;
  };
  if (!available.has(file) || !file.endsWith(".woff2")) {
    dropSource();
    continue;
  }
  const base64 = readFileSync(join(fontsDir, file)).toString("base64");
  css = css.split(bare).join(`data:font/woff2;base64,${base64}`);
  inlined += 1;
}
css = css.replace(/,\s*\)/g, ")");

if (/url\((?!["']?data:)/.test(css)) {
  console.error("FAIL: a non-data font URL survived; the bundle would not be self-contained");
  process.exit(1);
}

/* ---- assemble -------------------------------------------------------- */

const engine = readFileSync(enginePath, "utf8");
let output = readFileSync(templatePath, "utf8");

for (const placeholder of ["__KATEX_SOURCE__", "__KATEX_CSS__"]) {
  if (!output.includes(placeholder)) {
    console.error(`FAIL: template has no ${placeholder} placeholder`);
    process.exit(1);
  }
}

// The engine becomes a string literal argument to `new Function`, so its own
// `module.exports` assignment lands on a throwaway record and cannot overwrite
// this plugin's exports.
output = output.replace("__KATEX_SOURCE__", `'${forSourceLiteral(engine)}'`);
output = output.replace("__KATEX_CSS__", forTemplateLiteral(css));

writeFileSync(outputPath, output, "utf8");

const katexVersion = JSON.parse(
  readFileSync(join(katexDist, "..", "package.json"), "utf8")
).version;

console.log(`katex ${katexVersion}`);
console.log(`inlined woff2 fonts: ${inlined}, dropped sources: ${dropped}`);
console.log(`stylesheet bytes: ${Buffer.byteLength(css)}`);
console.log(`engine bytes: ${Buffer.byteLength(engine)}`);
console.log(`wrote ${outputPath} (${Buffer.byteLength(output)} bytes)`);
