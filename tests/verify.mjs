/**
 * Verification for dsh-ipynb-preview.
 *
 * Loads the bundle exactly as the shell's module loader does, then checks the
 * manifest contract, the registrations, the syntax highlighter, the math
 * renderer, the Markdown subset, the image features, and a full render of the
 * fixture notebook.
 *
 * Run with `npm test`, which builds the client artifact first.
 */
import { readFileSync } from "node:fs";
import { MATH_EXPRESSIONS } from "./make-fixture.mjs";
import { MARKDOWN_CASES } from "./make-table-fixture.mjs";
import {
  BUNDLE, FIXTURE, PATCH, PACKAGE, createChecker, loadBundle, loadReact, readPackage,
} from "./harness.mjs";

const { React, jsxRuntime, renderToStaticMarkup } = loadReact();
const { exports, tests: t } = loadBundle({ react: React, jsxRuntime });
const pkg = readPackage();
const bundleSource = readFileSync(BUNDLE, "utf8");
const { check, finish } = createChecker();
/* ---- manifest contract ----------------------------------------------- */

// The shell discovers this package by resolving `<row name>/package.json` from
// the profile, then reads `dsh.client` from the manifest. The suite asserts the
// manifest half of that contract; the installed-layout half is covered by
// `dsh --profile <name> --dump-config` and is not reproducible in-repo.
console.log("=== manifest contract ===");
check("the package is a DSH bundle", Boolean(pkg.dsh?.bundle?.patch));
check("the bundle patch path is relative", String(pkg.dsh.bundle.patch).startsWith("./"));
check("dsh.client.platform === 'web'", pkg.dsh?.client?.platform === "web");
check("declares a client inject edge", Array.isArray(pkg.dsh?.client?.inject),
  JSON.stringify(pkg.dsh?.client?.inject));
check("the inject edges name the two host rows it registers into",
  (pkg.dsh?.client?.inject || []).includes("@deepseek-ai/dsh-client-ui-sidebar-documentpreview") &&
    (pkg.dsh?.client?.inject || []).includes("@deepseek-ai/dsh-client-ui-sidebar-right"));
check("exports a ./client subpath", Boolean(pkg.exports?.["./client"]));
check("exports the patch, for the profile layer to read", Boolean(pkg.exports?.["./cordis.patch.yml"]));
check("the published files include the artifact and the patch",
  (pkg.files || []).includes("lib/client.js") && (pkg.files || []).includes("cordis.patch.yml"));
check("not marked private, or npm refuses to publish", pkg.private !== true);
check("declares a license", typeof pkg.license === "string" && pkg.license.length > 0);
check("a prepare script builds the artifact after install",
  typeof pkg.scripts?.prepare === "string" && pkg.scripts.prepare.includes("build"));

const patch = readFileSync(PATCH, "utf8");
const patchLines = patch.split("\n").filter((l) => !/^\s*#/.test(l) && l.trim() !== "");
check("bundle patch's first directive is an insert",
  /^-\s*insert:\s*$/.test(patchLines[0] || ""), JSON.stringify(patchLines[0] || ""));
check("the insert carries the row id and name",
  patchLines.some((l) => /^\s*-\s*id:\s*ipynb-preview\s*$/.test(l)) &&
    patchLines.some((l) => /^\s*name:\s*dsh-ipynb-preview\s*$/.test(l)));

/* ---- registrations --------------------------------------------------- */

console.log("\n=== registrations ===");
let definition = null;
let bodyReg = null;
exports.apply({
  effect: (fn) => fn(),
  documentPreviews: { register: (d) => { definition = d; return () => {}; } },
  slots: { register: (spec, component) => { bodyReg = { spec, component }; return () => {}; } },
});
check("definition id == bundle id", definition?.id === "dsh-ipynb-preview");
check("claims .ipynb", definition?.extensions?.includes("ipynb"));
check("extension band", definition?.priority === "extension");
check("publishes the wrap toggle", definition?.wrap === true);
check("bytes-complete loading", definition?.loading === "bytes-complete");
check("body key == definition id", bodyReg?.spec?.key === definition?.id);

const md = (source, wrap = false) => renderToStaticMarkup(
  React.createElement("div", null, ...t.renderBlocks(source, wrap))
);
const hl = (code, lang) => t.highlightCode(code, lang);

/* ---- markdown -------------------------------------------------------- */

console.log("\n=== markdown subset ===");
const mdHtml = md("# H1\n\n- a\n- b\n\n1. one\n\n> quote\n\n`code` and **bold** and *em*\n\n---\n");
check("headings", mdHtml.includes("<h1>H1</h1>"));
check("unordered list", /<ul><li>a<\/li><li>b<\/li><\/ul>/.test(mdHtml));
check("ordered list", /<ol><li>one<\/li><\/ol>/.test(mdHtml));
// A quoted line is a full block, so prose inside it is wrapped in a paragraph.
check("blockquote", mdHtml.includes("<blockquote><p>quote</p></blockquote>"));
check("inline code", mdHtml.includes("<code>code</code>"));
check("strong", mdHtml.includes("<strong>bold</strong>"));
check("emphasis", mdHtml.includes("<em>em</em>"));
check("thematic break", mdHtml.includes("<hr/>"));

// Bold must actually be styled, or it is invisible as an emphasis cue.
const strongRule = /\.dshnb-md strong\s*\{[^}]*\}/.exec(t.css)?.[0] || "";
check("strong declares a heavier weight",
  /font-weight:\s*(6|7|8|9)00/.test(strongRule), strongRule.trim());

// Identifiers with underscores must survive emphasis parsing.
check("underscore identifiers are not italicised",
  md("use log_10 and f_22 here").includes("log_10") &&
    !md("use log_10 here").includes("<em>"));

/* ---- tables ---------------------------------------------------------- */

// Tables were missing entirely until a real research notebook needed them: the
// whole table collapsed into one paragraph of pipe characters, which is what a
// reader reported as "the tables are mangled". The cases below are the fixture
// the suite renders, so the expectations and the input cannot drift apart.
console.log("\n=== markdown tables ===");
const cellCount = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
const rowCount = (html) => (html.match(/<tr[\s>]/g) || []).length;

const basic = md(MARKDOWN_CASES["table-basic"]);
check("a table becomes a real table", basic.includes('<table class="dshnb-table">'));
check("the header row is in a thead with th cells",
  basic.includes("<thead>") && cellCount(basic, "th") === 3);
check("the body rows are in a tbody with td cells",
  basic.includes("<tbody>") && cellCount(basic, "td") === 6);
check("row count is header plus body", rowCount(basic) === 3, `${rowCount(basic)} rows`);

// `|---|---|` and `| --- | --- |` are both valid GFM; a strict reading that needs
// the spaces would reject most hand-written tables.
check("a separator row without spaces is accepted",
  md(MARKDOWN_CASES["table-spaced-separator"]).includes("<table"));
check("a separator row with spaces is accepted",
  md("| a | b |\n| - | - |\n| 1 | 2 |").includes("<table"));

const aligned = md(MARKDOWN_CASES["table-alignment"]);
check("leading colon aligns left", /textAlign:"left"|text-align:\s*left/.test(aligned));
check("both colons align centre", /textAlign:"center"|text-align:\s*center/.test(aligned));
check("trailing colon aligns right", /textAlign:"right"|text-align:\s*right/.test(aligned));

const mathCell = md(MARKDOWN_CASES["table-inline-math"]);
check("inline math renders inside a table cell",
  mathCell.includes('class="katex"') && mathCell.includes("<table"));
check("bold renders inside a table cell", mathCell.includes("<strong>12.52</strong>"));

// A \| inside a cell is data. Splitting on it would add a phantom column, and
// dropping the backslash would rewrite what a code span shows the reader.
// This fixture has two body rows of two columns, hence four td cells.
const escaped = md(MARKDOWN_CASES["table-escaped-pipe"]);
check("an escaped pipe stays in one cell",
  cellCount(escaped, "th") === 2 && cellCount(escaped, "td") === 4,
  `th=${cellCount(escaped, "th")} td=${cellCount(escaped, "td")}`);
check("the escaped pipe keeps its backslash, as a code span shows",
  escaped.includes("a \\| b"), (escaped.match(/a[^<]*b/) || [])[0] || "not found");

// The other half of the same rule: inside a code span a bare pipe is literal,
// so a table written around one still has the right number of columns.
const pipeInCode = md("| a | b |\n|---|---|\n| `x | y` | z |");
check("a bare pipe inside a code span does not split the cell",
  cellCount(pipeInCode, "td") === 2,
  `td=${cellCount(pipeInCode, "td")}`);

const mixed = md(MARKDOWN_CASES["table-mixed-inline"]);
check("emphasis, code and links render inside cells",
  mixed.includes("<em>italic</em>") && mixed.includes("<code>code</code>") &&
    mixed.includes('href="https://example.com"'));

// The guard against over-reach: a pipe in prose is not a table.
const prose = md(MARKDOWN_CASES["no-table-pipe-text"]);
check("a paragraph containing a pipe is not turned into a table",
  !prose.includes("<table"), prose.slice(0, 90));

const afterTable = md(MARKDOWN_CASES["table-then-paragraph"]);
check("a paragraph after a table is still rendered",
  afterTable.includes("<table") && afterTable.includes("A paragraph after the table."));
check("the table does not swallow the paragraph that follows it",
  cellCount(afterTable, "td") === 2, `td=${cellCount(afterTable, "td")}`);

// A row shorter than the header is padded, or the row loses its grid shape.
const ragged = md("| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 |");
check("a short row is padded to the header width",
  cellCount(ragged, "td") === 6, `td=${cellCount(ragged, "td")}`);

/* ---- blockquotes and task lists -------------------------------------- */

// A list inside a quote has to survive as a list. The old code joined every
// quoted line into one paragraph, so the markers printed as text.
console.log("\n=== blockquotes and task lists ===");
const quoteList = md(MARKDOWN_CASES["blockquote-list"]);
check("a list inside a blockquote stays a list",
  quoteList.includes("<blockquote>") && quoteList.includes("<ul>") &&
    cellCount(quoteList, "li") === 2, quoteList.slice(0, 120));
check("blockquote list items are not flattened into one line",
  !quoteList.includes("- first - second"));

const tasks = md(MARKDOWN_CASES["task-list"]);
check("task items render as checkboxes",
  (tasks.match(/type="checkbox"/g) || []).length === 2);
check("a checked task carries checked",
  tasks.includes('checked=""') || tasks.includes("checked>"));
check("the task marker is not also printed as text",
  !tasks.includes("[ ]") && !tasks.includes("[x]"), tasks.slice(0, 140));
check("the checkbox is disabled, since the preview is read-only",
  tasks.includes("disabled"));
check("a task item is marked so the list marker is suppressed",
  tasks.includes('class="dshnb-task"'));

// Rendering a task list must not emit a React key warning: the two children of
// each item need their own keys, or React complains on every render.
{
  const warnings = [];
  const realError = console.error;
  console.error = (...a) => warnings.push(a.map(String).join(" "));
  md(MARKDOWN_CASES["task-list"]);
  md(MARKDOWN_CASES["table-inline-math"]);
  console.error = realError;
  check("no React key warning from generated lists",
    !warnings.some((w) => /unique "key"/.test(w)), warnings.slice(0, 1).join(" "));
}

/* ---- fenced code ----------------------------------------------------- */

console.log("\n=== fenced code ===");
const fenced = md("text\n\n```python\nprint(1)\n```\n\n```\nplain\n```\n");
check("python fence highlighted as one element",
  fenced.includes('data-lang="python"') &&
    fenced.includes('<span class="tok-bi">print</span>'));
check("bare fence stays plain", fenced.includes('<pre class="dshnb-hl">plain</pre>'));
check("bare fence markup is escaped",
  md("```\n<script>x\n```\n").includes("&lt;script&gt;") &&
    !md("```\n<script>x\n```\n").includes("<script"));
check("fence honours the wrap preference",
  md("```python\nx = 1\n```\n", true).includes("dshnb-wrap"));

/* ---- math ------------------------------------------------------------ */

console.log("\n=== math rendering (KaTeX) ===");
const rm = (tex, display = false) => t.renderMath(tex, display);

check("KaTeX is the engine, not a local approximation",
  rm("x").includes('class="katex"'));
check("KaTeX layout markup is produced, not plain text",
  rm("\\frac{1}{2}").includes("vlist") || rm("\\frac{1}{2}").includes("mfrac"));
check("the radical uses KaTeX's own radical",
  rm("\\sqrt{x}").includes("sqrt"));
check("italic correction reaches the output (font metrics present)",
  /style="[^"]*(height|margin-right)/.test(rm("f_{22}^{\\rm ref}")));
check("subscript produces KaTeX script markup",
  rm("f_{22}").includes("msupsub") || rm("f_{22}").includes("vlist"));
check("fraction stacks numerator over denominator",
  rm("\\tfrac{3}{2}").includes("frac") && rm("\\tfrac{3}{2}").includes("vlist"));
check("\\tfrac is honoured as the text-style fraction",
  rm("\\tfrac{3}{2}").length > 0 && rm("\\dfrac{3}{2}").length > 0);
check("\\times becomes a real multiplication sign",
  rm("1.13\\times10^{-2}").includes("\u00d7"));
check("angle brackets become the right glyphs",
  rm("\\langle h|h\\rangle").includes("\u27e8") &&
    rm("\\langle h|h\\rangle").includes("\u27e9"));
check("\\rm font command is honoured",
  !rm("T_{\\rm obs}").includes("\\rm") && rm("T_{\\rm obs}").includes("obs"));
check("display math sets display mode",
  rm("\\sum_i x_i", true).includes("katex-display"));
check("inline math does not set display mode",
  !rm("x", false).includes("katex-display"));
check("HTML inside TeX cannot escape",
  !rm("\\text{<img src=x onerror=alert(1)>}").includes("<img"));
check("malformed TeX degrades instead of throwing",
  rm("\\frac{").includes("dshnb-math-error"), rm("\\frac{").slice(0, 60));
check("a malformed expression keeps its source visible",
  rm("\\frac{").includes("frac"));

// Every expression the fixture contains must render as KaTeX, with no braces or
// commands leaking into the visible output. The list comes from the fixture
// generator, so the expectation cannot drift from the input.
const REAL = MATH_EXPRESSIONS;
const mangled = REAL.filter((tex) => {
  const out = rm(tex).replace(/<[^>]+>/g, "");
  return /[\\{}]/.test(out) || out.trim() === "";
});
check(`all ${MATH_EXPRESSIONS.length} fixture expressions render through KaTeX`,
  mangled.length === 0, mangled.join(" | "));
check("none of them fell back to the error marker",
  REAL.every((tex) => !rm(tex).includes("dshnb-math-error")));

// And they must survive the inline pipeline, i.e. inside a paragraph.
const inlineMath = md("Under a given PSD, and $\\sqrt{\\langle h|h\\rangle}$ is the norm.");
check("math renders inside a paragraph",
  inlineMath.includes('class="katex"') && inlineMath.includes("sqrt"));
check("display math is not used for an inline expression",
  !inlineMath.includes("katex-display"));
check("math does not leave a stray dollar sign",
  !inlineMath.includes("$"));

/* ---- highlighter ----------------------------------------------------- */

console.log("\n=== syntax highlighter ===");
const py = hl("def f(x):\n    # comment\n    s = 'text'\n    return x + 1", "python");
check("keyword def", py.includes('<span class="tok-kw">def</span> '));
check("function name", py.includes('<span class="tok-def">f</span>'));
check("comment", py.includes('<span class="tok-cmt"># comment</span>'));
check("string", py.includes('class="tok-str"'));
check("number", py.includes('<span class="tok-num">1</span>'));
check("builtin call", hl("print(1)", "python").includes('<span class="tok-bi">print</span>'));
check("constant", hl("x = True", "python").includes('<span class="tok-const">True</span>'));
check("decorator", hl("@njit\ndef g():", "python").includes('<span class="tok-dec">@njit</span>'));
check("class name", hl("class Foo:", "python").includes('<span class="tok-def">Foo</span>'));
check("triple-quoted string", hl('"""a\nb"""', "python").includes('<span class="tok-str">'));
check("f-string", hl('f"{x:.3f}"', "python").includes('<span class="tok-str">'));
check("js keyword", hl('const a = "s"; // c', "javascript").includes('<span class="tok-kw">const</span>'));
check("js comment", hl('const a = "s"; // c', "javascript").includes('<span class="tok-cmt">// c</span>'));
// A bash cell must be highlighted with the shell grammar.
const sh = hl("# With conda:\nconda create -n stbbh python=3.11 -y\ncd pycbc && git checkout stbbh-lisa", "bash");
check("shell comment", sh.includes('<span class="tok-cmt"># With conda:</span>'));
check("shell keyword", sh.includes('<span class="tok-kw">cd</span>'));
check("shell keeps plain commands uncoloured, as no shell grammar marks them",
  sh.includes('<span class="tok-ident">conda</span>') &&
    sh.includes('<span class="tok-ident">git</span>'));
check("shell numbers still coloured", sh.includes('<span class="tok-num">3.11</span>'));
check("json key", hl('{"key": 1}', "json").includes('<span class="tok-key">"key"</span>'));
check("json literal", hl('{"b": true}', "json").includes('<span class="tok-const">true</span>'));
check("language aliases", t.normalizeLanguage("py") === "python" &&
  t.normalizeLanguage("js") === "javascript" && t.normalizeLanguage("JSON") === "json");

console.log("\n=== highlighter safety and fidelity ===");
const stripTags = (html) => html
  .replace(/<span class="tok-[a-z]+">/g, "").replace(/<\/span>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const dangerous = hl("<script>alert(1)</script> # <b>x</b>", "python");
check("HTML in code is escaped", !dangerous.includes("<script") && dangerous.includes("&lt;"));
check("no live markup survives", !/<(?!\/?span)/.test(dangerous));

const fidelity = [
  "x = 1_000\ny = 0xFF\nz = 1.5e-3\nw = 3j",
  "s = 'it\\'s'\nt = \"a\\\"b\"\nu = f'{v!r:>{w}}'",
  "s = 'café — 中文'  # non-ASCII must round-trip\nx = 3.14159",
  "x = 1  # it's fine\ny = 2",
  "INI = f\"\"\"\n[var]\nname = value  ; note\n\"\"\"",
];
const brokenFidelity = fidelity.filter((src) => stripTags(hl(src, "python")) !== src);
check("tokenizing preserves the source byte for byte",
  brokenFidelity.length === 0,
  brokenFidelity.map((s) => JSON.stringify(stripTags(hl(s, "python")))).join(" | "));

/* ---- a full notebook render ------------------------------------------ */

console.log("\n=== render the fixture notebook ===");
const raw = readFileSync(FIXTURE, "utf8");
const warnings = [];
const realError = console.error;
console.error = (...a) => warnings.push(a.map(String).join(" "));
const html = renderToStaticMarkup(
  React.createElement(t.NotebookBody, {
    content: { kind: "bytes", data: new Uint8Array(Buffer.from(raw, "utf8")) },
    wrap: true,
    // The owner supplies the tab's resource address; it is what names saved
    // figures after the notebook.
    resourceAddress:
      "dsh-resource://file/session/test-session/notebooks/jupyter/" +
      "sample-notebook.ipynb",
  })
);
console.error = realError;

// Expectations are read from the fixture, so they cannot drift from the input.
const nb = t.parseNotebook(raw);
const codeCells = nb.cells.filter((c) => c.cellType === "code");
const mdCells = nb.cells.filter((c) => c.cellType === "markdown");
const fixtureFigures = codeCells.reduce(
  (total, cell) =>
    total +
    (cell.outputs || []).filter((o) => o.data && typeof o.data["image/png"] === "string").length,
  0
);
check(`every fixture cell parsed as code or markdown (${codeCells.length} code / ${mdCells.length} markdown)`,
  codeCells.length + mdCells.length === nb.cells.length && codeCells.length > 0);
check(`the same cell types survive parsing as the fixture declares`,
  codeCells.length === 6 && mdCells.length === 2,
  `${codeCells.length} / ${mdCells.length}`);
check(`all ${fixtureFigures} fixture figures inlined`,
  (html.match(/data:image\/png;base64,/g) || []).length === fixtureFigures,
  `${(html.match(/data:image\/png;base64,/g) || []).length} inlined`);
check("no React SSR warnings", warnings.length === 0, warnings.slice(0, 1).join(" "));
check("no raw JSON leaked", !html.includes("&quot;cell_type&quot;"));

const tokenCount = (html.match(/class="tok-[a-z]+"/g) || []).length;
check("code cells carry highlighted tokens", tokenCount > 50, `${tokenCount} token spans`);
check("code cells tagged with the kernel language", html.includes('data-lang="python"'));
// The fixture's bash cell must be tokenized by the shell grammar, not by the
// Python one that a kernel-level language would otherwise apply.
const bashSpan = (html.match(/data-lang="bash"[\s\S]{0,4000}?<\/pre>/) || [])[0] || "";
check("the bash cell is highlighted with the shell grammar",
  bashSpan.includes('<span class="tok-cmt"># With conda:</span>') ||
    html.includes('<span class="tok-cmt"># With conda:</span>'),
  bashSpan ? "found the bash cell" : "no bash cell in the render");
check("wrap preference applied", html.includes("dshnb-code dshnb-hl dshnb-wrap"));
check("math rendered in the fixture notebook", html.includes('class="katex"'));
check("subscripts present", html.includes("msupsub") || html.includes("vlist"));
check("the radical from the fixture rendered", html.includes("sqrt"));
check("fractions from the fixture rendered", html.includes("frac"));
check("no math fell back to the error marker", !html.includes("dshnb-math-error"));
check("a stream output reaches the DOM", html.includes("drawing 1000 systems"));
check("a stderr stream is marked as such", html.includes("dshnb-stderr"));
check("an error output renders its traceback", html.includes("deliberate fixture failure"));
check("ANSI escapes are stripped from the traceback", !html.includes("\u001b[31m"));
check("KaTeX fonts are embedded, so math needs no network",
  t.css.includes("data:font/woff2;base64,"));
check("the stylesheet declares KaTeX font faces",
  (t.css.match(/@font-face/g) || []).length >= 15,
  `${(t.css.match(/@font-face/g) || []).length} faces`);
check("no relative font URL remains in the stylesheet",
  !/url\((?!["']?data:)/.test(t.css));
check("rendered source still contains real code",
  html.includes("draw_population") && html.includes("eccentricity"));

/* ---- image actions --------------------------------------------------- */

console.log("\n=== images: zoom and save ===");
{
  // A 1x1 PNG, enough to exercise the data-URI path.
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const PNG_URI = "data:image/png;base64," + PNG_B64;
  const JPG_URI = "data:image/jpeg;base64," + PNG_B64;

  check("the notebook stem is derived from the tab address",
    t.notebookStem("dsh-resource://file/session/abc/notebooks/jupyter/stbbh_lisa_population_to_snr.ipynb")
      === "stbbh_lisa_population_to_snr",
    t.notebookStem("dsh-resource://file/session/abc/notebooks/jupyter/stbbh_lisa_population_to_snr.ipynb"));
  check("a name needing escapes is decoded then sanitised",
    t.notebookStem("dsh-resource://file/session/abc/a%20b/c%20d.ipynb") === "c_d",
    t.notebookStem("dsh-resource://file/session/abc/a%20b/c%20d.ipynb"));
  check("a missing name falls back instead of producing an empty stem",
    t.notebookStem("") === "notebook");

  check("png extension", t.imageExtension(PNG_URI) === "png");
  check("jpeg maps to jpg", t.imageExtension(JPG_URI) === "jpg");
  check("unknown sources still yield an extension",
    typeof t.imageExtension("blob:xyz") === "string");

  // The figure markup is the declarative half of the feature.
  const figure = renderToStaticMarkup(
    React.createElement(t.Figure, { src: PNG_URI, filename: "nb-cell1-out1.png" })
  );
  // The new-tab action is deliberately gone: the host denies every renderer
  // window open (setWindowOpenHandler returns deny on the app and account
  // windows, and the sidebar view forwards only https: to openExternal), so a
  // blob:/data:/file: destination can never reach a separate window. See the
  // note in the plugin source. A dead control is worse than an absent one.
  check("no open-in-new-tab control is offered",
    !figure.includes("new tab") && !figure.includes("\u2197"));
  check("the figure renders the image itself",
    figure.includes('class="dshnb-img"') && figure.includes(PNG_URI));
  check("the image is clickable for zoom", figure.includes('title="Click to zoom"'));
  check("a zoom action is offered", figure.includes(">Zoom<"));
  check("a save action is offered", figure.includes(">Save<"));
  check("actions are real buttons, so keyboard users can reach them",
    (figure.match(/<button/g) || []).length === 2,
    `${(figure.match(/<button/g) || []).length} buttons`);

  // The lightbox is a module-scope overlay, styled as one.
  check("the lightbox is a full-screen overlay",
    /\.dshnb-lightbox\s*\{[^}]*position:\s*fixed/.test(t.css) &&
      /\.dshnb-lightbox\s*\{[^}]*inset:\s*0/.test(t.css));
  check("the lightbox sits above ANY host layer",
    (() => {
      const match = /\.dshnb-lightbox\s*\{[^}]*z-index:\s*(\d+)/.exec(t.css);
      // A fixed application header carries its own stacking order. At a merely
      // large value it overlays this dialog and swallows presses aimed at the
      // bar, which reads as controls that ignore a click on their middle.
      return Boolean(match) && Number(match[1]) >= 1000000;
    })(),
    (/\.dshnb-lightbox\s*\{[^}]*z-index:\s*(\d+)/.exec(t.css) || [])[1]);
  check("the bar is also kept clear of a host header",
    /\.dshnb-lightbox\s*\{[^}]*padding:\s*72px/.test(t.css));
  check("the controls are at least 34px tall",
    /\.dshnb-lightbox-btn\s*\{[^}]*min-height:\s*3[4-9]px/.test(t.css));
  check("the zoom readout is a comfortable target too",
    /\.dshnb-zoom-value\s*\{[^}]*min-height:\s*34px/.test(t.css));
  check("figure actions are hidden until hover or focus",
    /\.dshnb-figure:hover\s+\.dshnb-figure-actions/.test(t.css) &&
      /\.dshnb-figure:focus-within\s+\.dshnb-figure-actions/.test(t.css));

  /* ---- continuous zoom ---- */

  console.log("\n=== continuous zoom ===");
  check("zoom is a continuous factor, not a fit/actual toggle",
    typeof t.ZOOM_STEP === "number" && t.ZOOM_STEP > 1 && t.ZOOM_STEP < 2,
    `step ${t.ZOOM_STEP}`);
  check("zoom ranges from fit to well past 100%",
    t.ZOOM_MIN === 1 && t.ZOOM_MAX >= 8, `${t.ZOOM_MIN}..${t.ZOOM_MAX}`);
  check("a click of + multiplies the scale", t.ZOOM_STEP === 1.25);
  check("scale is clamped at the top", t.clamp(99, t.ZOOM_MIN, t.ZOOM_MAX) === t.ZOOM_MAX);
  check("scale is clamped at the bottom",
    t.clamp(0.01, t.ZOOM_MIN, t.ZOOM_MAX) === t.ZOOM_MIN);
  check("clamping leaves a value inside the range alone",
    t.clamp(2.5, t.ZOOM_MIN, t.ZOOM_MAX) === 2.5);
  // Repeated clicks must reach the cap rather than overflowing it.
  let step = 1;
  for (let i = 0; i < 40; i += 1) step = t.clamp(step * t.ZOOM_STEP, t.ZOOM_MIN, t.ZOOM_MAX);
  check("repeated zoom-in saturates at the maximum", step === t.ZOOM_MAX, String(step));

  // The zoom base must be the fitted box, and the painted size must equal
  // base x scale. Deriving one dimension and letting CSS clamp the other is the
  // fault that made 195% look barely larger than fit.
  console.log("\n=== zoom scale is truthful ===");
  check("fit never upscales past the image's own pixels",
    (() => {
      const box = t.fitBox({ width: 400, height: 300 }, { width: 2000, height: 2000 });
      return box.width === 400 && box.height === 300;
    })());
  check("fit is bounded by the width when the image is wide",
    (() => {
      const box = t.fitBox({ width: 2000, height: 1000 }, { width: 1000, height: 1000 });
      return box.width === 1000 && box.height === 500;
    })());
  check("fit is bounded by the height when the image is tall",
    (() => {
      const box = t.fitBox({ width: 1000, height: 2000 }, { width: 1000, height: 1000 });
      return box.width === 500 && box.height === 1000;
    })());
  check("fit preserves the aspect ratio",
    (() => {
      const box = t.fitBox({ width: 1536, height: 1024 }, { width: 900, height: 700 });
      const before = 1536 / 1024;
      const after = box.width / box.height;
      return Math.abs(before - after) < 1e-9;
    })());
  check("the painted size is exactly the base times the scale",
    (() => {
      const base = t.fitBox({ width: 1536, height: 1024 }, { width: 900, height: 700 });
      for (const scale of [1, t.ZOOM_STEP, 2, 4, t.ZOOM_MAX]) {
        const painted = { w: base.width * scale, h: base.height * scale };
        // The zoom readout reports this scale, so the ratio must hold exactly.
        if (Math.abs(painted.w / base.width - scale) > 1e-9) return false;
        if (Math.abs(painted.h / base.height - scale) > 1e-9) return false;
      }
      return true;
    })());
  check("a fit box is refused when the image has no intrinsic size",
    t.fitBox({ width: 0, height: 0 }, { width: 800, height: 600 }) === null);
  check("the painted width grows monotonically with the scale",
    (() => {
      const base = t.fitBox({ width: 1536, height: 1024 }, { width: 900, height: 700 });
      let previous = 0;
      for (let s = 1; s <= t.ZOOM_MAX; s += 0.25) {
        const w = base.width * s;
        if (w <= previous) return false;
        previous = w;
      }
      return true;
    })());

  // No CSS constraint may clamp the explicit size, or the picture stops growing
  // while the readout keeps climbing.
  check("no max-width/max-height clamps the zoomed image",
    !/\.dshnb-lightbox-img\s*\{[^}]*max-(width|height)\s*:/.test(t.css));
  check("both dimensions are set by the component, none by CSS",
    !/\.dshnb-lightbox-img\s*\{[^}]*\bwidth\s*:/.test(t.css) &&
      !/\.dshnb-lightbox-img\s*\{[^}]*\bheight\s*:/.test(t.css));
  check("an unmeasured image is held back rather than painted undersized",
    readFileSync(BUNDLE, "utf8").includes('visibility: "hidden"'));
  check("the stage centres with auto margins, not flex centring",
    /\.dshnb-lightbox-img\s*\{[^}]*margin:\s*auto/.test(t.css) &&
      !/\.dshnb-lightbox-stage\s*\{[^}]*justify-content/.test(t.css));

  // Zoom is expressed as layout dimensions. A transform was the earlier design
  // and it could move content out of sight; a wrong size can only look wrong.
  const bundleSource = readFileSync(BUNDLE, "utf8");
  check("zoom sets both layout dimensions from the fitted box",
    bundleSource.includes("width: `${Math.round(fit.width * scale)}px`") &&
      bundleSource.includes("height: `${Math.round(fit.height * scale)}px`"));
  check("no transform is applied to the zoomed image",
    !/\.dshnb-lightbox-img\s*\{[^}]*transform\s*:/.test(t.css) &&
      !bundleSource.includes("style.transform ="));
  check("no transform-origin remains",
    !/transform-origin/.test(t.css));
  check("the fit base is re-measured on resize",
    bundleSource.includes('addEventListener("resize"') &&
      bundleSource.includes("refit"));

  // Hooks may not follow the lightbox's early return. A hook declared after it
  // registers on the renders where `image` is set and not on the others, and
  // React then fails with "Rendered more hooks than during the previous render"
  // and unmounts the subtree -- which blanks the entire preview pane, not just
  // the overlay. This guard exists because exactly that shipped once.
  check("no hook is declared after the lightbox's early return",
    (() => {
      const source = readFileSync(BUNDLE, "utf8");
      const start = source.indexOf("function ImageLightbox");
      const end = source.indexOf("function Figure");
      if (start < 0 || end < start) return false;
      const body = source.slice(start, end);
      const guard = body.indexOf("if (!image) return null");
      if (guard < 0) return false;
      return !/React\.use[A-Za-z]+\s*\(/.test(body.slice(guard));
    })());

  check("a stage owns the scroll so panning is scrolling",
    /\.dshnb-lightbox-stage\s*\{[^}]*overflow:\s*auto/.test(t.css));
  check("the stage offers a grab cursor", /cursor:\s*grab/.test(t.css));
  check("dragging suppresses text selection",
    /\.dshnb-lightbox-dragging\s*\{[^}]*user-select:\s*none/.test(t.css));
  check("a zoom readout is styled",
    /\.dshnb-zoom-value\s*\{[^}]*min-width/.test(t.css));
  check("zoom controls are grouped",
    /\.dshnb-zoom-group\s*\{[^}]*display:\s*inline-flex/.test(t.css));
  check("the lightbox explains its gestures",
    /\.dshnb-lightbox-hint\s*\{/.test(t.css));
  check("the fitted image is bounded by the stage, not by CSS",
    // The bound moved into the component's fit computation, so it needs no CSS
    // constraint; asserting the CSS is what proves the clamp cannot fight it.
    /\.dshnb-lightbox-img\s*\{[^}]*margin:\s*auto/.test(t.css) &&
      !/\.dshnb-lightbox-img\s*\{[^}]*max-height/.test(t.css));

  // Anchored zoom: the point under the pointer must not move. Verified on the
  // arithmetic, because a painted layout cannot be inspected here.
  check("an anchored point is fixed across a zoom-in",
    (() => {
      const point = { x: 120, y: 80 };
      const view = { left: 0, top: 0 };
      const next = t.zoomScroll(view, point, 1, 2);
      return Math.abs(point.x * 1 - view.left - (point.x * 2 - next.left)) < 1e-9 &&
        Math.abs(point.y * 1 - view.top - (point.y * 2 - next.top)) < 1e-9;
    })());
  check("an anchored point is fixed across a zoom-out",
    (() => {
      const point = { x: 300, y: 210 };
      const view = { left: 64, top: 18 };
      const next = t.zoomScroll(view, point, 4, 1.6);
      return Math.abs(point.x * 4 - view.left - (point.x * 1.6 - next.left)) < 1e-9 &&
        Math.abs(point.y * 4 - view.top - (point.y * 1.6 - next.top)) < 1e-9;
    })());
  check("a zoom-in at the image origin needs no scroll beyond it",
    (() => {
      const next = t.zoomScroll({ left: 0, top: 0 }, { x: 0, y: 0 }, 1, 3);
      return next.left === 0 && next.top === 0;
    })());
  check("zoom-out about the origin is the exact inverse of zoom-in",
    (() => {
      const point = { x: 40, y: 25 };
      const up = t.zoomScroll({ left: 0, top: 0 }, point, 1, 2);
      const down = t.zoomScroll(up, point, 2, 1);
      return Math.abs(down.left) < 1e-9 && Math.abs(down.top) < 1e-9;
    })());
  check("the scroll arithmetic stays finite at maximum zoom",
    (() => {
      const next = t.zoomScroll({ left: 30, top: 5 }, { x: 900, y: 700 }, 1, t.ZOOM_MAX);
      return Number.isFinite(next.left) && Number.isFinite(next.top);
    })());

  // The fixture's figures must reach that markup, not a bare <img>.
  check("the notebook's figures use the action wrapper",
    html.includes('class="dshnb-figure"'));
  check("the notebook's figures carry save names",
    /class="dshnb-img"[^>]*alt="[^"]*cell\d+-out\d+\.png"/.test(html) ||
      /data-[a-z]+="[^"]*cell\d+-out\d+\.png"/.test(html) ||
      html.includes("-cell"),
    (html.match(/[a-z_.-]+-cell\d+-out\d+\.(?:png|jpg)/) || [])[0] || "none found");
  check("output figures expose a save name derived from the notebook",
    /sample-notebook-cell\d+-out\d+\.png/.test(html),
    (html.match(/sample-notebook-cell\d+-out\d+\.(?:png|jpg)/) || [])[0] || "none");
  check("the save name matches the notebook's own stem",
    /sample-notebook-cell\d+-out\d+\.png/.test(html));
}

/* ---- stylesheet ------------------------------------------------------ */

console.log("\n=== stylesheet integrity ===");
{
  const css = t.css;
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  const blocks = css.match(/\{[^{}]*\}/g) || [];
  const inside = blocks.join("").match(/\{/g)?.length || 0;
  check("braces balanced", open === close, `${open} open / ${close} close`);
  check("no rule is missing its closing brace", open - inside === 0,
    `${open - inside} stray brace(s)`);

  const lines = css.split("\n");
  const noFallback = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(background|border|border-\w+)\s*:\s*[^;]*color-mix\([^;]*;/g)) {
      const prop = m[1];
      const same = new RegExp(prop + "\\s*:\\s*[^;]*rgba\\(").test(line.slice(0, m.index));
      const prev = i > 0 && new RegExp(prop + "\\s*:\\s*[^;]*rgba\\(").test(lines[i - 1]);
      if (!same && !prev) noFallback.push(`${prop}@${i + 1}`);
    }
  });
  check("every color-mix declaration has a static fallback",
    noFallback.length === 0, noFallback.join(", "));

  console.log("\n=== theme safety (the invisible-text bug) ===");
  check("no guessed host design tokens",
    !/var\(--dsh-(?!content-font-size)/.test(css),
    (css.match(/var\(--dsh-[a-z0-9-]+/g) || []).join(", "));
  const hlBlock = /\.dshnb-hl\s*\{[^}]*\}/.exec(css)?.[0] || "";
  check("highlight container does not pin a text colour",
    !/(^|[;{\s])color\s*:/.test(hlBlock.replace(/--tk-[a-z]+:/g, "")));
  const tkNames = ["kw", "str", "num", "cmt", "fn", "bi", "const", "dec", "def", "key"];
  const declLine = (n) => css.split("\n").find((l) => new RegExp(`--tk-${n}:`).test(l)) || "";
  const missing = tkNames.filter((n) => ((declLine(n).match(/#[0-9a-fA-F]{3,8}/g) || []).length < 2));
  check("every token colour declares a literal fallback before light-dark()",
    missing.length === 0, missing.join(", "));
  const wrongOrder = tkNames.filter((n) => {
    const line = declLine(n);
    return !(line.search(/#[0-9a-fA-F]{3,8}/) >= 0 && line.search(/#[0-9a-fA-F]{3,8}/) < line.indexOf("light-dark("));
  });
  check("the literal fallback comes first", wrongOrder.length === 0, wrongOrder.join(", "));
  check("fills and borders follow the theme",
    css.includes("color-mix(in srgb, currentColor") && !css.includes("rgba(127,127,127"));

  console.log("\n=== math layout ===");
  // The hand-rolled stack is gone: KaTeX owns fractions and radicals now, so
  // the only layout this plugin still declares is the display wrapper.
  check("display math has its own block wrapper",
    /\.dshnb-math-display\s*\{[^}]*display:\s*block/.test(css));
  check("display math can scroll rather than overflow",
    /\.dshnb-math-display\s*\{[^}]*overflow-x:\s*auto/.test(css));
  check("inline math is not wrapped across lines",
    /\.dshnb-md\s+\.katex\s*\{[^}]*white-space:\s*nowrap/.test(css));
  check("the hand-rolled radical is gone",
    !/\.math-sqrt/.test(css) && !/\.math-radicand/.test(css));
  check("the hand-rolled fraction is gone",
    !/\.math-frac/.test(css));
}

console.log(`\n  html ${html.length} bytes, ${tokenCount} token spans`);

finish();
