// Symbol modules — how a tscircuit *React* symbol is loaded and added.
//
// A symbol is a React module (`<led … />`, `<chip … />`), which is what the
// tscircuit documentation shows. Two things have to line up for that to run
// outside a bundler:
//
//   * JSX has to be compiled: Node strips types but not JSX, so the TypeScript
//     compiler (already a dependency, and already used by `npm run gen:*`) does
//     the transform here — no extra native binary, no bundler;
//   * the elements have to be built against *tscircuit's* React: core renders
//     them with its own `react-reconciler` (React 19, nested in core's own
//     `node_modules`), so a module importing the application's React would
//     produce elements the reconciler cannot instantiate. The compiled imports
//     are rewritten to core's copy, the same way bare `tscircuit` imports are
//     rewritten to this repository's copy.
//
// Both the symbol generator (one symbol, for the editor) and the schematic
// generator (every symbol of a design) use this module.
//
// Symbols written before this — `export default (circuit, options) => {…}` —
// still run: the module is handed an object that works as both the props and
// the circuit (see `addSymbol`).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A loader for React symbol modules, bound to one repository root.
 *
 * `load` compiles and imports a module; `add` puts it in a circuit, which is the
 * only part that differs between the two generators.
 */
export function createSymbolRunner(root) {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");

  // The React that tscircuit itself resolves: core's nested copy when it has
  // one, the top-level React otherwise.
  const coreRequire = createRequire(
    pathToFileURL(join(root, "node_modules", "@tscircuit", "core", "package.json")).href,
  );
  const React = coreRequire("react");
  const reactEntry = pathToFileURL(coreRequire.resolve("react")).href;
  const jsxRuntimeEntry = pathToFileURL(coreRequire.resolve("react/jsx-runtime")).href;
  const tscircuitEntry = pathToFileURL(require.resolve("tscircuit")).href;

  const scratch = mkdtempSync(join(tmpdir(), "ehdl-symbols-"));
  let loaded = 0;

  /** Compile TSX to JS and point its imports at the copies that must run. */
  function compile(source) {
    const js = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
      },
      fileName: "symbol.tsx",
    }).outputText;
    return js
      .replace(/(from\s*|import\s*\(\s*)(["'])react\/jsx-runtime\2/g, (_m, p, q) => p + q + jsxRuntimeEntry + q)
      .replace(/(from\s*|import\s*\(\s*)(["'])react\2/g, (_m, p, q) => p + q + reactEntry + q)
      .replace(/(from\s*|import\s*\(\s*)(["'])tscircuit\2/g, (_m, p, q) => p + q + tscircuitEntry + q);
  }

  /**
   * The function a symbol module exports: a React component, or the older
   * `(circuit, options)` form. Throws when the module exports neither.
   */
  async function load(source, label = "symbol") {
    // `.mjs`: the module is JavaScript once compiled, and Node imports it by
    // extension (a `.tsx` file would be refused).
    const file = join(scratch, `${loaded++}-${safeName(label)}.mjs`);
    writeFileSync(file, compile(source), "utf8");
    const module = await import(`${pathToFileURL(file).href}?v=${loaded}`);
    const build = module.default ?? module.symbol ?? module.build;
    if (typeof build !== "function") {
      throw new Error(`${label} must default-export a React component, e.g. \`export default () => <chip … />\``);
    }
    return build;
  }

  /**
   * Draw `build` into `circuit` with `props` (`name` above all).
   *
   * A React component returns the element to add. The old form draws into the
   * circuit it is handed instead, so the argument works as both: it carries the
   * props, and a non-enumerable `add` (invisible to `<chip {...props} />`)
   * forwards to the circuit. Returns which form ran.
   */
  function add(circuit, build, props) {
    const argument = { ...props };
    Object.defineProperty(argument, "add", {
      value: (...elements) => {
        for (const element of elements) circuit.add(element);
      },
    });
    const drawn = build(argument, argument);
    if (React.isValidElement(drawn)) {
      circuit.add(drawn);
      return "react";
    }
    if (Array.isArray(drawn)) {
      for (const element of drawn) circuit.add(element);
      return "react";
    }
    return "legacy";
  }

  /** Remove the compiled copies (after the last module has been imported). */
  function dispose() {
    rmSync(scratch, { recursive: true, force: true });
  }

  return { load, add, dispose };
}

/** A file name a module label can be used as. */
function safeName(label) {
  return label.replace(/[^\w.-]+/g, "_").slice(-60) || "symbol";
}
