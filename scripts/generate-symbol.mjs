// Symbol generator — runs a tscircuit symbol program and renders it.
//
// A symbol file is TypeScript that draws the part with tscircuit. This script
// builds a circuit, hands it to the symbol module's default export, and renders
// the result as an SVG. The symbol editor previews that SVG and re-runs this
// whenever the source changes.
//
//   node scripts/generate-symbol.mjs --file <name.ts> --out <dir>
//
// Bare `tscircuit` imports are rewritten to this repository's copy, so a symbol
// file works from anywhere on disk (a library outside the repo, for instance).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Circuit } from "tscircuit";
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(import.meta.url);

function flag(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const symbolFile = flag("file");
if (!symbolFile) {
  console.error("usage: node scripts/generate-symbol.mjs --file <name.ts> [--out <dir>]");
  process.exit(1);
}
const outDir = resolve(root, flag("out", "src/generated"));
const sourcePath = resolve(root, symbolFile);

// `tscircuit` resolves from this repository even when the symbol lives elsewhere.
const tscircuitEntry = pathToFileURL(require.resolve("tscircuit")).href;
const source = readFileSync(sourcePath, "utf8").replace(
  /(from\s*|import\s*\(\s*)(["'])tscircuit\2/g,
  (_match, prefix, quote) => `${prefix}${quote}${tscircuitEntry}${quote}`,
);

// Node strips the TypeScript types itself; a copy is used so the original file
// is never touched and the rewritten import is what runs.
const scratch = mkdtempSync(join(tmpdir(), "ehdl-symbol-"));
const moduleFile = join(scratch, "symbol.ts");
writeFileSync(moduleFile, source, "utf8");

const loaded = await import(pathToFileURL(moduleFile).href);
// The module is loaded; drop the scratch copy so repeat runs (the preview
// redraws while you type) don't pile up temp folders.
rmSync(scratch, { recursive: true, force: true });
const build = loaded.default ?? loaded.symbol ?? loaded.build;
if (typeof build !== "function") {
  console.error(
    `symbol file ${symbolFile} must default-export a function that draws the symbol, e.g. ` +
      "`export default (circuit) => { … }`",
  );
  process.exit(1);
}

// `platform` is where `Circuit` reads `routingDisabled` from; a top-level flag
// is dropped by its constructor and the autorouter would run on a symbol that
// has no PCB footprints to route on (failing async after the SVG is written).
const circuit = new Circuit({ platform: { routingDisabled: true } });
await build(circuit);

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
