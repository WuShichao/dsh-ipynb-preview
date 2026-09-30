/**
 * Fixture notebook for the Markdown table work.
 *
 * Kept separate from the main sample so the verifier can assert the exact cell
 * counts the table tests read their expectations from.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** One Markdown cell per construct the renderer must handle. */
export const MARKDOWN_CASES = {
  "table-basic": [
    "| dimension | bank dx | range |",
    "|---|---|---|",
    "| mass1 | 2.876e-4 | 120 |",
    "| mass2 | 2.391e-4 | 110 |",
  ].join("\n"),

  "table-spaced-separator": [
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
  ].join("\n"),

  "table-alignment": [
    "| left | centre | right |",
    "| :--- | :---: | ---: |",
    "| 1 | 2 | 3 |",
  ].join("\n"),

  "table-inline-math": [
    "| dim | value |",
    "|---|---|",
    "| mass1 | $2.876\\times10^{-4}$ |",
    "| spin1x | **12.52** |",
  ].join("\n"),

  "table-escaped-pipe": [
    "| expr | meaning |",
    "|---|---|",
    "| `a \\| b` | bitwise or |",
    "| $1-\\mathrm{Match}$ | mismatch |",
  ].join("\n"),

  "table-mixed-inline": [
    "| name | note |",
    "|---|---|",
    "| *italic* | `code` |",
    "| [link](https://example.com) | **bold** |",
  ].join("\n"),

  "table-then-paragraph": [
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "A paragraph after the table.",
  ].join("\n"),

  "no-table-pipe-text": [
    "A sentence with a | pipe that is not a table.",
    "",
    "Another | one.",
  ].join("\n"),

  "blockquote-list": [
    "> **Status**",
    ">",
    "> - first",
    "> - second",
  ].join("\n"),

  "task-list": [
    "- [ ] unchecked",
    "- [x] checked",
  ].join("\n"),
};

const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { language_info: { name: "python" } },
  cells: Object.entries(MARKDOWN_CASES).map(([name, source]) => ({
    cell_type: "markdown",
    metadata: { name },
    source,
  })),
};

const out = join(here, "fixtures", "markdown-cases.ipynb");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(notebook, null, 1) + "\n", "utf8");
console.log(`wrote ${out}`);
console.log(`cells: ${notebook.cells.length}`);
for (const name of Object.keys(MARKDOWN_CASES)) console.log(`  - ${name}`);
