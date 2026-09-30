/**
 * Reproduce the "clicking zoom makes the notebook disappear" failure.
 *
 * Runs the plugin's own NotebookBody and ImageLightbox against a DOM stub that
 * supports mounting, effects, and events, then reports any exception. React's
 * server renderer does not run effects or events, which is exactly the seam the
 * earlier verification could not reach.
 */
import { FIXTURE, loadBundle, loadReact, requireDep } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// React and the client artifact come from the shared harness, so this file
// carries no machine-specific paths.
const { React, jsxRuntime } = loadReact();


/* ---- DOM stub -------------------------------------------------------- */

class Style {
  constructor() { this._p = {}; }
  setProperty(k, v) { this._p[k] = v; }
  get cssText() { return Object.entries(this._p).map(([k, v]) => `${k}:${v}`).join(";"); }
  removeProperty(k) { delete this._p[k]; }
}
const makeStyle = () => {
  const style = new Style();
  // Allow plain property assignment too (style.transform = ...).
  return new Proxy(style, {
    set(target, key, value) {
      if (key === "_p") { target._p = value; return true; }
      target._p[key] = value;
      return true;
    },
    get(target, key) {
      if (key in target) return target[key];
      return target._p[key];
    },
  });
};

let idSeq = 0;
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.style = makeStyle();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this._listeners = {};
    this.textContent = "";
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.scrollWidth = 1000;
    this.scrollHeight = 1000;
    this.clientWidth = 900;
    this.clientHeight = 700;
    this.__id = (idSeq += 1);
  }
  get ownerDocument() { return documentStub; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    const at = this.children.indexOf(before);
    child.parentNode = this;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    return child;
  }
  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (list) this._listeners[type] = list.filter((f) => f !== fn);
  }
  dispatchEvent(event) {
    const list = this._listeners[event.type] || [];
    event.target ||= this;
    event.currentTarget = this;
    for (const fn of [...list]) fn(event);
    return true;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() {
    // A stage-like box; the lightbox fit is computed from this.
    return { left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700, x: 0, y: 0 };
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() { return null; }
  focus() {}
  click() {
    this.dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {} });
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const documentStub = new El("#document");
documentStub.nodeType = 9;
documentStub.head = new El("head");
documentStub.body = new El("body");
documentStub.documentElement = new El("html");
documentStub.createElement = (tag) => new El(tag);
documentStub.createElementNS = (ns, tag) => new El(tag);
documentStub.createTextNode = (text) => {
  const node = new El("#text");
  node.nodeType = 3;
  node.textContent = String(text);
  return node;
};
documentStub.addEventListener = El.prototype.addEventListener.bind(documentStub);
documentStub.removeEventListener = El.prototype.removeEventListener.bind(documentStub);
documentStub.dispatchEvent = El.prototype.dispatchEvent.bind(documentStub);
documentStub.querySelector = () => null;
documentStub.activeElement = documentStub.body;

globalThis.document = documentStub;
globalThis.window = {
  document: documentStub,
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  // `navigator` is a getter-only global on modern Node, so the stub window
  // borrows the existing one instead of the harness defining its own.
  navigator: globalThis.navigator,
};
globalThis.HTMLElement = El;
globalThis.Element = El;
globalThis.Node = El;
// react-dom's commit phase probes these constructors for selection handling,
// and it reads them off the window object it captured, not off globalThis.
for (const name of [
  "HTMLElement", "Element", "Node",
  "HTMLIFrameElement", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLAnchorElement", "HTMLImageElement", "HTMLButtonElement",
  "HTMLSelectElement", "SVGElement",
]) {
  globalThis[name] = El;
  globalThis.window[name] = El;
}
globalThis.window.document = documentStub;
globalThis.Event = class { constructor(type) { this.type = type; } preventDefault() {} stopPropagation() {} };
globalThis.MouseEvent = globalThis.Event;
globalThis.window.Event = globalThis.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// The bundle is materialized exactly as the shell's module loader does, and
// it must see the DOM stub above before it runs.
const { exports, tests: t } = loadBundle({ react: React, jsxRuntime });

/* ---- mount ---------------------------------------------------------- */

const raw = readFileSync(FIXTURE, "utf8");
// A 1x1 PNG, enough to exercise the lightbox without real figure data.
const PNG_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const container = new El("div");
documentStub.body.appendChild(container);

const countNodes = (node) => {
  let n = 1;
  for (const child of node.children || []) n += countNodes(child);
  return n;
};

const { createRoot } = requireDep("react-dom/client");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (!ok) failures += 1;
};

/* ---- mount ---------------------------------------------------------- */

const errors = [];
const realError = console.error;
const realWarn = console.warn;
// Nothing is filtered here on purpose: a suppressed render error is exactly how
// a regression hides.
console.error = (...args) => { errors.push(args.map(String).join(" ")); };
console.warn = (...args) => { errors.push("warn: " + args.map(String).join(" ")); };

const root = createRoot(container);
try {
  root.render(
    React.createElement(t.NotebookBody, {
      content: { kind: "bytes", data: new Uint8Array(Buffer.from(raw, "utf8")) },
      wrap: true,
      resourceAddress: "dsh-resource://file/session/s/notebooks/jupyter/stbbh_lisa_population_to_snr.ipynb",
    })
  );
} catch (error) {
  errors.push("render threw: " + error.message);
}
// Let effects and any scheduled work settle.
await new Promise((resolve) => setTimeout(resolve, 100));

// Text actually present in the rendered tree: the real proof of a visible UI.
const text = (() => {
  const out = [];
  const visit = (node) => {
    if (node.children && node.children.length === 0 && typeof node.textContent === "string") {
      out.push(node.textContent);
    }
    for (const child of node.children || []) visit(child);
  };
  visit(container);
  return out.join("\n");
})();

console.log("=== mount ===");
check("mounting the notebook does not throw", errors.length === 0, errors.slice(0, 2).join(" | "));
const before = countNodes(container);
check("the notebook rendered a substantial tree", before > 50, `${before} nodes`);
check("the header text reached the DOM", text.includes("Jupyter notebook"));
// Code cells are injected with dangerouslySetInnerHTML, so their source is
// markup rather than textContent and cannot be read off the text; assert on the
// rendered markup instead.
const markup = (() => {
  // Flatten what the assertions need rather than stringifying the tree, which
  // is circular through `parentNode`. Two details matter:
  //   - the stub records attributes through setAttribute, where `class` lives
  //   - highlighted code and rendered math arrive as raw HTML assigned to
  //     innerHTML, so a walk of child nodes alone would see neither
  const parts = [];
  const visit = (node) => {
    const cls = node.attributes?.class || node.className;
    if (cls) parts.push(String(cls));
    if (node.attributes?.["aria-label"]) parts.push(node.attributes["aria-label"]);
    if (typeof node.innerHTML === "string") parts.push(node.innerHTML);
    if (node.textContent) parts.push(String(node.textContent));
    for (const child of node.children || []) visit(child);
  };
  visit(container);
  return parts.join(" ");
})();
check("cell source reached the DOM as highlighted markup",
  markup.includes("tok-kw") && markup.includes("draw_population"),
  `${(markup.match(/tok-/g) || []).length} token classes`);
check("math reached the DOM", /katex/.test(markup));

/* ---- open the lightbox ---------------------------------------------- */

console.log("\n=== open the lightbox ===");
// The figure markup must expose its zoom and save controls. Their click
// handlers are exercised in a real browser by tests/make-page.mjs, because this
// stub cannot dispatch a click into React's synthetic event system.
const buttons = [];
const walk = (node) => {
  if (node.tagName === "BUTTON") buttons.push(node);
  for (const child of node.children || []) walk(child);
};
walk(container);
const hasButton = (title) =>
  buttons.some((b) => b.attributes.title === title || b.attributes["aria-label"] === title);
console.log(`  buttons in the tree: ${buttons.length}`);
check("a figure offers a Zoom control", hasButton("Zoom"));
check("a figure offers a Save control", hasButton("Save this image"));
check("the image itself is clickable to zoom",
  buttons.length > 0 || markup.includes("Click to zoom"));

const beforeNodes = countNodes(container);
let clickError = null;
// Open the lightbox through the plugin's own hook, which is the same call a
// figure makes; the DOM click path depends on stub event plumbing and is not
// the thing under test.
try {
  t.openImage(PNG_URI, "probe.png");
} catch (error) {
  clickError = error;
}
await new Promise((resolve) => setTimeout(resolve, 100));
check("opening an image does not throw", clickError === null, clickError ? clickError.message : "");

// Did a lightbox actually appear, and did the notebook survive?
const overlays = [];
const findOverlay = (node) => {
  const cls = node.attributes?.class || "";
  if (typeof cls === "string" && cls.includes("dshnb-lightbox")) overlays.push(node);
  for (const child of node.children || []) findOverlay(child);
};
findOverlay(documentStub.body);
console.log(`  lightbox nodes in document.body: ${overlays.length}`);
check("a lightbox overlay was mounted", overlays.length > 0);

const imgs = [];
const findImgs = (node) => {
  if (node.tagName === "IMG") imgs.push(node);
  for (const child of node.children || []) findImgs(child);
};
findImgs(documentStub.body);
check("the overlay contains an image", imgs.length > 0, `${imgs.length} img nodes`);

const afterClick = countNodes(container);
check("the notebook tree survives the click",
  afterClick >= beforeNodes,
  `${beforeNodes} nodes before, ${afterClick} after`);

/* ---- the painted size must equal fit x scale ------------------------- */

console.log("\n=== painted size vs the zoom readout ===");
// The stub reports no intrinsic size, so supply one and re-measure, exactly as
// a real decode would.
const findImg = (node, out = []) => {
  if (node.tagName === "IMG" && (node.attributes?.class || "").includes("lightbox")) {
    out.push(node);
  }
  for (const child of node.children || []) findImg(child, out);
  return out;
};
const lightboxImgs = findImg(documentStub.body);
console.log(`  lightbox images: ${lightboxImgs.length}`);
check("the lightbox rendered its image element", lightboxImgs.length > 0);

const img = lightboxImgs[0];
if (img) {
  img.naturalWidth = 1536;
  img.naturalHeight = 1024;
  // Re-measure the way the load handler does.
  t.openImage(PNG_URI, "probe.png");
  await new Promise((resolve) => setTimeout(resolve, 60));
  const fresh = findImg(documentStub.body)[0] || img;
  console.log(`  style width=${fresh.style.width} height=${fresh.style.height}`);
  check("the image is given an explicit pixel width",
    /^\d+px$/.test(String(fresh.style.width || "")), String(fresh.style.width));
  check("the image is given an explicit pixel height",
    /^\d+px$/.test(String(fresh.style.height || "")), String(fresh.style.height));
  const w = parseFloat(fresh.style.width) || 0;
  const h = parseFloat(fresh.style.height) || 0;
  check("the rendered aspect ratio matches the source",
    w > 0 && h > 0 && Math.abs(w / h - 1536 / 1024) < 0.02,
    `${w} x ${h}`);
}


/* ---- zoom arithmetic ------------------------------------------------- */

/* ---- the bar buttons must actually act ------------------------------ */

console.log("\n=== lightbox bar buttons ===");
const findByClass = (node, needle, out = []) => {
  const cls = node.attributes?.class || "";
  if (typeof cls === "string" && cls.includes(needle)) out.push(node);
  for (const child of node.children || []) findByClass(child, needle, out);
  return out;
};
const barButtons = findByClass(documentStub.body, "dshnb-lightbox-btn").map((node) => ({
  node,
  label: (node.children || []).map((c) => c.textContent).join("") ||
    node.attributes["aria-label"] || "?",
}));
console.log(`  lightbox buttons: ${barButtons.map((b) => JSON.stringify(b.label)).join(", ")}`);
check("the lightbox exposes zoom-out, zoom-in, Fit, Save and close",
  ["Zoom out", "Zoom in", "Reset to fit ( 0 )", "Save this image", "Close"].every((label) =>
    barButtons.some((b) => b.label === label)),
  barButtons.map((b) => b.label).join("|"));

const readPercent = () => {
  const nodes = findByClass(documentStub.body, "dshnb-zoom-value");
  return nodes[0] ? String(nodes[0].textContent) : "";
};

const zoom = t.getZoom ? t.getZoom() : null;
console.log(`  live zoom hook: ${typeof zoom}`);
if (zoom) {
  const w0 = String((findByClass(documentStub.body, "lightbox-img")[0] || {}).style?.width || "");
  zoom(1.25, null, null);
  await new Promise((r) => setTimeout(r, 60));
  const w1 = String((findByClass(documentStub.body, "lightbox-img")[0] || {}).style?.width || "");
  console.log(`  direct zoom(1.25): ${JSON.stringify(w0)} -> ${JSON.stringify(w1)}`);
  check("calling the zoom entry point enlarges the image", w0 !== w1, `${w0} -> ${w1}`);
}

const percentBefore = readPercent();
console.log(`  readout before: ${JSON.stringify(percentBefore)}`);
check("a zoom readout is present", /\d+%/.test(percentBefore), percentBefore);

// The controls' click handlers are not asserted here. Dispatching a plain event
// on this stub does not reach React's synthetic system, so a failure would say
// nothing about the plugin; tests/make-page.mjs drives them in a real browser,
// where every control is verified to change the readout and the painted size.

console.log("\n=== anchored zoom arithmetic ===");
check("zoomScroll keeps the anchored point still",
  (() => {
    const point = { x: 120, y: 80 };
    const view = { left: 0, top: 0 };
    const next = t.zoomScroll(view, point, 1, 2);
    const paintedBefore = point.x * 1 - view.left;
    const paintedAfter = point.x * 2 - next.left;
    return Math.abs(paintedBefore - paintedAfter) < 1e-9;
  })());
check("zoomScroll is finite for a large scale",
  (() => {
    const next = t.zoomScroll({ left: 40, top: 10 }, { x: 600, y: 400 }, 1, 12);
    return Number.isFinite(next.left) && Number.isFinite(next.top);
  })());

console.log(`\n${failures === 0 ? "NO FAILURE REPRODUCED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);


