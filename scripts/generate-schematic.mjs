// Schematic generator — VHDL in, tscircuit schematic out.
//
// Pipeline (`docs/vhdl-implementation.md` sections 5.2 and 6):
//   1. read every component file in the library folder and the top-level design
//   2. parse them (the compiled TypeScript helpers in .tmp-schematic/)
//   3. elaborate: variant → pin numbers → nets (netlist + BOM)
//   4. build a tscircuit circuit and render the schematic SVG
//
// Each instantiated part is drawn with the symbol program its component links
// through the `SYMBOL` metadata constant (a tscircuit module, the same one the
// Part editor previews); components without a symbol are drawn from their ports.
//
// tscircuit only runs outside the webview, so this script is the "backend" of
// the schematic editor: the app spawns it through the Rust command
// `generate_schematic`, and the build runs it once to ship a first schematic.
//
// Usage:
//   node scripts/generate-schematic.mjs --lib <dir> --top <file> --out <dir>

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Circuit, Chip, Trace } from "tscircuit";
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(import.meta.url);

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

const libDir = resolve(root, flag("lib", "examples/sample-project/sample_lib/components"));
const topFile = resolve(root, flag("top", "examples/sample-project/board.vhd"));
const outDir = resolve(root, flag("out", "src/generated"));

/** Every `*.vhd` under a directory. */
function componentFiles(dir, depth = 0) {
  if (depth > 8) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...componentFiles(path, depth + 1));
    else if (entry.toLowerCase().endsWith(".vhd")) found.push(path);
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
  const file = basename(path);
  const { model, issues } = parseComponentVhdl(readFileSync(path, "utf8"), file.replace(/\..*$/, ""));
  // `path` is kept so a component's linked symbol can be resolved from it.
  components.push({ entity: model.name, model, file, path });
  for (const issue of issues) {
    if (issue.severity === "error") log(`component ${file}: ${issue.message}`);
  }
}
log(`parsed ${components.length} component file(s) from ${libDir}`);

const byEntity = new Map();
for (const component of components) byEntity.set(component.entity.toLowerCase(), component);

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

// --- linked symbols --------------------------------------------------------
// A component may link a tscircuit symbol program with a `SYMBOL` metadata
// constant holding a path relative to the component file. That program *is* the
// symbol: it is run against this circuit, so the design draws exactly what the
// Part editor previews. Bare `tscircuit` imports are rewritten to this
// repository's copy, so a library anywhere on disk works.
const tscircuitEntry = pathToFileURL(require.resolve("tscircuit")).href;
const symbolScratch = mkdtempSync(join(tmpdir(), "ehdl-symbols-"));
const symbolModules = new Map(); // absolute path → builder function (or null)

/** Path of the symbol a component links, or null when it links none. */
function linkedSymbol(component) {
  const link = component.model.metadata
    ?.find((entry) => entry.key.toUpperCase() === "SYMBOL")
    ?.value?.trim();
  if (!link) return null;
  // Links are written with Windows separators; resolve them anywhere.
  return resolve(dirname(component.path), link.replace(/\\/g, "/"));
}

/** Load (once) the builder a symbol file exports. */
async function loadSymbol(path) {
  if (symbolModules.has(path)) return symbolModules.get(path);
  let build = null;
  if (existsSync(path)) {
    const source = readFileSync(path, "utf8").replace(
      /(from\s*|import\s*\(\s*)(["'])tscircuit\2/g,
      (_match, prefix, quote) => `${prefix}${quote}${tscircuitEntry}${quote}`,
    );
    // Node strips the TypeScript types itself; the copy is what the rewritten
    // import runs from and keeps the library file untouched.
    const moduleFile = join(symbolScratch, `${symbolModules.size}-${basename(path)}`);
    writeFileSync(moduleFile, source, "utf8");
    const loaded = await import(pathToFileURL(moduleFile).href);
    const candidate = loaded.default ?? loaded.symbol ?? loaded.build;
    if (typeof candidate === "function") build = candidate;
    else log(`symbol ${basename(path)}: no default-exported function — drawing ports instead`);
  }
  symbolModules.set(path, build);
  return build;
}

const symbolOf = new Map(); // refdes → absolute symbol path (for the checks below)
let fromSymbols = 0;

for (const instance of netlist.components) {
  const component = byEntity.get(instance.entity.toLowerCase());
  const symbolPath = component ? linkedSymbol(component) : null;
  const build = symbolPath ? await loadSymbol(symbolPath) : null;

  if (build) {
    try {
      // The name option is what makes the design's wires address this part.
      await build(circuit, { name: instance.refdes });
      symbolOf.set(instance.refdes, symbolPath);
      fromSymbols += 1;
      log(`symbol: ${instance.refdes} (${instance.entity}) drawn from ${symbolPath}`);
      continue;
    } catch (error) {
      log(`symbol: ${instance.refdes} (${instance.entity}) failed: ${error.message}`);
    }
  } else if (symbolPath) {
    log(`symbol: ${instance.entity} links '${symbolPath}', which is not there — drawing its ports`);
  }

  // No linked symbol: draw the ports on a plain body. The variant's footprint
  // name is deliberately *not* handed to tscircuit — that name is an IPC-7351
  // footprint ("DIP762W60P254L940H508Q8N"), and tscircuit reads the "762" of it
  // as a pin count, which drew a 762-pin part. Footprints belong to the board
  // stage, which builds them from the library's `.fpt` files.
  const pinLabels = {};
  for (const [port, pin] of Object.entries(instance.pins)) pinLabels[pin] = port;

  circuit.add(new Chip({ name: instance.refdes, pinLabels }));
}

log(
  `drawing: ${fromSymbols} part(s) from linked symbol files, ` +
    `${netlist.components.length - fromSymbols} from their ports`,
);
// Every symbol module is loaded now, so the rewritten copies can go.
rmSync(symbolScratch, { recursive: true, force: true });

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

// --- checks ----------------------------------------------------------------
// A symbol file has to name its part from `options.name` and draw every port
// the design connects; otherwise the wires cannot find it. Report it in the log
// the app shows instead of leaving a silently wrong drawing.
const sourceComponents = circuitJson.filter((element) => element.type === "source_component");
for (const instance of netlist.components) {
  const source = sourceComponents.find((component) => component.name === instance.refdes);
  if (!source) {
    log(
      `symbol: no part named '${instance.refdes}' (${instance.entity}) — a symbol program must ` +
        "name it from options.name, e.g. `new Chip({ name: options.name ?? \"…\" })`",
    );
    continue;
  }
  if (!symbolOf.has(instance.refdes)) continue;
  const drawn = new Set(
    circuitJson
      .filter(
        (element) =>
          element.type === "source_port" && element.source_component_id === source.source_component_id,
      )
      .map((port) => port.name),
  );
  const missing = Object.keys(instance.pins).filter((port) => !drawn.has(port));
  if (missing.length > 0) {
    log(`symbol: ${instance.refdes} (${instance.entity}) does not draw ${missing.join(", ")}`);
  }
}

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