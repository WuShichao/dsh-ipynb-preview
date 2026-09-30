/**
 * Write tests/fixtures/sample-notebook.ipynb.
 *
 * The suite used to render a real 866 KB research notebook, which made it
 * depend on one machine's file layout. This fixture carries the same shapes in
 * miniature: the notebook features, every math expression the renderer has to
 * survive, code in the languages the highlighter supports, the four output
 * kinds, and named figures. Counts are asserted against the fixture itself, so
 * the expectations cannot silently drift from the input.
 *
 * Run with: node tests/make-fixture.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A 1x1 PNG, the smallest valid figure output. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/**
 * The TeX the renderer must handle, drawn from the shapes a real physics
 * notebook uses: sub/superscripts, fractions, radicals, text-in-math, and a
 * scientific notation with an explicit times sign.
 *
 * Exported so the suite asserts against exactly this list rather than a copy.
 */
export const MATH_EXPRESSIONS = [
  "10^{-2}",
  "\\log_{10} e",
  "f_{22}^{\\rm ref}",
  "T_{\\rm obs}",
  "(2,2,2)",
  "f_{22}",
  "(2,2,3)",
  "\\tfrac{3}{2} f_{22}",
  "1.00",
  "1.13\\times10^{-2}",
  "\\sqrt{\\langle h|h\\rangle}",
  "10^{-4}",
  "0.2",
];

const markdown = [
  "# Sample notebook",
  "",
  "A fixture that exercises the renderer without depending on any external file.",
  "",
  "Frequency bins are spaced by $10^{-2}$ and the reference harmonic is",
  "$f_{22}^{\\rm ref}$. The observation time is $T_{\\rm obs}$.",
  "",
  "| Quantity | Value |",
  "| --- | --- |",
  "| Amplitude | $1.13\\times10^{-2}$ |",
  "| Norm | $\\sqrt{\\langle h|h\\rangle}$ |",
  "",
  "The log-uniform eccentricity draw uses $\\log_{10} e$, and a half harmonic",
  "appears at $\\tfrac{3}{2} f_{22}$.",
  "",
  "An inline expression like $10^{-4}$ must not become a display block, and a",
  "code span such as `f_{22}` must stay literal.",
  "",
  "## A list",
  "",
  "- first $(2,2,2)$",
  "- second $(2,2,3)$",
  "- third $10^{-4}$",
  "",
  "> A blockquote with $0.2$ inside it.",
  "",
  "```python",
  "# A fence inside markdown is still highlighted.",
  "print(1)",
  "```",
].join("\n");

const pythonSource = [
  "import numpy as np",
  "",
  "",
  "@njit",
  "def draw_population(n=1000):",
  '    """Draw a log-uniform eccentricity."""',
  "    masses = np.linspace(5.0, 95.0, n)",
  "    eccentricity = np.exp(np.random.uniform(-11.5, -1.15, n))",
  "    if eccentricity.max() > 1.0:",
  "        raise ValueError('eccentricity above unity')",
  "    return masses, eccentricity",
].join("\n");

const bashSource = [
  "# With conda:",
  "conda create -n sample python=3.11 -y",
  "cd repo && git checkout main",
  "python -c 'print(3.11)'",
].join("\n");

const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
    language_info: { name: "python", version: "3.11" },
  },
  cells: [
    { cell_type: "markdown", metadata: {}, source: markdown },
    {
      cell_type: "code",
      execution_count: 1,
      metadata: {},
      source: pythonSource,
      outputs: [
        {
          output_type: "stream",
          name: "stdout",
          text: "drawing 1000 systems\n",
        },
      ],
    },
    {
      cell_type: "code",
      execution_count: 2,
      metadata: {},
      source: "fig, axes = plt.subplots(2, 2)\naxes[0, 0].hist(masses)\n",
      outputs: [
        {
          output_type: "display_data",
          metadata: {},
          data: { "image/png": PNG, "text/plain": "<Figure size 800x600>" },
        },
      ],
    },
    {
      cell_type: "code",
      execution_count: 3,
      metadata: {},
      source: "axes[0, 1].hist(eccentricity)\n",
      outputs: [
        {
          output_type: "execute_result",
          execution_count: 3,
          metadata: {},
          data: { "image/png": PNG },
        },
      ],
    },
    {
      cell_type: "code",
      execution_count: 4,
      metadata: {},
      source: "raise RuntimeError('deliberate fixture failure')\n",
      outputs: [
        {
          output_type: "error",
          ename: "RuntimeError",
          evalue: "deliberate fixture failure",
          traceback: [
            "\u001b[31mRuntimeError\u001b[0m: deliberate fixture failure",
            "  at <anonymous>:1",
          ],
        },
      ],
    },
    {
      cell_type: "code",
      execution_count: 5,
      metadata: {},
      source: bashSource,
      outputs: [],
    },
    {
      cell_type: "code",
      execution_count: 6,
      metadata: {},
      source: "console.log('a javascript cell exercises another grammar');",
      outputs: [
        {
          output_type: "stream",
          name: "stderr",
          text: "a warning on stderr\n",
        },
      ],
    },
    {
      cell_type: "markdown",
      metadata: {},
      source: "Final markdown cell with $10^{-2}$ inline and a trailing figure name.",
    },
  ],
};

const out = join(here, "fixtures", "sample-notebook.ipynb");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(notebook, null, 1) + "\n", "utf8");

const code = notebook.cells.filter((c) => c.cell_type === "code");
const md = notebook.cells.filter((c) => c.cell_type === "markdown");
console.log(`wrote ${out}`);
console.log(
  `cells: ${notebook.cells.length} (${code.length} code, ${md.length} markdown), ` +
    `figures: 2, math expressions: ${MATH_EXPRESSIONS.length}`
);
