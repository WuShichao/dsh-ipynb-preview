/**
 * Build a standalone page that runs the real plugin bundle in a real browser.
 *
 * The Node mount harness cannot exercise React's click handling, which is
 * exactly the seam the lightbox controls live behind. This page supplies the
 * same module-loader facade the shell does, renders one notebook with a figure
 * output, and writes every interaction into a visible on-page log.
 *
 * Usage:  node tests/make-page.mjs [out.html]
 *
 * Open the result in any browser, then click "Open the lightbox" and press every
 * control; each interaction is written to the page. Append `?auto=1` (or
 * `#auto`) and the page drives itself instead, which is what a headless run
 * reads back. It needs network access for React from a CDN.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, "..", "lib", "client.js");
const OUT = process.argv[2] || join(here, "..", "test-page.html");

const bundle = readFileSync(BUNDLE, "utf8");
if (bundle.includes("</script")) {
  console.error("refusing to build: the bundle contains a </script> sequence");
  process.exit(1);
}

// A vector figure keeps the page self-contained while giving the lightbox real
// dimensions to fit, which an embedded raster small enough to inline would not.
const FIGURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">' +
  '<rect width="640" height="360" fill="#ffffff"/>' +
  '<g fill="#4a7fb5">' +
  '<rect x="40" y="220" width="40" height="100"/>' +
  '<rect x="100" y="160" width="40" height="160"/>' +
  '<rect x="160" y="90" width="40" height="230"/>' +
  '<rect x="220" y="140" width="40" height="180"/>' +
  '<rect x="280" y="60" width="40" height="260"/>' +
  '<rect x="340" y="120" width="40" height="200"/>' +
  '<rect x="400" y="40" width="40" height="280"/>' +
  '<rect x="460" y="170" width="40" height="150"/>' +
  '<rect x="520" y="110" width="40" height="210"/>' +
  '</g>' +
  '<rect x="40" y="40" width="560" height="280" fill="none" stroke="#333" stroke-width="2"/>' +
  '<text x="320" y="30" font-family="sans-serif" font-size="18" text-anchor="middle">' +
  'test figure &#8212; zoom me</text>' +
  '</svg>';

const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: "test", name: "python3" },
    language_info: { name: "python" },
  },
  cells: [
    {
      cell_type: "code",
      execution_count: 1,
      source: "print('figure output below')",
      outputs: [
        { output_type: "display_data", data: { "image/svg+xml": FIGURE_SVG } },
      ],
    },
  ],
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ipynb preview - lightbox interaction test</title>
<style>
  body { margin: 0; font: 13px system-ui, sans-serif; background: #14161a; color: #e8e8ea; }
  header { padding: 10px 14px; border-bottom: 1px solid #2a2e35; position: sticky; top: 0;
    background: #14161a; z-index: 10000; }
  header h1 { font-size: 14px; margin: 0 0 4px; }
  #log { font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.5;
    max-height: 160px; overflow: auto; margin-top: 6px; white-space: pre-wrap; }
  #log .ok { color: #7ee081; }
  #log .bad { color: #ff7b72; }
  #host { padding: 20px; }
  .note { opacity: .65; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>Lightbox interaction test</h1>
  <div class="note">
    Click the figure below to open the lightbox, then press every control.
    Every press is written here. <b>Report anything that changes nothing.</b>
  </div>
  <div id="log"></div>
</header>
<div id="host"></div>

<script>
  // ---- the shell's module-loader facade, minimal but the same shape -------
  window.__DSH_BOOT__ = { modules: {} };
  var FACTORY = null;
  window.__ModuleLoader__ = {
    load: function (registration) { FACTORY = registration; },
    require: function (spec) { throw new Error("no module " + spec); }
  };
  var LOG = document.getElementById("log");
  function log(kind, message) {
    var line = document.createElement("div");
    line.className = kind;
    line.textContent = new Date().toISOString().slice(11, 23) + "  " + message;
    LOG.appendChild(line);
    LOG.scrollTop = LOG.scrollHeight;
  }
  window.__log = log;
  // The bundle only exposes its test seam when this flag is set before it runs.
  window.__DSH_IPYNB_TEST__ = true;
  // The page reports itself, so the outcome needs no dev tools.
  window.addEventListener("error", function (e) { log("bad", "window error: " + e.message); });
  window.addEventListener("unhandledrejection", function (e) {
    log("bad", "unhandled rejection: " + (e.reason && e.reason.message));
  });
</script>
<script>${bundle}</script>
<script>
  (function () {
    if (!FACTORY) { log("bad", "bundle did not register a factory"); return; }
    log("ok", "bundle registered: " + FACTORY.id);

    // React comes from a CDN here; the shell supplies it from its own table.
    var urls = [
      "https://unpkg.com/react@18.3.1/umd/react.development.js",
      "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"
    ];
    var loaded = 0;
    urls.forEach(function (u) {
      var s = document.createElement("script");
      s.src = u;
      s.onload = function () { loaded += 1; if (loaded === urls.length) start(); };
      s.onerror = function () { log("bad", "failed to load " + u + " (offline?)"); };
      document.head.appendChild(s);
    });

    function start() {
      var React = window.React;
      var jsxRuntime = {
        jsx: function (type, props, key) {
          var p = Object.assign({}, props);
          if (key !== undefined) p.key = key;
          return React.createElement(type, p);
        },
        jsxs: function (type, props, key) { return jsxRuntime.jsx(type, props, key); },
        Fragment: React.Fragment
      };
      var exports_ = FACTORY.factory(function (spec) {
        if (spec === "react") return React;
        if (spec === "react/jsx-runtime") return jsxRuntime;
        throw new Error("module table has no " + spec);
      });
      log("ok", "factory materialized; exports: " + Object.keys(exports_).join(", "));

      // Record the interactions that report nothing on their own.
      var realOpen = window.open;
      window.open = function () {
        log("ok", "window.open called (the host would deny this)");
        return realOpen.apply(window, arguments);
      };
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest && e.target.closest("button");
        if (b) log("ok", "click reached button: " +
          (b.getAttribute("aria-label") || b.textContent || "?"));
      }, true);
      document.addEventListener("pointerdown", function (e) {
        var b = e.target && e.target.closest && e.target.closest("button");
        if (b) log("ok", "pointerdown on button: " +
          (b.getAttribute("aria-label") || b.textContent));
      }, true);

      var root = ReactDOM.createRoot(document.getElementById("host"));
      root.render(React.createElement(exports_.__test__.NotebookBody, {
        content: {
          kind: "bytes",
          data: new TextEncoder().encode(${JSON.stringify(JSON.stringify(NOTEBOOK))})
        },
        wrap: true,
        resourceAddress: "dsh-resource://file/session/s/test.ipynb"
      }));
      log("ok", "notebook rendered");

      // An explicit opener: an SVG output is not wrapped in the figure with its
      // own Zoom button, and this calls the same viewer hook that button does.
      var openButton = document.createElement("button");
      openButton.id = "open-lightbox";
      openButton.textContent = "Open the lightbox";
      openButton.style.cssText =
        "margin-top:16px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer;" +
        "border-radius:6px;border:1px solid #4a5160;background:#22262e;color:#e8e8ea";
      openButton.addEventListener("click", function () {
        var png = "data:image/png;base64," +
          "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR42mP8z8DwHwMTAwPDfwYGBgYAD" +
          "wAB/6M0nQAAAABJRU5ErkJggg==";
        exports_.__test__.openImage(png, "test-figure-cell1-out1.png");
        log("ok", "openImage() called");
      });
      document.getElementById("host").appendChild(openButton);
      log("ok", "ready: click 'Open the lightbox', then press every control");

      // ---- self-test -----------------------------------------------------
      // With ?auto=1 or #auto the page drives itself: it opens the lightbox,
      // clicks each control for real, and records the readout before and after.
      // A headless browser can then dump the DOM and this log becomes the
      // evidence, with no human reporting required.
      var auto = /[?&#]auto/.test(location.href);
      if (!auto) return;

      var readout = function () {
        var node = document.querySelector(".dshnb-zoom-value");
        return node ? node.textContent : "(no lightbox)";
      };
      var size = function () {
        var img = document.querySelector(".dshnb-lightbox-img");
        return img ? img.style.width + " x " + img.style.height : "(no image)";
      };
      var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var press = function (label) {
        var all = Array.prototype.slice.call(document.querySelectorAll(".dshnb-lightbox-btn"));
        var found = all.filter(function (b) {
          return (b.getAttribute("aria-label") || b.textContent || "").indexOf(label) === 0;
        })[0];
        if (!found) { log("bad", "no button matching " + JSON.stringify(label)); return false; }
        found.click();
        return true;
      };

      (async function () {
        await wait(400);
        log("ok", "AUTO: before open, readout=" + readout());
        openButton.click();
        await wait(400);
        log("ok", "AUTO: lightbox readout=" + readout() + " size=" + size());

        var steps = [
          ["Zoom in", "zoom in"],
          ["Zoom in", "zoom in again"],
          ["Zoom out", "zoom out"],
          ["Reset to fit", "fit"],
          ["Zoom in", "zoom in after fit"]
        ];
        for (var i = 0; i < steps.length; i += 1) {
          var before = readout() + " / " + size();
          var pressed = press(steps[i][0]);
          await wait(220);
          var after = readout() + " / " + size();
          log(pressed && before !== after ? "ok" : "bad",
            "AUTO " + steps[i][1] + ": " + before + "  ->  " + after);
        }

        // The keyboard path uses the same centre-zoom entry point.
        var beforeKey = readout() + " / " + size();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
        await wait(220);
        log(beforeKey !== readout() + " / " + size() ? "ok" : "bad",
          "AUTO keyboard '+': " + beforeKey + "  ->  " + readout() + " / " + size());

        // The wheel path is pointer-anchored and needs a real WheelEvent.
        var stage = document.querySelector(".dshnb-lightbox-stage");
        var beforeWheel = readout() + " / " + size();
        if (stage) {
          var rect = stage.getBoundingClientRect();
          stage.dispatchEvent(new WheelEvent("wheel", {
            deltaY: -120, clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true
          }));
        }
        await wait(220);
        log(beforeWheel !== readout() + " / " + size() ? "ok" : "bad",
          "AUTO wheel: " + beforeWheel + "  ->  " + readout() + " / " + size());

        log("ok", "AUTO: done");

        // Hit-test every control: the centre of a button must resolve to that
        // button. A control whose centre resolves elsewhere has a dead spot,
        // which is a layout or overlay fault rather than a handler fault.
        var controls = Array.prototype.slice.call(
          document.querySelectorAll(".dshnb-lightbox-btn, .dshnb-zoom-value")
        );
        log("ok", "HITTEST: " + controls.length + " controls");
        controls.forEach(function (el) {
          var r = el.getBoundingClientRect();
          var name = el.getAttribute("aria-label") || (el.textContent || "").trim() || "?";
          var points = [
            ["centre", r.left + r.width / 2, r.top + r.height / 2],
            ["left", r.left + 4, r.top + r.height / 2],
            ["top", r.left + r.width / 2, r.top + 4]
          ];
          var report = points.map(function (p) {
            var hit = document.elementFromPoint(p[1], p[2]);
            var owner = hit && hit.closest
              ? hit.closest(".dshnb-lightbox-btn, .dshnb-zoom-value") : null;
            return p[0] + "=" + (owner === el
              ? "self"
              : (hit ? (hit.className || hit.tagName) : "none"));
          });
          log(report.every(function (s) { return /self$/.test(s); }) ? "ok" : "bad",
            "HIT " + name + " (" + Math.round(r.width) + "x" + Math.round(r.height) +
            "): " + report.join(", "));
        });

        document.title = "AUTO-DONE";
      })();

      // Watch the readout and the painted size, so a control that does nothing
      // is visible without opening dev tools.
      var lastReadout = null;
      var lastSize = null;
      setInterval(function () {
        var readout = document.querySelector(".dshnb-zoom-value");
        if (readout && readout.textContent !== lastReadout) {
          lastReadout = readout.textContent;
          log("ok", "zoom readout: " + lastReadout);
        }
        var img = document.querySelector(".dshnb-lightbox-img");
        var size = img ? img.style.width + " x " + img.style.height : null;
        if (size && size !== lastSize) {
          lastSize = size;
          log("ok", "painted size: " + size);
        }
      }, 120);
    }
  })();
</script>
</body>
</html>
`;

writeFileSync(OUT, html, "utf8");
console.log(`wrote ${OUT} (${Buffer.byteLength(html)} bytes)`);
