/**
 * Shared plumbing for this repository's tests.
 *
 * Every path is derived from this file's own location, so the suite runs from
 * a fresh clone on any platform. Two things are resolved lazily and reported
 * clearly rather than failing obscurely:
 *
 *   - the client artifact, which the build produces
 *   - React and React DOM, which are the only third-party packages the tests
 *     need and are not runtime dependencies of the plugin
 *
 * The shell supplies React to the browser bundle from its own module table, so
 * the plugin never declares it. The tests do need a copy, and they take it from
 * the repository's own `node_modules` if it is there.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root, one level above `tests/`. */
export const REPO = resolve(here, "..");
export const TEMPLATE = join(REPO, "lib", "client.template.js");
export const BUNDLE = join(REPO, "lib", "client.js");
export const PATCH = join(REPO, "cordis.patch.yml");
export const PACKAGE = join(REPO, "package.json");
export const FIXTURE = join(REPO, "tests", "fixtures", "sample-notebook.ipynb");

/**
 * Load React and its JSX runtime from this repository's dependencies.
 *
 * @returns the three modules the bundle's module table needs.
 */
export function loadReact() {
  const req = createRequire(join(REPO, "package.json"));
  const missing = [];
  const take = (name) => {
    try {
      return req(name);
    } catch {
      missing.push(name);
      return null;
    }
  };
  const React = take("react");
  const jsxRuntime = take("react/jsx-runtime");
  const server = take("react-dom/server");
  if (missing.length) {
    throw new Error(
      `the tests need ${missing.join(", ")}; run \`npm install\` in ${REPO} first`
    );
  }
  return { React, jsxRuntime, renderToStaticMarkup: server.renderToStaticMarkup };
}

/**
 * Materialize the client bundle the way the shell's module loader does.
 *
 * The bundle registers a factory on `window.__ModuleLoader__`; the factory
 * receives a `require` restricted to the frozen module table. The plugin's test
 * seam is exposed only when `__DSH_IPYNB_TEST__` is set before it runs.
 *
 * @param options.react - a React module, for the bundle's `react` requirement.
 * @param options.jsxRuntime - the automatic JSX runtime.
 * @returns `{ exports, tests }`, where `tests` is the plugin's `__test__` seam.
 *   Both are returned explicitly: reading the seam off an export named
 *   `__test__` silently yields undefined if the seam is ever renamed.
 */
export function loadBundle({ react, jsxRuntime } = {}) {
  requireBuiltArtifact();
  const modules = { react, "react/jsx-runtime": jsxRuntime };
  let captured = null;
  // Attach the loader facade to whatever `window` already exists. Replacing the
  // object would discard a caller's DOM stub -- including the element
  // constructors react-dom reads off the window it captured -- and a later
  // `instanceof` would then fail with "right-hand side is not an object".
  globalThis.window = globalThis.window || {};
  globalThis.window.__ModuleLoader__ = {
    load: (registration) => { captured = registration; },
  };
  // The bundle probes `document` at module scope for a few host capabilities.
  globalThis.document = globalThis.document || {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.__DSH_IPYNB_TEST__ = true;

  new Function("window", "document", readFileSync(BUNDLE, "utf8"))(
    globalThis.window,
    globalThis.document
  );
  if (!captured) throw new Error("the bundle did not register a module factory");

  const exports = captured.factory((spec) => {
    if (!(spec in modules)) throw new Error(`the module table has no ${spec}`);
    return modules[spec];
  });
  const tests = exports.__test__;
  if (!tests) {
    throw new Error(
      "the bundle exposed no test seam; it is published only when " +
        "__DSH_IPYNB_TEST__ is set before the bundle runs"
    );
  }
  return { exports, tests };
}

/** Fail with a useful message when the client artifact has not been built. */
export function requireBuiltArtifact() {
  if (!existsSync(BUNDLE)) {
    throw new Error(
      `missing ${BUNDLE}\n` +
        "the client artifact is generated: run `npm run build` first"
    );
  }
}

/** The repository's own package.json, parsed. */
export function readPackage() {
  return JSON.parse(readFileSync(PACKAGE, "utf8"));
}

/**
 * Load a module from this repository's dependencies.
 *
 * The mount harness needs `react-dom/client`, which is a test-only dependency:
 * the browser bundle never requires React itself, because the shell supplies it
 * from its own module table.
 *
 * @param name - a package or subpath to require.
 * @returns the resolved module.
 */
export function requireDep(name) {
  return createRequire(join(REPO, "package.json"))(name);
}

/** A minimal assertion recorder shared by the suites. */
export function createChecker() {
  let failures = 0;
  const check = (name, ok, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
    if (!ok) failures += 1;
    return ok;
  };
  return {
    check,
    failures: () => failures,
    /**
     * Print the summary and exit nonzero on any failure.
     *
     * @returns never; the process exits.
     */
    finish() {
      const count = failures;
      console.log(
        count === 0
          ? "\nALL CHECKS PASSED"
          : `\n${count} CHECK(S) FAILED`
      );
      process.exit(count === 0 ? 0 : 1);
    },
  };
}

/** Strip HTML tags, for assertions about the text a reader would see. */
export function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, "");
}
