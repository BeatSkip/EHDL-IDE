// Schematic generator — VHDL in, tscircuit schematic out.
//
// Pipeline (`docs/vhdl-implementation.md` sections 5.2 and 6):
//   1. read every component file in the library folder and the top-level design
//   2. parse them (the compiled TypeScript helpers in .tmp-schematic/)
//   3. elaborate: variant → pin numbers → nets (netlist + BOM)
//   4. draw every part with its symbol, wire it up, and render the SVG
//
// Where a part's symbol comes from, in order (`src/symbolFile.ts`):
//   * the `--#symbol` block inside the component file — the part *is* its symbol
//   * a `SYMBOL_KIND` constant (or a `SYMBOL` constant naming an element), one of
//     tscircuit's own elements with the part's ports and pin map filled in
//   * the symbol file the `SYMBOL` constant links
//   * what the part's name says it is: a two-pin part is drawn with the matching
//     element (LED, capacitor, resistor, diode), everything else as a chip body
//
// A symbol is a tscircuit React module; `scripts/lib/symbol-module.mjs` compiles
// and runs it against the React copy tscircuit itself uses.
//
// tscircuit only runs outside the webview, so this script is the "backend" of
// the schematic editor: the app spawns it through the Rust command
// `generate_schematic`, and the build runs it once to ship a first schematic.
//
// Usage:
//   node scripts/generate-schematic.mjs --lib <dir> --top <file> --out <dir>

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Circuit, Chip, Trace } from "tscircuit";
import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg";
import { createSymbolRunner } from "./lib/symbol-module.mjs";

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
const {
  inlineSymbolSource,
  symbolSourceFromComponent,
  resolveSymbolPath,
  asSymbolKind,
  detectKind,
  metadataValue,
} = await load("symbolFile");

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
  const text = readFileSync(path, "utf8");
  const { model, issues } = parseComponentVhdl(text, file.replace(/\..*$/, ""));
  // `path` is kept so a component's linked symbol can be resolved from it, and
  // `text` so the symbol it carries inline can be read.
  components.push({ entity: model.name, model, file, path, text });
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

// --- 4. symbols -------------------------------------------------------------
// Routing is disabled at the root: this stage produces the schematic only, and
// without PCB footprints the autorouter has nothing to route on. (The flag has
// to travel in `platform` — `Circuit` reads `routingDisabled` from there, a
// top-level `{ routingDisabled: true }` is dropped and the autorouter runs.)
const runner = createSymbolRunner(root);

/**
 * The source of a part's symbol and where it came from, or null when the part
 * has no component file and only its ports are known.
 */
function symbolFor(instance, component, model) {
  // 1. the symbol the part carries inline
  if (component) {
    const inline = inlineSymbolSource(component.text);
    if (inline) return { source: inline, origin: `the symbol inside ${component.file}` };
  }

  // 2. a declared kind — `<PART>_SYMBOL_KIND := "led"`, or a SYMBOL constant
  //    that names an element instead of a file
  const declared = model
    ? metadataValue(model, "SYMBOL_KIND") || metadataValue(model, "SYMBOL")
    : "";
  const declaredKind = declared ? asSymbolKind(declared) : null;
  if (model && declaredKind) {
    return {
      source: symbolSourceFromComponent(model, instance.variant, model.name, declaredKind),
      origin: `<${declaredKind}> (declared by the part)`,
    };
  }

  // 3. the symbol file the part links
  if (component && model) {
    const link = metadataValue(model, "SYMBOL");
    const path = link ? resolveSymbolPath(component.path, link) : null;
    if (path) {
      if (existsSync(path)) return { source: readFileSync(path, "utf8"), origin: path, file: path };
      log(`symbol: ${instance.entity} links '${path}', which is not there — drawing it another way`);
    }
  }

  if (!model) return null;

  // 4. what the part's name says it is
  const kind = detectKind(model);
  if (kind !== "chip") {
    return {
      source: symbolSourceFromComponent(model, instance.variant, model.name, kind),
      origin: `<${kind}> (from the part name)`,
    };
  }

  // 5. the ports on a plain body
  return { source: symbolSourceFromComponent(model, instance.variant, model.name), origin: "its ports" };
}

/** The `SYMBOL` link of a component, resolved to an absolute path. */

/** A part ready to draw: its compiled symbol and the ports the design wires. */
const parts = [];
const counts = { inline: 0, kind: 0, linked: 0, detected: 0, ports: 0 };

for (const instance of netlist.components) {
  const component = byEntity.get(instance.entity.toLowerCase());
  const model = component?.model ?? null;
  const chosen = symbolFor(instance, component, model);

  if (!chosen) {
    // No component file in the library: draw the ports of the design's own
    // pin map and let the netlist's wires reach them by port name.
    counts.ports += 1;
    log(`symbol: ${instance.refdes} (${instance.entity}) has no component file — drawing its ports`);
    parts.push({ instance, chip: () => chipFor(instance), origin: "its ports" });
    continue;
  }

  try {
    const build = await runner.load(chosen.source, instance.refdes);
    parts.push({ instance, build, origin: chosen.origin });
    if (chosen.origin.startsWith("the symbol inside")) counts.inline += 1;
    else if (chosen.origin.includes("declared")) counts.kind += 1;
    else if (chosen.file) counts.linked += 1;
    else if (chosen.origin.startsWith("<")) counts.detected += 1;
    else counts.ports += 1;
    log(`symbol: ${instance.refdes} (${instance.entity}) drawn from ${chosen.origin}`);
  } catch (error) {
    counts.ports += 1;
    parts.push({ instance, chip: () => chipFor(instance), origin: "its ports" });
    log(
      `symbol: ${instance.refdes} (${instance.entity}) failed: ` +
        `${error instanceof Error ? error.message : String(error)} — drawing its ports`,
    );
  }
}

/** A plain body with the part's ports, for a part no symbol could be found for. */
function chipFor(instance) {
  const pinLabels = {};
  for (const [port, pin] of Object.entries(instance.pins)) pinLabels[pin] = port;
  return new Chip({ name: instance.refdes, pinLabels });
}

log(
  `drawing: ${counts.inline} part(s) from a symbol inside the component, ` +
    `${counts.kind} by declared kind, ${counts.linked} from linked symbol files, ` +
    `${counts.detected} auto-detected, ${counts.ports} from their ports`,
);

// --- 5. wire the design -----------------------------------------------------
// A symbol decides how its ports are addressed: a chip labels its pins with the
// port names, while tscircuit's own resistor/capacitor keep theirs numbered. The
// parts are therefore drawn once on their own to learn which ports each one
// exposes, and the design's wires use a port name when the symbol has one and
// the package pin number when it does not.
const probes = drawParts(parts).getCircuitJson();
const ports = indexPorts(probes);

/**
 * A circuit with every part drawn and nothing wired.
 *
 * Every part is built fresh — a component instance belongs to the circuit it was
 * added to, so the probe and the real circuit each get their own.
 */
function drawParts(list) {
  const circuit = new Circuit({ platform: { routingDisabled: true } });
  for (const part of list) addTo(circuit, part);
  return circuit;
}

/** Draw one part into `circuit`, whichever way its symbol was resolved. */
function addTo(circuit, part) {
  if (part.chip) circuit.add(part.chip());
  else runner.add(circuit, part.build, { name: part.instance.refdes });
}

/** refdes → the port names and pin numbers a drawn symbol exposes. */
function indexPorts(circuitJson) {
  const names = new Map(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((component) => [component.source_component_id, component.name]),
  );
  const index = new Map();
  for (const port of circuitJson) {
    if (port.type !== "source_port") continue;
    const refdes = names.get(port.source_component_id);
    if (!refdes) continue;
    const entry = index.get(refdes) ?? { ports: new Set(), pins: new Set() };
    if (port.name) entry.ports.add(port.name);
    if (typeof port.pin_number === "number") entry.pins.add(port.pin_number);
    index.set(refdes, entry);
  }
  return index;
}

// --- checks -----------------------------------------------------------------
// A symbol has to name its part from its `name` prop (or `options.name`) and
// draw every port the design connects; otherwise the wires cannot find it.
// Report it in the log the app shows instead of leaving a silently wrong
// drawing. A port counts as drawn when the symbol has its name, or when it has
// the port's package pin number (tscircuit's own passives keep those numbered).
const sourceComponents = probes.filter((element) => element.type === "source_component");
for (const { instance } of parts) {
  const source = sourceComponents.find((component) => component.name === instance.refdes);
  if (!source) {
    log(
      `symbol: no part named '${instance.refdes}' (${instance.entity}) — a symbol must ` +
        'name it from the reference designator, e.g. `new Chip({ name: options.name ?? "…" })`',
    );
    continue;
  }
  const entry = ports.get(instance.refdes);
  const missing = Object.entries(instance.pins)
    .filter(([port, pin]) => !entry?.ports.has(port) && !entry?.pins.has(pin))
    .map(([port]) => port);
  if (missing.length > 0) {
    log(`symbol: ${instance.refdes} (${instance.entity}) does not draw ${missing.join(", ")}`);
  }
}

const circuit = new Circuit({ platform: { routingDisabled: true } });
for (const part of parts) addTo(circuit, part);
runner.dispose();

/** How the design addresses one end of a connection. */
function selectorFor(connection) {
  const entry = ports.get(connection.refdes);
  if (!entry) return null;
  if (entry.ports.has(connection.port)) return `${connection.refdes}.${connection.port}`;
  if (entry.pins.has(connection.pin)) return `${connection.refdes}.${connection.pin}`;
  return null;
}

for (const net of netlist.nets) {
  // Chain the pins of a net; tscircuit draws the schematic traces.
  const [first, ...rest] = net.connections;
  for (const connection of rest) {
    const from = selectorFor(first);
    const to = selectorFor(connection);
    if (!from || !to) {
      log(`net ${net.name}: ${connection.refdes}.${connection.port} is not drawn — no wire`);
      continue;
    }
    circuit.add(new Trace({ from, to }));
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
  design: designName,
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
