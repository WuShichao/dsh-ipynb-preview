/**
 * Browser bundle for dsh-ipynb-preview.
 *
 * Registers one document-preview implementation for `.ipynb` files. The
 * document owner (`dsh-client-ui-sidebar-documentpreview`) delivers the file as
 * complete bytes, because a notebook is JSON and cannot be parsed from an
 * accumulated text prefix, so `loading: 'bytes-complete'` is required.
 *
 * The body registers directly into the keyed `sidebar.right.tab.document` seat,
 * exactly as the shipped Markdown/HTML/image bodies do.
 *
 * Module dependencies are limited to `react` and `react/jsx-runtime`: the
 * shell's frozen module table carries little else for a bundle like this one, so
 * the syntax highlighter, the math renderer, and the Markdown subset are all
 * self-contained here.
 */
window.__ModuleLoader__.load({
  id: "dsh-ipynb-preview",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");

    const ID = "dsh-ipynb-preview";

    /** Escape text for safe HTML embedding. */
    function esc(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    /* ================================================================== *
     * Syntax highlighting
     * ================================================================== */

    const PY_KEYWORDS = new Set([
      "and", "as", "assert", "async", "await", "break", "class", "continue",
      "def", "del", "elif", "else", "except", "finally", "for", "from",
      "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
      "pass", "raise", "return", "try", "while", "with", "yield",
      "match", "case", "self", "cls",
    ]);

    const PY_BUILTINS = new Set([
      "abs", "all", "any", "bool", "bytes", "chr", "dict", "dir", "enumerate",
      "eval", "filter", "float", "format", "frozenset", "getattr", "hasattr",
      "hash", "help", "hex", "id", "input", "int", "isinstance", "issubclass",
      "iter", "len", "list", "map", "next", "object", "oct",
      "open", "ord", "pow", "print", "range", "repr", "reversed", "round",
      "set", "setattr", "slice", "sorted", "str", "sum", "super", "tuple",
      "type", "vars", "zip", "__import__", "__name__", "__file__", "__init__",
    ]);
    // `min`/`max` are deliberately absent: they collide with the `min-`/`max-`
    // keys of INI content living inside a notebook string, where colouring half
    // of a hyphenated key differently reads as broken highlighting.

    const PY_CONSTANTS = new Set(["True", "False", "None"]);

    const JS_KEYWORDS = new Set([
      "async", "await", "break", "case", "catch", "class", "const", "continue",
      "debugger", "default", "delete", "do", "else", "export", "extends",
      "finally", "for", "function", "if", "import", "in", "instanceof", "let",
      "new", "of", "return", "static", "super", "switch", "this", "throw",
      "try", "typeof", "var", "void", "while", "with", "yield", "interface",
      "type", "enum", "implements", "declare", "readonly", "public", "private",
      "protected", "as", "from", "satisfies", "keyof",
    ]);

    const JS_BUILTINS = new Set([
      "Array", "Boolean", "console", "Date", "Error", "JSON", "Map", "Math",
      "Number", "Object", "Promise", "RegExp", "Set", "String", "Symbol",
      "WeakMap", "document", "window",
    ]);

    const JS_CONSTANTS = new Set([
      "true", "false", "null", "undefined", "NaN", "Infinity",
    ]);

    const SHELL_KEYWORDS = new Set([
      "if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case",
      "esac", "function", "in", "return", "export", "local", "source", "alias",
      "set", "unset", "echo", "cd", "exit",
    ]);

    /** Per-language tokenizer configuration. */
    const LANGS = {
      python: {
        keywords: PY_KEYWORDS, builtins: PY_BUILTINS, constants: PY_CONSTANTS,
        lineComment: /#[^\n]*/, decorator: true, multilineString: true,
        defKeyword: /\b(?:def|class)\s+[A-Za-z_]\w*/,
      },
      javascript: {
        keywords: JS_KEYWORDS, builtins: JS_BUILTINS, constants: JS_CONSTANTS,
        lineComment: /\/\/[^\n]*/, blockComment: /\/\*[\s\S]*?\*\//,
      },
      typescript: {
        keywords: JS_KEYWORDS, builtins: JS_BUILTINS, constants: JS_CONSTANTS,
        lineComment: /\/\/[^\n]*/, blockComment: /\/\*[\s\S]*?\*\//,
      },
      bash: {
        keywords: SHELL_KEYWORDS, builtins: new Set(), constants: new Set(),
        lineComment: /#[^\n]*/,
      },
      yaml: {
        keywords: new Set(), builtins: new Set(),
        constants: new Set(["true", "false", "null", "yes", "no", "on", "off", "~"]),
        lineComment: /#[^\n]*/,
      },
      json: { json: true },
    };

    /** Rule kind -> CSS class suffix. */
    const CLASS_BY_KIND = {
      comment: "cmt", string: "str", number: "num", decorator: "dec",
      def: "def", call: "fn", word: "ident",
    };

    const PY_STRING =
      /(?:[rRbBuUfF]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?''')|(?:[rRbBuUfF]{0,2})(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/;

    const NUMBER =
      /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)\b/;

    /**
     * Build the ordered rule list for one language. Order matters: the first
     * pattern matching at the current index wins, so `call` precedes the
     * generic `word` rule.
     * @param lang - normalized language id.
     * @returns [kind, RegExp] pairs.
     */
    function buildRules(lang) {
      const rules = [];
      const config = LANGS[lang];
      if (config && config.lineComment) rules.push(["comment", config.lineComment]);
      if (config && config.blockComment) rules.push(["comment", config.blockComment, "block"]);
      rules.push(["string", PY_STRING]);
      if (config && config.decorator) rules.push(["decorator", /@[A-Za-z_][\w.]*/]);
      rules.push(["number", NUMBER]);
      if (config && config.defKeyword) rules.push(["def", config.defKeyword]);
      rules.push(["call", /\b[A-Za-z_]\w*(?=\s*\()/]);
      rules.push(["word", /[A-Za-z_]\w*/]);
      return rules;
    }

    /**
     * Highlight one line of code into HTML spans.
     *
     * `state` carries constructs that outlive a line -- an unterminated
     * triple-quoted string or block comment -- so a line-based pass does not
     * colour a multi-line string as code after its first line. Without this, a
     * `f"""..."""` config block renders with its own first line as a string and
     * the remaining lines as ordinary keywords and numbers, which is exactly
     * the inconsistent colouring this must avoid.
     *
     * @param line - the raw source line.
     * @param language - lower-case language id.
     * @param state - optional carry-over state; mutated in place.
     * @returns HTML with `<span class="tok-*">` runs.
     */
    function highlightLine(line, language, state) {
      const carry = state || { block: null, delimiter: null };

      // Inside a triple-quoted string: emit the line and look only for the
      // terminator, so no other rule applies to it.
      if (carry.delimiter) {
        const closing = line.indexOf(carry.delimiter);
        if (closing < 0) {
          return `<span class="tok-str">${esc(line)}</span>`;
        }
        const end = closing + carry.delimiter.length;
        const head = `<span class="tok-str">${esc(line.slice(0, end))}</span>`;
        carry.delimiter = null;
        // Guard the tail: an empty remainder would recurse forever.
        const tail = line.slice(end);
        return tail ? head + highlightLine(tail, language, carry) : head;
      }
      // Inside a block comment: only the terminator ends it.
      if (carry.block) {
        const closing = line.indexOf(carry.block);
        if (closing < 0) {
          return `<span class="tok-cmt">${esc(line)}</span>`;
        }
        const end = closing + carry.block.length;
        const head = `<span class="tok-cmt">${esc(line.slice(0, end))}</span>`;
        carry.block = null;
        const tail = line.slice(end);
        return tail ? head + highlightLine(tail, language, carry) : head;
      }

      // JSON has its own, much smaller shape.
      if (language === "json") {
        let out = "";
        let at = 0;
        const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
        let match;
        while ((match = re.exec(line)) !== null) {
          out += esc(line.slice(at, match.index));
          if (match[1] !== void 0) {
            out += match[2] !== void 0
              ? `<span class="tok-key">${esc(match[1])}</span>${esc(match[2])}`
              : `<span class="tok-str">${esc(match[1])}</span>`;
          } else if (match[3] !== void 0) {
            out += `<span class="tok-const">${esc(match[3])}</span>`;
          } else {
            out += `<span class="tok-num">${esc(match[4])}</span>`;
          }
          at = match.index + match[0].length;
        }
        return out + esc(line.slice(at));
      }

      const config = LANGS[language] || LANGS.python;
      const rules = buildRules(language);
      let out = "";
      let at = 0;

      while (at < line.length) {
        // An unterminated triple-quoted string opens a carry-over state, so the
        // lines that follow are coloured as string content.
        if (config.multilineString) {
          const open = /^(?:[rRbBuUfF]{0,2})(?:"""|''')/.exec(line.slice(at));
          if (open) {
            const delimiter = open[0].slice(-3);
            const closing = line.indexOf(delimiter, at + open[0].length);
            if (closing < 0) {
              carry.delimiter = delimiter;
              out += `<span class="tok-str">${esc(line.slice(at))}</span>`;
              return out;
            }
            const end = closing + delimiter.length;
            out += `<span class="tok-str">${esc(line.slice(at, end))}</span>`;
            at = end;
            continue;
          }
        }

        let matched = false;
        for (const rule of rules) {
          const kind = rule[0];
          const pattern = rule[1];
          pattern.lastIndex = 0;
          const match = pattern.exec(line.slice(at));
          if (!match || match.index !== 0) continue;

          const text = match[0];
          let cls = CLASS_BY_KIND[kind] || "ident";
          if (kind === "word") {
            if (config.constants.has(text)) cls = "const";
            else if (config.keywords.has(text)) cls = "kw";
            else if (config.builtins.has(text)) cls = "bi";
            else cls = "ident";
          } else if (kind === "def") {
            // Colour only the name; `def`/`class` is an ordinary keyword.
            const name = /[A-Za-z_]\w*$/.exec(text)[0];
            const prefix = text.slice(0, text.length - name.length);
            out += `<span class="tok-kw">${esc(prefix.trimEnd())}</span>`;
            out += esc(prefix.slice(prefix.trimEnd().length));
            out += `<span class="tok-def">${esc(name)}</span>`;
            at += text.length;
            matched = true;
            break;
          } else if (kind === "call") {
            cls = config.builtins.has(text) ? "bi" : "fn";
          } else if (rule[2] === "block") {
            // A block comment left open carries into the following lines.
            const terminator = "*/";
            if (text.indexOf(terminator, 2) < 0) carry.block = terminator;
          }

          out += `<span class="tok-${cls}">${esc(text)}</span>`;
          at += text.length;
          matched = true;
          break;
        }
        if (!matched) {
          // No rule matched at this offset: emit one character and advance.
          // Consuming the whole rest of the line here would skip past a later
          // string, comment or number on the same line, silently dropping its
          // highlighting.
          out += esc(line[at]);
          at += 1;
        }
      }
      return out;
    }

    /**
     * Highlight a whole code block.
     * @param code - source text.
     * @param language - language id.
     * @returns HTML safe for innerHTML.
     */
    function highlightCode(code, language) {
      const lang = String(language || "").toLowerCase();
      const state = { block: null, delimiter: null };
      return String(code == null ? "" : code)
        .split("\n")
        .map((line) => highlightLine(line, lang, state))
        .join("\n");
    }

    /** Map a fenced-code info string onto a highlighter language id. */
    function normalizeLanguage(info) {
      const raw = String(info || "").trim().toLowerCase().split(/[\s,{]/)[0];
      const alias = {
        py: "python", python3: "python", ipython: "python",
        js: "javascript", ts: "typescript", sh: "bash", shell: "bash",
        zsh: "bash", console: "bash", yml: "yaml",
      };
      return alias[raw] || raw;
    }

    /* ================================================================== *
    /* ================================================================== *
     * Math
     *
     * KaTeX, vendored. The shell ships no math typesetting of its own -- no
     * KaTeX or MathJax appears in any shipped client bundle -- and a client
     * bundle here may only require `react`, so the engine arrives compiled into
     * this file rather than as a module request.
     *
     * It is bundled instead of hand-rolled because drawn radicals and stacked
     * fractions only approximate math typesetting: real output needs KaTeX's
     * font metrics, italic correction, and per-glyph kerning.
     *
     * The build step is tools/build-client.mjs, which substitutes the compiled
     * engine below and appends its stylesheet with every woff2 font inlined as a
     * data URI, so the bundle stays self-contained and works offline.
     * ================================================================== */

    /**
     * The vendored engine, materialized by the build step.
     *
     * `new Function` is load-bearing, not stylistic. The compiled KaTeX is a UMD
     * bundle: it ends by assigning `module.exports`, so executing it directly in
     * this scope would overwrite this plugin's own exports and the row would
     * register no `apply`. Handing it a throwaway module record keeps the two
     * apart, and `exports` is passed as a parameter so the engine's own
     * `exports.x = ...` assignments reach that record as well.
     */
    const katex = (() => {
      const engineModule = { exports: {} };
      // eslint-disable-next-line no-new-func
      new Function("module", "exports", __KATEX_SOURCE__)(
        engineModule, engineModule.exports
      );
      return engineModule.exports;
    })();

    /**
     * Render one TeX expression to KaTeX's HTML.
     *
     * KaTeX throws on malformed input, and a notebook is data rather than
     * trusted source, so a failure falls back to the escaped TeX instead of
     * breaking the surrounding paragraph.
     *
     * @param tex - expression body, delimiters already stripped.
     * @param display - whether this is display math.
     * @returns HTML string.
     */
    function renderMath(tex, display) {
      const source = String(tex == null ? "" : tex);
      try {
        return katex.renderToString(source, {
          displayMode: !!display,
          throwOnError: true,
          output: "html",
          strict: false,
          trust: false,
        });
      } catch (error) {
        return (
          `<span class="dshnb-math-error" title="${esc(error && error.message)}">` +
          `${esc(source)}</span>`
        );
      }
    }

    /* ================================================================== *
     * Markdown subset
     * ================================================================== */

    const PLACEHOLDER = /\u0000(\d+)\u0000/g;

    /**
     * Render inline Markdown to HTML, protecting code spans and math first so
     * their contents are never reinterpreted as emphasis.
     * @param text - raw inline markdown.
     * @returns HTML string.
     */
    function renderInline(text) {
      const stash = [];
      const keep = (html) => {
        stash.push(html);
        return `\u0000${stash.length - 1}\u0000`;
      };

      let working = String(text == null ? "" : text);

      // Code spans win over math: `$x$` inside backticks stays literal.
      working = working.replace(/`([^`]+)`/g, (match, code) => keep(`<code>${esc(code)}</code>`));

      // Display math first, so `$$...$$` is not eaten by the inline rule.
      // KaTeX emits its own block wrapper for display mode; the span only
      // carries the block layout.
      working = working.replace(/\$\$([\s\S]+?)\$\$/g, (match, body) =>
        keep(`<span class="dshnb-math-display">${renderMath(body, true)}</span>`));
      working = working.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (match, body) =>
        keep(renderMath(body, false)));

      working = esc(working);

      working = working.replace(
        /\[([^\]]*)\]\(([^)\s]+)\)/g,
        (match, label, href) =>
          `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`
      );
      // Strong before emphasis. Emphasis needs a non-word boundary so that
      // identifiers such as log_10 are left alone.
      working = working.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      working = working.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      working = working.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");

      return working.replace(PLACEHOLDER, (match, index) => stash[Number(index)]);
    }

    /**
     * Render the Markdown subset notebooks use: headings, fenced code, lists,
     * blockquotes, thematic breaks, and paragraphs.
     * @param source - markdown text.
     * @param wrap - whether code blocks should wrap long lines.
     * @returns an array of React nodes.
     */
    function renderBlocks(source, wrap) {
      const lines = String(source == null ? "" : source).split(/\r?\n/);
      const nodes = [];
      let paragraph = [];
      let list = null;
      let quote = [];
      let inFence = false;
      let fence = [];
      let fenceLang = "";
      let key = 0;
      const nextKey = () => `md-${key++}`;

      const flushParagraph = () => {
        if (!paragraph.length) return;
        nodes.push(jsx("p", {
          dangerouslySetInnerHTML: { __html: renderInline(paragraph.join(" ")) },
        }, nextKey()));
        paragraph = [];
      };
      const flushList = () => {
        if (!list) return;
        nodes.push(jsx(list.tag, {
          children: list.items.map((item) =>
            jsx("li", { dangerouslySetInnerHTML: { __html: renderInline(item) } }, nextKey())),
        }, nextKey()));
        list = null;
      };
      const flushQuote = () => {
        if (!quote.length) return;
        nodes.push(jsx("blockquote", {
          dangerouslySetInnerHTML: { __html: renderInline(quote.join(" ")) },
        }, nextKey()));
        quote = [];
      };
      const flushFence = () => {
        const code = fence.join("\n");
        const lang = normalizeLanguage(fenceLang);
        // A fenced block becomes a real element carrying real highlighting
        // rather than text fed through the inline parser, which is what keeps
        // its colouring uniform.
        nodes.push(jsx("pre", {
          className: wrap ? "dshnb-hl dshnb-wrap" : "dshnb-hl",
          "data-lang": lang || void 0,
          dangerouslySetInnerHTML: {
            __html: lang ? highlightCode(code, lang) : esc(code),
          },
        }, nextKey()));
        fence = [];
        fenceLang = "";
      };
      const flushAll = () => {
        flushParagraph();
        flushList();
        flushQuote();
      };

      for (const line of lines) {
        const fenceStart = /^\s*(```|~~~)\s*([^\s`]*)/.exec(line);

        if (inFence) {
          if (/^\s*(```|~~~)\s*$/.test(line)) {
            inFence = false;
            flushFence();
          } else {
            fence.push(line);
          }
          continue;
        }
        if (fenceStart) {
          flushAll();
          inFence = true;
          fenceLang = fenceStart[2] || "";
          continue;
        }

        if (!line.trim()) {
          flushAll();
          continue;
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          flushAll();
          const level = heading[1].length;
          nodes.push(jsx(`h${level}`, {
            dangerouslySetInnerHTML: { __html: renderInline(heading[2]) },
          }, nextKey()));
          continue;
        }

        if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
          flushAll();
          nodes.push(jsx("hr", {}, nextKey()));
          continue;
        }

        const quoted = /^>\s?(.*)$/.exec(line);
        if (quoted) {
          flushParagraph();
          flushList();
          quote.push(quoted[1]);
          continue;
        }

        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
        const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (bullet || ordered) {
          flushParagraph();
          flushQuote();
          const tag = bullet ? "ul" : "ol";
          if (!list || list.tag !== tag) {
            flushList();
            list = { tag, items: [] };
          }
          list.items.push((bullet || ordered)[1]);
          continue;
        }

        flushList();
        flushQuote();
        paragraph.push(line.trim());
      }

      flushParagraph();
      flushList();
      flushQuote();
      if (inFence) flushFence();
      return nodes;
    }

    /* ================================================================== *
     * Images: zoom and save
     * ================================================================== */

    /**
     * Base name for a saved image, derived from the notebook it came from.
     * The notebook path arrives in the tab's resource address; a name that
     * cannot be recovered falls back to "notebook".
     * @param address - the tab's `dsh-resource://file/...` address.
     * @returns a filesystem-safe stem with no extension.
     */
    function notebookStem(address) {
      let last = String(address || "").split("/").pop() || "";
      try {
        last = decodeURIComponent(last);
      } catch (error) {
        // A malformed escape is not worth failing the render over.
        void error;
      }
      const stem = last.replace(/\.ipynb$/i, "").replace(/[^\w.-]+/g, "_");
      return stem || "notebook";
    }

    /** File extension for an image source, for building a save name. */
    function imageExtension(src) {
      const match = /^data:image\/([a-z0-9.+-]+)/i.exec(String(src || ""));
      const subtype = match ? match[1].toLowerCase() : "";
      if (subtype === "jpeg") return "jpg";
      if (subtype === "svg+xml") return "svg";
      return subtype || "png";
    }

    /**
     * Trigger the browser's save for one image.
     *
     * The GUI runs in a browser sandbox with no filesystem access and the
     * workspace service is read-only, so this hands the image to the host's
     * download handling: the location is chosen in the system save dialog.
     * @param src - data: URI of the image.
     * @param filename - suggested file name.
     */
    function saveImage(src, filename) {
      const anchor = document.createElement("a");
      anchor.href = src;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }

    /**
     * NOTE: there is deliberately no "open in a new tab" action.
     *
     * The host denies every renderer window open: the Electron main process
     * installs `setWindowOpenHandler(() => ({ action: "deny" }))` on the
     * application window and the account window, while the sidebar view's
     * handler forwards only `https:` URLs to `shell.openExternal` and denies the
     * rest. `will-navigate` is likewise restricted to the app's own origin. A
     * `blob:`, `data:`, or `file:` image URL is therefore dropped by design, and
     * `window.open` returns null while the anchor fallback is denied the same
     * way. Reaching a separate window for an image needs a host-side capability
     * (write to a temp file, then hand the path to the OS), not a renderer call.
     */

    // The lightbox lives at module scope rather than in props so that any image
    // in the notebook -- an output figure or one inside Markdown -- opens it
    // without threading a callback down every component.
    let imageViewer = null;

    // Test seam: the live zoom entry point, so a harness can drive zoom without
    // depending on synthetic event plumbing.
    let zoomHook = null;

    /**
     * Open one image, if a lightbox is mounted.
     * @param src - data: URI of the image.
     * @param filename - suggested save name.
     */
    function openImage(src, filename) {
      if (imageViewer) imageViewer({ src, filename });
    }

    /**
     * Translation that keeps one image point under the pointer while zooming.
     *
     * Retained only for the `transform`-based arithmetic it documents; the
     * lightbox itself resizes by layout width instead, because a wrong transform
     * can move content off-screen while a wrong width cannot.
     *
     * @param offset - current translation.
     * @param point - the anchored point in the untransformed frame.
     * @param current - scale before the change.
     * @param next - scale after it.
     * @returns the new translation.
     */
    function zoomTranslation(offset, point, current, next) {
      return {
        x: offset.x + point.x * (current - next),
        y: offset.y + point.y * (current - next),
      };
    }

    /**
     * The largest aspect-preserving box that fits inside the available space,
     * never upscaling past the image's own pixels.
     *
     * Both dimensions come from here, which is what makes the zoom readout
     * honest: scaling one dimension and letting CSS clamp the other is how the
     * picture stops growing while the percentage keeps climbing.
     *
     * @param natural - the image's intrinsic size.
     * @param available - the space the stage can offer.
     * @returns the fitted size in CSS pixels.
     */
    function fitBox(natural, available) {
      const width = Math.max(0, Number(natural.width) || 0);
      const height = Math.max(0, Number(natural.height) || 0);
      if (!width || !height) return null;
      const ratio = Math.min(
        Math.max(1, available.width) / width,
        Math.max(1, available.height) / height,
        1
      );
      return { width: width * ratio, height: height * ratio };
    }

    /** Keep a number inside an inclusive range. */
    function clamp(value, low, high) {
      return value < low ? low : value > high ? high : value;
    }

    /**
     * Scroll offsets that hold one image point under the pointer across a resize.
     *
     * Zoom changes the image's *layout* size, so the pan position is a scroll
     * offset rather than a transform. A point at `point` px inside the image has
     * a viewport position of `point * scale - scroll`; requiring that to be
     * unchanged gives the offset below.
     *
     * @param view - scroll offset before the change.
     * @param point - anchored point in the image's own pixels.
     * @param current - scale before.
     * @param next - scale after.
     * @returns the scroll offset to apply.
     */
    function zoomScroll(view, point, current, next) {
      return {
        left: point.x * next - (point.x * current - view.left),
        top: point.y * next - (point.y * current - view.top),
      };
    }

    // Zoom is continuous rather than a fixed fit/actual pair: the wheel, the
    // +/- buttons and the keyboard all move the same scale factor, so a figure
    // can be taken to exactly the magnification a reader wants.
    const ZOOM_MIN = 1;      // 1 is fit-to-viewport
    const ZOOM_MAX = 12;     // 1200%
    const ZOOM_STEP = 1.25;  // one click of + or -

    /**
     * One zoomed image: continuous zoom, drag to pan, save, close.
     *
     * Zoom changes the image's layout width rather than applying a transform.
     * That keeps three things simple and robust: the stage's ordinary scrolling
     * *is* the pan, a bad zoom level can only make the image the wrong size
     * (never move it out of sight), and the anchored-zoom arithmetic is exact,
     * because layout geometry needs no correction for an existing transform.
     */
    function ImageLightbox() {
      // Every hook is declared here, before the early return below. A hook after
      // that return registers on some renders and not others, and React then
      // fails with "Rendered more hooks than during the previous render" and
      // tears down the subtree -- which blanks the whole preview pane rather
      // than just this overlay.
      const [image, setImage] = React.useState(null);
      const [scale, setScale] = React.useState(1);
      const [dragging, setDragging] = React.useState(false);
      const [fit, setFit] = React.useState(null);
      const stageRef = React.useRef(null);
      const imgRef = React.useRef(null);
      const drag = React.useRef(null);
      // The zoom factor is also kept in a ref: the anchor arithmetic needs the
      // current scale synchronously, and a state updater may not run in time.
      const scaleRef = React.useRef(1);
      // Mirror of `fit`, readable synchronously by the zoom handlers.
      const fitRef = React.useRef(null);

      React.useEffect(() => {
        imageViewer = setImage;
        return () => {
          if (imageViewer === setImage) imageViewer = null;
        };
      }, []);

      /**
       * The largest box that fits the stage *and* preserves the aspect ratio.
       *
       * Deriving both dimensions is what makes the zoom percentage exact. Basing
       * the width on the stage alone and letting a `max-height` clamp the result
       * makes the picture stop growing well before the number says so, which is
       * the fault this replaced.
       *
       * @returns the fitted { width, height }, or null when not measurable yet.
       */
      const measureFit = React.useCallback(() => {
        const stage = stageRef.current;
        const node = imgRef.current;
        if (!stage || !node) return null;
        const box = stage.getBoundingClientRect();
        return fitBox(
          { width: node.naturalWidth || 0, height: node.naturalHeight || 0 },
          { width: box.width - 32, height: box.height - 32 }
        );
      }, []);

      const refit = React.useCallback(() => {
        setFit(measureFit());
      }, [measureFit]);

      // A freshly opened image starts fitted, and the fit base is re-measured on
      // a resize so it never goes stale.
      React.useEffect(() => {
        setScale(1);
        scaleRef.current = 1;
        setDragging(false);
        setFit(null);
        const stage = stageRef.current;
        if (stage) {
          stage.scrollLeft = 0;
          stage.scrollTop = 0;
        }
        refit();
      }, [image, refit]);

      React.useEffect(() => {
        if (!image) return void 0;
        const onResize = () => refit();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, [image, refit]);

      /**
       * Scroll offsets that hold one image point under the pointer.
       *
       * Returns null when the geometry cannot support an anchored zoom -- no
       * stage, no element box, or a box that has not been laid out yet. The
       * caller then zooms without anchoring rather than feeding a non-finite
       * point into the scroll arithmetic.
       *
       * @param node - the image element.
       * @param clientX - pointer x in viewport coordinates, or null.
       * @param clientY - pointer y in viewport coordinates, or null.
       * @param current - scale before the change.
       * @param next - scale after it.
       * @returns the scroll offset to apply, or null to skip anchoring.
       */
      const anchorScroll = (node, clientX, clientY, current, next) => {
        const stage = stageRef.current;
        if (!stage || !node || clientX == null || clientY == null) return null;
        const box = node.getBoundingClientRect();
        if (!box || !(box.width > 0) || !(box.height > 0)) return null;
        const point = {
          x: (clientX - box.left) / current,
          y: (clientY - box.top) / current,
        };
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        return zoomScroll(
          { left: stage.scrollLeft, top: stage.scrollTop },
          point,
          current,
          next
        );
      };

      /** Apply a zoom step, optionally re-anchoring the scroll afterwards. */
      const applyZoom = React.useCallback((factor, target) => {
        setScale((current) => {
          const next = clamp(current * factor, ZOOM_MIN, ZOOM_MAX);
          if (next !== current) scaleRef.current = next;
          return next;
        });
        if (target) {
          // Apply after the browser reflows to the new size, or the scroll
          // would be clamped against the old, smaller scroll extent.
          requestAnimationFrame(() => {
            const stage = stageRef.current;
            if (!stage) return;
            stage.scrollLeft = target.left;
            stage.scrollTop = target.top;
          });
        }
      }, []);

      // Wheel zoom is anchored to the pointer, which needs the element's
      // viewport box. That resolution happens outside the state updater, so a
      // geometry problem can never decide *whether* the zoom happens.
      const zoomFromPointer = React.useCallback(
        (factor, clientX, clientY) => {
          const target = anchorScroll(
            imgRef.current,
            clientX,
            clientY,
            scaleRef.current,
            clamp(scaleRef.current * factor, ZOOM_MIN, ZOOM_MAX)
          );
          applyZoom(factor, target);
        },
        [applyZoom, anchorScroll]
      );

      /**
       * Zoom about the middle of the *image*, for the buttons and the keyboard.
       *
       * The anchor is derived from the scroll offsets and the fitted size, so it
       * needs no layout measurement at all. The pointer-anchored path reads
       * `getBoundingClientRect()`, which is the one thing a host can report
       * unexpectedly; keeping it off the button path means the buttons cannot be
       * disabled by a geometry quirk.
       */
      const zoomCentre = (factor) => {
        const stage = stageRef.current;
        const current = scaleRef.current;
        const next = clamp(current * factor, ZOOM_MIN, ZOOM_MAX);
        if (next === current) return;
        if (!stage) {
          applyZoom(factor, null);
          return;
        }
        // The stage's padding is symmetric, so the visible middle in image
        // pixels is the scroll offset plus half the visible span.
        const base = fitRef.current;
        const spanX = stage.clientWidth || (base ? base.width * current : 0);
        const spanY = stage.clientHeight || (base ? base.height * current : 0);
        const point = {
          x: (stage.scrollLeft + spanX / 2) / current,
          y: (stage.scrollTop + spanY / 2) / current,
        };
        const target =
          Number.isFinite(point.x) && Number.isFinite(point.y) && spanX > 0 && spanY > 0
            ? zoomScroll(
                { left: stage.scrollLeft, top: stage.scrollTop },
                point,
                current,
                next
              )
            : null;
        applyZoom(factor, target);
      };

      zoomHook = zoomFromPointer;

      const resetFit = () => {
        setScale(1);
        scaleRef.current = 1;
        const stage = stageRef.current;
        if (stage) {
          stage.scrollLeft = 0;
          stage.scrollTop = 0;
        }
      };

      React.useEffect(() => {
        if (!image) return void 0;
        const onKey = (event) => {
          if (event.key === "Escape") setImage(null);
          else if (event.key === "+" || event.key === "=") zoomCentre(ZOOM_STEP);
          else if (event.key === "-" || event.key === "_") zoomCentre(1 / ZOOM_STEP);
          else if (event.key === "0") resetFit();
        };
        // On window rather than document: a host that stops propagation before
        // the document never reaches a document-level listener, and this path is
        // the fallback when the bar's buttons are not receiving presses.
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
      }, [image]);

      if (!image) return null;

      const close = () => setImage(null);

      // A wheel event must be non-passive to cancel the page scroll it would
      // otherwise cause; React's synthetic handler cannot express that, so the
      // listener is attached directly.
      const onWheel = (event) => {
        event.preventDefault();
        zoomFromPointer(
          event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
          event.clientX,
          event.clientY
        );
      };
      const attachWheel = (node) => {
        stageRef.current = node;
        if (!node) return;
        if (node.__dshWheel) node.removeEventListener("wheel", node.__dshWheel);
        node.__dshWheel = onWheel;
        node.addEventListener("wheel", onWheel, { passive: false });
      };

      // Panning: the pointer drags the image, so the scroll offset follows it.
      const onPointerDown = (event) => {
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          left: stageRef.current ? stageRef.current.scrollLeft : 0,
          top: stageRef.current ? stageRef.current.scrollTop : 0,
          moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      };
      const onPointerMove = (event) => {
        const state = drag.current;
        const stage = stageRef.current;
        if (!state || !stage) return;
        const dx = event.clientX - state.x;
        const dy = event.clientY - state.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.moved = true;
        stage.scrollLeft = state.left - dx;
        stage.scrollTop = state.top - dy;
      };
      const endDrag = (event) => {
        const state = drag.current;
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        // A press that never moved is a click on the backdrop, not a pan.
        if (state && !state.moved && event.target === event.currentTarget) close();
      };

      const percent = Math.round(scale * 100);
      // The bar's controls must not take part in the stage's pan gesture. Pointer
      // events are stopped here as well as clicked, so a press that begins on a
      // button can never be interpreted as the start of a drag.
      const stopPointer = (event) => event.stopPropagation();
      const button = (label, title, onClick, aria) =>
        jsx("button", {
          type: "button",
          className: "dshnb-lightbox-btn",
          title,
          "aria-label": aria || title,
          onPointerDown: stopPointer,
          onPointerMove: stopPointer,
          onPointerUp: stopPointer,
          onDoubleClick: stopPointer,
          onClick,
          children: label,
        });

      return jsxs("div", {
        className: "dshnb-lightbox",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": image.filename,
        children: [
          jsxs("div", {
            className: "dshnb-lightbox-bar",
            children: [
              jsx("span", { className: "dshnb-lightbox-name", children: image.filename }),
              jsx("span", { className: "dshnb-zoom-group", children: [
                button("\u2212", "Zoom out ( - )", () => zoomCentre(1 / ZOOM_STEP), "Zoom out"),
                jsx("span", {
                  className: "dshnb-zoom-value",
                  title: "Reset to fit ( 0 )",
                  onClick: resetFit,
                  children: `${percent}%`,
                }),
                button("+", "Zoom in ( + )", () => zoomCentre(ZOOM_STEP), "Zoom in"),
                button("Fit", "Reset to fit ( 0 )", resetFit),
              ] }),
              button("Save image", "Save this image", () =>
                saveImage(image.src, image.filename)),
              button("\u00d7", "Close ( Esc )", close, "Close"),
            ],
          }),
          jsx("div", {
            ref: attachWheel,
            className: dragging
              ? "dshnb-lightbox-stage dshnb-lightbox-dragging"
              : "dshnb-lightbox-stage",
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            children: jsx("img", {
              ref: imgRef,
              className: "dshnb-lightbox-img",
              // The one place zoom is expressed: both layout dimensions scaled
              // from the fitted box, so the picture size and the displayed
              // percentage always agree. No max-width/max-height may constrain
              // this, or the browser would silently clamp the result.
              style: fit
                ? {
                    width: `${Math.round(fit.width * scale)}px`,
                    height: `${Math.round(fit.height * scale)}px`,
                  }
                : // Held back for the one frame before the fit is measured, so
                  // the picture never paints at its raw size first.
                  { visibility: "hidden" },
              src: image.src,
              alt: image.filename,
              draggable: false,
              // A late-decoding image has no intrinsic size at first paint, so
              // the fit is measured once the dimensions are known.
              onLoad: refit,
              onDoubleClick: (event) => {
                event.stopPropagation();
                if (scale > 1) resetFit();
                else zoomFromPointer(2, event.clientX, event.clientY);
              },
            }),
          }),
          jsx("div", {
            className: "dshnb-lightbox-hint",
            children: "Scroll or + / \u2212 to zoom \u00b7 drag to pan \u00b7 0 to fit \u00b7 Esc to close",
          }),
        ],
      });
    }

    /** An output figure with hover actions. */
    function Figure({ src, filename }) {
      const open = () => openImage(src, filename);
      return jsxs("div", {
        className: "dshnb-figure",
        children: [
          jsx("img", {
            className: "dshnb-img",
            src,
            alt: filename,
            title: "Click to zoom",
            onClick: open,
          }),
          jsxs("div", {
            className: "dshnb-figure-actions",
            children: [
              jsx("button", {
                type: "button",
                className: "dshnb-figure-btn",
                title: "Zoom",
                onClick: open,
                children: "Zoom",
              }),
              jsx("button", {
                type: "button",
                className: "dshnb-figure-btn",
                title: "Save this image",
                onClick: () => saveImage(src, filename),
                children: "Save",
              }),
            ],
          }),
        ],
      });
    }

    /* ================================================================== *
     * Notebook parsing
     * ================================================================== */

    /** Join a nbformat field that may be a string or a list of lines. */
    function joinSource(value) {
      if (value == null) return "";
      return Array.isArray(value) ? value.join("") : String(value);
    }

    /**
     * Parse notebook JSON without throwing.
     * @returns a normalized notebook, or an `error` message for the viewer.
     */
    function parseNotebook(text) {
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        return { error: `not valid JSON (${error.message})` };
      }
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.cells)) {
        return { error: "no 'cells' array, so this is not a notebook document" };
      }
      const meta = raw.metadata || {};
      const kernelSpec = meta.kernelspec || {};
      const langInfo = meta.language_info || {};
      return {
        nbformat: raw.nbformat,
        nbformatMinor: raw.nbformat_minor,
        kernel: kernelSpec.display_name || kernelSpec.name || langInfo.name || null,
        language: langInfo.name || "python",
        cells: raw.cells.map((cell) => ({
          cellType: cell.cell_type || "unknown",
          executionCount: cell.execution_count == null ? null : cell.execution_count,
          source: joinSource(cell.source),
          outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
        })),
      };
    }

    /* ================================================================== *
     * Styles
     * ================================================================== */

    const CSS = `
/* Colours are inherited from the host rather than hardcoded: the app's design
   tokens are not a published contract, and a guessed fallback colour renders
   ordinary text invisible in the opposite theme. Fills and borders use
   currentColor so they follow the active theme automatically. */
.dshnb { font-size: 13px; line-height: 1.6; padding: 12px 16px 48px; max-width: 1100px;
  color: inherit; }
.dshnb-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline;
  margin: 2px 0 14px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(128,128,128,.28);
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
.dshnb-title { font-weight: 600; font-size: 14px; }
.dshnb-meta { opacity: .65; font-size: 12px; }
.dshnb-cell { margin: 0 0 14px; }
.dshnb-bar { display: flex; align-items: center; gap: 8px; font-size: 11px;
  text-transform: uppercase; letter-spacing: .06em; opacity: .5; margin-bottom: 4px; }
.dshnb-run { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  text-transform: none; letter-spacing: 0; opacity: .85; }

/* ---- markdown ---- */
.dshnb-md { font-size: 13.5px; }
.dshnb-md h1, .dshnb-md h2, .dshnb-md h3, .dshnb-md h4, .dshnb-md h5, .dshnb-md h6
  { margin: .8em 0 .4em; line-height: 1.25; font-weight: 700; }
.dshnb-md h1 { font-size: 1.5em; } .dshnb-md h2 { font-size: 1.3em; }
.dshnb-md h3 { font-size: 1.13em; }
.dshnb-md p { margin: .55em 0; }
.dshnb-md ul, .dshnb-md ol { margin: .55em 0; padding-left: 1.6em; }
.dshnb-md li { margin: .25em 0; }
/* Strong has to out-weigh body text visibly; a plain 700 in a monospace-ish
   UI font is easy to miss, so it also lifts to full contrast. */
.dshnb-md strong { font-weight: 700; color: currentColor; }
.dshnb-md em { font-style: italic; }
.dshnb-md code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: .9em; background: rgba(128,128,128,.18);
  background: color-mix(in srgb, currentColor 14%, transparent);
  padding: 1px 4px; border-radius: 3px; }
.dshnb-md pre { background: rgba(128,128,128,.14);
  background: color-mix(in srgb, currentColor 8%, transparent); padding: 10px;
  border-radius: 6px; overflow-x: auto; }
.dshnb-md pre code { background: none; padding: 0; }
.dshnb-md pre.dshnb-hl { background: rgba(128,128,128,.14);
  background: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid rgba(128,128,128,.30);
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  margin: .6em 0; font-size: 12.5px; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshnb-md blockquote { margin: .55em 0; padding-left: 12px;
  border-left: 3px solid rgba(128,128,128,.45);
  border-left: 3px solid color-mix(in srgb, currentColor 28%, transparent); opacity: .9; }
.dshnb-md hr { border: none; border-top: 1px solid rgba(128,128,128,.30);
  border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  margin: 1em 0; }
.dshnb-md a { color: inherit; text-decoration: underline; }

/* ---- math ----
   The KaTeX stylesheet, with every woff2 font inlined as a data URI. It is
   injected verbatim at build time; see tools/build-client.mjs. */
__KATEX_CSS__

/* Display math keeps KaTeX's own block layout; this only adds surrounding space
   and lets an over-wide expression scroll instead of overflowing the pane. */
.dshnb-math-display { display: block; margin: .8em 0; overflow-x: auto;
  overflow-y: hidden; }
/* Inline math must never be broken across two lines. */
.dshnb-md .katex { white-space: nowrap; }
/* A TeX expression KaTeX refused: show the source so it stays readable. */
.dshnb-math-error { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: .92em; color: #c1443c; cursor: help; }

/* ---- code cells ---- */
.dshnb-code { background: rgba(128,128,128,.14);
  background: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid rgba(128,128,128,.30);
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  border-radius: 6px; padding: 9px 11px; overflow-x: auto; margin: 0; white-space: pre;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px;
  line-height: 1.5; }
.dshnb-code.dshnb-wrap { white-space: pre-wrap; word-break: break-word; }
/* No base colour: untokenized characters (=, ;, ---, whitespace) must inherit
   the host's text colour, or they vanish against the opposite theme.
   No color-scheme declaration either, so light-dark() follows the host. Each
   declaration's literal fallback is the DARK variant: a light theme showing dark
   tokens stays readable, the reverse does not. */
.dshnb-hl {
  --tk-kw: #c678dd;    --tk-kw: light-dark(#a626a4, #c678dd);
  --tk-str: #98c379;   --tk-str: light-dark(#50a14f, #98c379);
  --tk-num: #d19a66;   --tk-num: light-dark(#986801, #d19a66);
  --tk-cmt: #7f848e;   --tk-cmt: light-dark(#8c9199, #7f848e);
  --tk-fn: #61afef;    --tk-fn: light-dark(#4078f2, #61afef);
  --tk-bi: #e5c07b;    --tk-bi: light-dark(#c18401, #e5c07b);
  --tk-const: #d19a66; --tk-const: light-dark(#986801, #d19a66);
  --tk-dec: #e5c07b;   --tk-dec: light-dark(#c18401, #e5c07b);
  --tk-def: #61afef;   --tk-def: light-dark(#4078f2, #61afef);
  --tk-key: #e06c75;   --tk-key: light-dark(#e45649, #e06c75);
}
.dshnb-hl .tok-kw { color: var(--tk-kw); font-weight: 600; }
.dshnb-hl .tok-str { color: var(--tk-str); }
.dshnb-hl .tok-num { color: var(--tk-num); }
.dshnb-hl .tok-cmt { color: var(--tk-cmt); font-style: italic; }
.dshnb-hl .tok-fn { color: var(--tk-fn); }
.dshnb-hl .tok-bi { color: var(--tk-bi); }
.dshnb-hl .tok-const { color: var(--tk-const); }
.dshnb-hl .tok-dec { color: var(--tk-dec); }
.dshnb-hl .tok-def { color: var(--tk-def); font-weight: 600; }
.dshnb-hl .tok-key { color: var(--tk-key); }
/* Identifiers stay at the host's text colour, so ordinary code reads normally. */
.dshnb-hl .tok-ident { color: inherit; }

/* ---- outputs ---- */
.dshnb-outs { margin-top: 8px; border-left: 3px solid rgba(128,128,128,.40);
  border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  padding-left: 11px; }
.dshnb-out { margin: 0 0 7px; }
.dshnb-out:last-child { margin-bottom: 0; }
.dshnb-stream, .dshnb-result { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px; line-height: 1.5; margin: 0; white-space: pre-wrap; word-break: break-word; }
.dshnb-stderr { opacity: .72; font-style: italic; }
.dshnb-err { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px;
  line-height: 1.5; margin: 0; white-space: pre-wrap; word-break: break-word;
  background: rgba(200,60,60,.12); border: 1px solid rgba(200,60,60,.42);
  border-radius: 6px; padding: 8px 10px; }
.dshnb-img { max-width: 100%; height: auto; border-radius: 6px; background: #fff;
  padding: 4px; border: 1px solid rgba(128,128,128,.30);
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }

/* ---- figures: zoom, save, open ---- */
.dshnb-figure { position: relative; display: inline-block; max-width: 100%; }
.dshnb-figure > .dshnb-img { cursor: zoom-in; display: block; }
.dshnb-figure-actions { position: absolute; top: 10px; right: 10px; display: flex;
  gap: 4px; opacity: 0; transition: opacity .12s ease-in-out; }
/* Reveal on hover or when the buttons themselves hold focus, so the actions stay
   reachable by keyboard. */
.dshnb-figure:hover .dshnb-figure-actions,
.dshnb-figure:focus-within .dshnb-figure-actions { opacity: 1; }
/* Hit targets are deliberately generous: the earlier 11px / 5px-8px controls
   were about 24x20 CSS px, which is easy to miss and makes a control read as
   dead when a press lands a few pixels off. */
.dshnb-figure-btn, .dshnb-lightbox-btn { font: inherit; font-size: 13px;
  line-height: 1; padding: 9px 14px; min-width: 46px; min-height: 34px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px; cursor: pointer;
  color: inherit; border: 1px solid rgba(128,128,128,.45);
  background: rgba(20,20,20,.72); backdrop-filter: blur(3px); }
.dshnb-figure-btn:hover, .dshnb-lightbox-btn:hover { background: rgba(20,20,20,.92); }
.dshnb-figure-btn:active, .dshnb-lightbox-btn:active { background: rgba(90,90,100,.95); }

.dshnb-lightbox { position: fixed; inset: 0; display: flex;
  flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; background: rgba(8,8,10,.92);
  /* Above any host layer. A fixed application header carries its own stacking
     order, and at a merely "large" value it overlays this dialog and swallows
     presses aimed at the bar -- which reads as buttons that do not respond. */
  z-index: 2147483000;
  /* A second, independent defence: keep the bar clear of a host header too. */
  padding: 72px 20px 24px; }
.dshnb-lightbox-bar { position: relative; z-index: 2; display: flex; flex-wrap: wrap; align-items: center;
  justify-content: center; gap: 8px; max-width: 100%; color: #f2f2f2; }
.dshnb-lightbox-name { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px; opacity: .8; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 40vw; }
.dshnb-zoom-group { display: inline-flex; align-items: center; gap: 2px;
  border: 1px solid rgba(128,128,128,.45); border-radius: 6px; overflow: hidden; }
.dshnb-zoom-group .dshnb-lightbox-btn { border: none; border-radius: 0; }
.dshnb-zoom-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px; min-width: 64px; min-height: 34px; display: inline-flex;
  align-items: center; justify-content: center; text-align: center;
  opacity: .9; cursor: pointer; user-select: none; }
/* The stage owns the scroll offset, so panning is ordinary scrolling. It is not
   a flex container: centring the child with justify-content would put the
   overflow of an oversized child beyond the scrollport's start edge, where it
   cannot be reached. The child's own auto margins centre it while it fits and
   fall to zero when it does not, keeping every part of a zoomed image
   reachable. */
.dshnb-lightbox-stage { flex: 1 1 auto; min-height: 0; align-self: stretch;
  overflow: auto; cursor: grab; padding: 16px; }
.dshnb-lightbox-dragging { cursor: grabbing; user-select: none; }
.dshnb-lightbox-stage::-webkit-scrollbar { width: 10px; height: 10px; }
/* No max-width/max-height here: the component computes both dimensions from the
   fitted box, and a constraint would clamp them behind the zoom readout's back.
   Neither dimension is automatic either, so the aspect ratio comes from the
   component rather than fighting it. */
.dshnb-lightbox-img { display: block; border-radius: 6px; background: #fff;
  box-shadow: 0 12px 48px rgba(0,0,0,.5); -webkit-user-drag: none;
  margin: auto; }
.dshnb-keyhint { flex-basis: 100%; font-size: 11px; opacity: .6;
  text-align: center; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshnb-lightbox-hint { font-size: 11px; opacity: .55; color: #f2f2f2;
  text-align: center; }
.dshnb-html { max-width: 100%; overflow-x: auto; }
.dshnb-empty { opacity: .6; font-size: 13px; }
.dshnb-note { opacity: .6; font-size: 12px; margin-top: 18px; }
`;

    if (typeof document !== "undefined" && !document.querySelector("style[data-dsh-ipynb]")) {
      const tag = document.createElement("style");
      tag.setAttribute("data-dsh-ipynb", "");
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /* ================================================================== *
     * Presentation
     * ================================================================== */

    /** One rendered output entry. */
    function OutputView({ output, stem, cellIndex, outIndex }) {
      const data = output.data || {};
      const type = output.output_type;
      /** Suggested file name for an image emitted by this output. */
      const figureName = (extension) =>
        `${stem}-cell${cellIndex + 1}-out${outIndex + 1}.${extension}`;

      if (type === "stream") {
        const isErr = output.name === "stderr";
        return jsx("div", {
          className: "dshnb-out",
          children: jsx("pre", {
            className: isErr ? "dshnb-stream dshnb-stderr" : "dshnb-stream",
            children: joinSource(output.text),
          }),
        });
      }

      if (type === "error") {
        const traceback = Array.isArray(output.traceback) ? output.traceback : [];
        const body = traceback.length
          ? traceback.join("\n").replace(/\u001b\[[0-9;]*m/g, "")
          : `${output.ename || "Error"}: ${output.evalue || ""}`;
        return jsx("div", {
          className: "dshnb-out",
          children: jsx("pre", { className: "dshnb-err", children: body }),
        });
      }

      if (type === "display_data" || type === "execute_result") {
        // Images before text: a published figure also carries text/plain.
        if (typeof data["image/png"] === "string") {
          return jsx("div", {
            className: "dshnb-out",
            children: jsx(Figure, {
              src: "data:image/png;base64," + data["image/png"],
              filename: figureName("png"),
            }),
          });
        }
        if (typeof data["image/jpeg"] === "string") {
          return jsx("div", {
            className: "dshnb-out",
            children: jsx(Figure, {
              src: "data:image/jpeg;base64," + data["image/jpeg"],
              filename: figureName("jpg"),
            }),
          });
        }
        if (typeof data["image/svg+xml"] === "string") {
          // An SVG output is markup, not a bitmap; it cannot be saved or opened
          // as an image file from a data URI, so it stays inline.
          return jsx("div", {
            className: "dshnb-out dshnb-html",
            dangerouslySetInnerHTML: { __html: joinSource(data["image/svg+xml"]) },
          });
        }
        if (typeof data["text/html"] === "string") {
          return jsx("div", {
            className: "dshnb-out dshnb-html",
            dangerouslySetInnerHTML: { __html: joinSource(data["text/html"]) },
          });
        }
        if (data["text/plain"] != null) {
          return jsx("div", {
            className: "dshnb-out",
            children: jsx("pre", {
              className: "dshnb-result", children: joinSource(data["text/plain"]),
            }),
          });
        }
        return jsx("div", {
          className: "dshnb-out dshnb-empty",
          children: `[${Object.keys(data).join(", ") || "empty output"}]`,
        });
      }

      return jsx("div", {
        className: "dshnb-out dshnb-empty",
        children: `[${type || "unknown"} output]`,
      });
    }

    /** One notebook cell. */
    function CellView({ cell, language, wrap, stem, cellIndex }) {
      if (cell.cellType === "markdown" || cell.cellType === "raw") {
        return jsx("div", {
          className: "dshnb-cell",
          children: jsx("div", {
            className: "dshnb-md", children: renderBlocks(cell.source, wrap),
          }),
        });
      }

      const outputs = cell.outputs || [];
      return jsxs("div", {
        className: "dshnb-cell",
        children: [
          jsxs("div", {
            className: "dshnb-bar",
            children: [
              jsx("span", { children: "In" }),
              jsx("span", {
                className: "dshnb-run",
                children: cell.executionCount == null ? "[ ]" : `[${cell.executionCount}]`,
              }),
            ],
          }),
          jsx("pre", {
            className: wrap ? "dshnb-code dshnb-hl dshnb-wrap" : "dshnb-code dshnb-hl",
            "data-lang": language || "python",
            dangerouslySetInnerHTML: {
              __html: highlightCode(cell.source, language || "python"),
            },
          }),
          outputs.length
            ? jsx("div", {
                className: "dshnb-outs",
                children: outputs.map((output, i) =>
                  jsx(OutputView, { output, stem, cellIndex, outIndex: i }, i)),
              })
            : null,
        ],
      });
    }

    /** The document body the preview owner renders for `.ipynb`. */
    function NotebookBody(props) {
      const content = props.content;
      const isBytes = content && content.kind === "bytes";
      const text = isBytes ? new TextDecoder("utf-8").decode(content.data) : "";
      const notebook = React.useMemo(
        () => (isBytes ? parseNotebook(text) : null), [isBytes, text]
      );

      if (!isBytes) {
        return jsx("div", {
          className: "dshnb-empty", style: { padding: "16px" },
          children: "Loading notebook\u2026",
        });
      }

      if (notebook.error) {
        return jsxs("div", {
          style: { padding: "16px" },
          children: [
            jsx("div", {
              className: "dshnb-err",
              children: `Cannot render this notebook: ${notebook.error}.`,
            }),
            jsx("div", {
              className: "dshnb-note",
              children: "Use the renderer dropdown in the preview toolbar to read the raw file.",
            }),
          ],
        });
      }

      const codeCells = notebook.cells.filter((c) => c.cellType === "code").length;
      const stem = notebookStem(props.resourceAddress);
      // Markdown can carry images too; delegate clicks on them to the lightbox
      // so one gesture works everywhere, including inside the HTML the Markdown
      // subset renders through innerHTML where no handler can be attached.
      const onMarkdownClick = (event) => {
        const target = event.target;
        if (!target || target.tagName !== "IMG") return;
        const src = target.currentSrc || target.src;
        if (!src) return;
        openImage(src, `${stem}-image.${imageExtension(src)}`);
      };

      return jsxs("div", {
        className: "dshnb",
        onClick: onMarkdownClick,
        children: [
          jsxs("div", {
            className: "dshnb-head",
            children: [
              jsx("span", { className: "dshnb-title", children: "Jupyter notebook" }),
              jsx("span", {
                className: "dshnb-meta",
                children: `${notebook.cells.length} cells \u00b7 ${codeCells} code`,
              }),
              notebook.kernel
                ? jsx("span", { className: "dshnb-meta", children: `kernel: ${notebook.kernel}` })
                : null,
              notebook.nbformat != null
                ? jsx("span", {
                    className: "dshnb-meta",
                    children: `nbformat ${notebook.nbformat}.${notebook.nbformatMinor ?? 0}`,
                  })
                : null,
            ],
          }),
          ...notebook.cells.map((cell, i) =>
            jsx(CellView, {
              cell,
              language: notebook.language,
              wrap: !!props.wrap,
              stem,
              cellIndex: i,
            }, i)
          ),
          jsx(ImageLightbox, {}),
        ],
      });
    }

    /* ================================================================== *
     * Plugin
     * ================================================================== */

    // Bare browser services this plugin needs; resolved from the client
    // context, so no client-module dependency is introduced.
    const inject = ["slots", "documentPreviews"];

    function apply(ctx) {
      ctx.effect(
        () => ctx.documentPreviews.register({
          id: ID,
          extensions: ["ipynb"],
          // External band: outranks the builtin plain-text fallback.
          priority: "extension",
          title: () => "Notebook",
          // A notebook is JSON, so it cannot be parsed from a text prefix:
          // the owner must deliver the complete file.
          loading: "bytes-complete",
          // Publish the toolbar's wrap toggle: source lines are long.
          wrap: true,
        }),
        "dsh-ipynb-preview: definition"
      );

      ctx.effect(
        () => ctx.slots.register({ name: "sidebar.right.tab.document", key: ID }, NotebookBody),
        "dsh-ipynb-preview: body"
      );
    }

    exports.apply = apply;
    exports.inject = inject;

    // Test seam: exposed only when the host sets the flag, so production
    // materialization carries exactly `apply` and `inject`.
    if (typeof globalThis !== "undefined" && globalThis.__DSH_IPYNB_TEST__) {
      exports.__test__ = {
        parseNotebook, renderBlocks, renderInline, renderMath, NotebookBody,
        highlightCode, highlightLine, normalizeLanguage, css: CSS,
        notebookStem, imageExtension, Figure, ImageLightbox, openImage, clamp, fitBox,
        getZoom: () => zoomHook,
        zoomTranslation, zoomScroll, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP,
      };
    }
    return module.exports;
  },
});
