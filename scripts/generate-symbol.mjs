// Symbol generator — renders one symbol with tscircuit.
//
// A symbol is a tscircuit *React* module (`<chip … />`, `<led … />`), or a
// component file whose `--#symbol` block carries one. This script draws it and
// writes the SVG the editor previews; scripts/lib/symbol-module.mjs does the
// compiling and running (JSX → JS, imports pointed at tscircuit's React).
//
//   node scripts/generate-symbol.mjs --file <symbol.tsx|component.vhd> [--out <dir>]
//
// Symbols written in the older `(circuit, options)` form still draw.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Circuit } from "tscircuit";
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg";
import { createSymbolRunner } from "./lib/symbol-module.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// The shared symbol helpers are TypeScript, compiled to CommonJS into
// .tmp-symbol by `npm run gen:schematic`. Mark that folder as CommonJS before
// importing from it (this repository is an ES module package).
const compiledDir = join(root, ".tmp-symbol");
mkdirSync(compiledDir, { recursive: true });
writeFileSync(join(compiledDir, "package.json"), '{"type":"commonjs"}\n');

const { inlineSymbolSource } = await import(
  pathToFileURL(join(compiledDir, "src", "symbolFile.js")).href
);

function flag(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const symbolFile = flag("file");
if (!symbolFile) {
  console.error("usage: node scripts/generate-symbol.mjs --file <symbol.tsx|component.vhd> [--out <dir>]");
  process.exit(1);
}
const outDir = resolve(root, flag("out", "src/generated"));
const sourcePath = resolve(root, symbolFile);
const text = readFileSync(sourcePath, "utf8");

// A component file carries its symbol in a `--#symbol` comment block; anything
// else *is* the module.
const isComponent = [".vhd", ".ehd"].includes(extname(sourcePath).toLowerCase());
const source = isComponent ? inlineSymbolSource(text) : text;
if (!source) {
  console.error(
    `${symbolFile} carries no symbol. Add a ${"--#symbol"} … ${"--#/symbol"} block, or point --file at a symbol module.`,
  );
  process.exit(1);
}

// --- render ----------------------------------------------------------------
const runner = createSymbolRunner(root);
const circuit = new Circuit({ platform: { routingDisabled: true } });
try {
  const build = await runner.load(source, basename(sourcePath));
  runner.add(circuit, build, {});
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  runner.dispose();
}

const circuitJson = circuit.getCircuitJson();
const svg = convertCircuitJsonToSchematicSvg(circuitJson);

const counts = {};
for (const element of circuitJson) {
  counts[element.type] = (counts[element.type] ?? 0) + 1;
}
const drawn = Object.entries(counts)
  .filter(([type]) => type.startsWith("schematic_"))
  .map(([type, count]) => `${count} ${type.replace("schematic_", "")}`)
  .join(", ");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "symbol.svg"), svg, "utf8");
writeFileSync(
  join(outDir, "symbol.json"),
  `${JSON.stringify({ source: sourcePath, generatedAt: new Date().toISOString(), counts }, null, 2)}\n`,
  "utf8",
);

console.log(`symbol rendered from ${symbolFile}`);
console.log(`drew: ${drawn || "nothing"}`);
console.log(`symbol svg generated (${svg.length} chars) → ${outDir}`);
