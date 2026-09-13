// Schematic generator — VHDL in, tscircuit schematic out.
//
// Pipeline (`docs/vhdl-implementation.md` sections 5.2 and 6):
//   1. read every component file in the library folder and the top-level design
//   2. parse them (the compiled TypeScript helpers in .tmp-schematic/)
//   3. elaborate: variant → pin numbers → nets (netlist + BOM)
//   4. build a tscircuit circuit and render the schematic SVG
//
// tscircuit only runs outside the webview, so this script is the "backend" of
// the schematic editor: the app spawns it through the Rust command
// `generate_schematic`, and the build runs it once to ship a first schematic.
//
// Usage:
//   node scripts/generate-schematic.mjs --lib <dir> --top <file> --out <dir>

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Circuit, Chip, Trace } from "tscircuit";
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// The shared parser/elaborator are TypeScript, compiled to CommonJS into
// .tmp-schematic by `npm run gen:schematic`. Mark that folder as CommonJS
// before importing from it (this repository is an ES module package).
const compiledDir = join(root, ".tmp-schematic");
mkdirSync(compiledDir, { recursive: true });
writeFileSync(join(compiledDir, "package.json"), '{"type":"commonjs"}\n');

const load = async (name) =>
  import(pathToFileURL(join(compiledDir, "src", `${name}.js`)).href);

const { parseComponentVhdl } = await load("vhdlPart");
const { parseDesignVhdl } = await load("vhdlDesign");
const { elaborate, bomToCsv } = await load("elaborate");

/** Tiny argv reader: --flag value */
function flag(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const libDir = resolve(root, flag("lib", "examples/sample-project/components"));
const topFile = resolve(root, flag("top", "examples/sample-project/src/board.vhd"));
const outDir = resolve(root, flag("out", "src/generated"));

/** Every `*.prt.ehd` under a directory. */
function componentFiles(dir, depth = 0) {
  if (depth > 8) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...componentFiles(path, depth + 1));
    else if (entry.toLowerCase().endsWith(".prt.ehd")) found.push(path);
  }
  return found;
}

const logs = [];
const log = (message) => {
  logs.push(message);
  console.log(message);
};

// --- 1/2. parse the library and the design ---------------------------------
const components = [];
for (const path of componentFiles(libDir)) {
  const file = path.slice(path.lastIndexOf("\\") + 1 || path.lastIndexOf("/") + 1);
  const { model, issues } = parseComponentVhdl(readFileSync(path, "utf8"), file.replace(/\..*$/, ""));
  components.push({ entity: model.name, model, file });
  for (const issue of issues) {
    if (issue.severity === "error") log(`component ${file}: ${issue.message}`);
  }
}
log(`parsed ${components.length} component file(s) from ${libDir}`);

const design = parseDesignVhdl(readFileSync(topFile, "utf8"), "design");
log(`parsed design '${design.model.name}' with ${design.model.instances.length} instance(s)`);

// --- 3. elaborate ----------------------------------------------------------
const { netlist, bom, issues } = elaborate(design.model, components);
for (const issue of [...design.issues, ...issues]) {
  log(`${issue.severity}: ${issue.message}`);
}
log(
  `elaborated ${netlist.components.length} component(s), ${netlist.nets.length} net(s), ${bom.length} BOM row(s)`,
);

// --- 4. tscircuit → schematic ---------------------------------------------
// Routing is disabled: this stage produces the schematic only, and without PCB
// footprints the autorouter has nothing to route on (it would fail async and
// spam stderr on every run). The board editor will turn it back on.
const circuit = new Circuit({ routingDisabled: true });

for (const instance of netlist.components) {
  // pinLabels maps pin number → port name, which is how the VHDL port names
  // appear on the symbol and how traces address the pins.
  const pinLabels = {};
  for (const [port, pin] of Object.entries(instance.pins)) pinLabels[pin] = port;

  circuit.add(
    new Chip({
      name: instance.refdes,
      pinLabels,
      ...(instance.footprint ? { footprint: instance.footprint } : {}),
    }),
  );
}

for (const net of netlist.nets) {
  // Chain the pins of a net; tscircuit draws the schematic traces.
  const [first, ...rest] = net.connections;
  for (const connection of rest) {
    circuit.add(
      new Trace({
        from: `${first.refdes}.${first.port}`,
        to: `${connection.refdes}.${connection.port}`,
        // Schematic only: without PCB footprints the autorouter has nothing to
        // route on, and its async failure would spam stderr on every run.
        routingDisabled: true,
      }),
    );
  }
}

const circuitJson = circuit.getCircuitJson();
const svg = convertCircuitJsonToSchematicSvg(circuitJson);

// --- outputs ---------------------------------------------------------------
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "schematic.svg"), svg, "utf8");
writeFileSync(join(outDir, "circuit.json"), `${JSON.stringify(circuitJson, null, 2)}\n`, "utf8");
writeFileSync(join(outDir, "netlist.json"), `${JSON.stringify(netlist, null, 2)}\n`, "utf8");
writeFileSync(join(outDir, "bom.json"), `${JSON.stringify(bom, null, 2)}\n`, "utf8");
writeFileSync(join(outDir, "bom.csv"), `${bomToCsv(bom)}\n`, "utf8");

// Machine-readable summary of the run — what the app loads after generating.
const designName = topFile.slice(topFile.replace(/\//g, "\\").lastIndexOf("\\") + 1);
writeFileSync(
  join(outDir, "generation.json"),
  `${JSON.stringify({ design: designName, library: libDir, generatedAt: new Date().toISOString(), logs }, null, 2)}\n`,
  "utf8",
);

// The app imports this module: the drawing plus everything it needs to show
// the component/net lists without touching the file system.
const source = {
  design: topFile.slice(topFile.replace(/\//g, "\\").lastIndexOf("\\") + 1),
  library: libDir,
  generatedAt: new Date().toISOString(),
  logs,
};
writeFileSync(
  join(outDir, "schematic.ts"),
  "// Generated by scripts/generate-schematic.mjs (tscircuit). Do not edit.\n" +
    `export const schematicSvg: string = ${JSON.stringify(svg)};\n` +
    `export const schematicNetlist = ${JSON.stringify(netlist, null, 2)};\n` +
    `export const schematicBom = ${JSON.stringify(bom, null, 2)};\n` +
    `export const schematicSource = ${JSON.stringify(source, null, 2)};\n`,
  "utf8",
);

console.log(`schematic svg generated (${svg.length} chars) → ${outDir}`);