// Footprint generator — IPC parameters in, tscircuit footprint out.
//
// The IPC-7351 land pattern (pads, courtyard, silkscreen) is computed by the
// shared `src/ipcFootprint.ts` module — the same code the wizard uses — and
// tscircuit then builds the underlying footprint geometry from that pad list and
// renders it as a PCB SVG.
//
// tscircuit only runs outside the webview, so this is the backend half of the
// footprint wizard:
//   npm run gen:footprint                        # demo footprint (SOIC-8)
//   npm run gen:footprint -- --params fp.json    # from JSON parameters
//   npm run gen:footprint -- --file <fp.fpt> # rebuild from a footprint file
//
// Outputs (into --out, default src/generated): footprint.pcb.svg,
// footprint.circuit.json, footprint.txt (a short summary for the app).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Circuit, Footprint, PlatedHole, SmtPad } from "tscircuit";
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// The shared IPC model is TypeScript; mark the compiled folder as CommonJS
// before importing from it (this repository is an ES module package).
const compiledDir = join(root, ".tmp-footprint");
mkdirSync(compiledDir, { recursive: true });
writeFileSync(join(compiledDir, "package.json"), '{"type":"commonjs"}\n');

const { defaultParams, generateFootprint, ipcName, parseFootprint } = await import(
  pathToFileURL(join(compiledDir, "src", "ipcFootprint.js")).href
);

function flag(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outDir = resolve(root, flag("out", "src/generated"));
const paramsFile = flag("params");
const footprintFile = flag("file");

// --- 1. parameters → IPC land pattern --------------------------------------
let footprint;
if (footprintFile) {
  footprint = parseFootprint(readFileSync(resolve(root, footprintFile), "utf8"));
  console.log(`read footprint '${footprint.name}' from ${footprintFile}`);
} else {
  const params = paramsFile
    ? { ...defaultParams(), ...JSON.parse(readFileSync(resolve(root, paramsFile), "utf8")) }
    : { ...defaultParams("dual", "nominal"), partName: "soic8", namePrefix: "SOIC", count: 8, pitch: 1.27, span: 6, leadWidth: 0.6, leadLength: 1.5, body: { width: 3.9, height: 5 }, height: 1.75 };
  footprint = generateFootprint(params);
  console.log(`generated '${footprint.name}' from ${paramsFile ?? "built-in SOIC-8 parameters"}`);
}
console.log(`  ${footprint.pads.length} pads, courtyard ${footprint.courtyard.width}×${footprint.courtyard.height} mm`);

// --- 2. build the footprint with tscircuit ---------------------------------
const circuit = new Circuit();
const node = new Footprint({ name: footprint.name });

for (const pad of footprint.pads) {
  const portHints = [`pin${pad.number}`];
  if (pad.kind === "tht") {
    node.add(
      new PlatedHole({
        shape: "circle",
        holeDiameter: pad.hole ?? pad.width / 2,
        outerDiameter: pad.width,
        x: pad.x,
        y: pad.y,
        portHints,
      }),
    );
  } else {
    node.add(
      new SmtPad({
        shape: pad.shape === "round" ? "circle" : "rect",
        x: pad.x,
        y: pad.y,
        width: pad.width,
        height: pad.height,
        layer: "top",
        portHints,
      }),
    );
  }
}
circuit.add(node);

const circuitJson = circuit.getCircuitJson();
const padCount = circuitJson.filter((element) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole").length;
console.log(`tscircuit built ${padCount} pad element(s)`);

// --- 3. outputs ------------------------------------------------------------
const svg = convertCircuitJsonToPcbSvg(circuitJson, { width: 600, height: 600 });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "footprint.pcb.svg"), svg, "utf8");
writeFileSync(join(outDir, "footprint.circuit.json"), `${JSON.stringify(circuitJson, null, 2)}\n`, "utf8");
writeFileSync(
  join(outDir, "footprint.txt"),
  [
    `name       = ${footprint.name}`,
    `family     = ${footprint.family}`,
    `density    = ${footprint.density}`,
    `pads       = ${footprint.pads.length}`,
    `courtyard  = ${footprint.courtyard.width} x ${footprint.courtyard.height}`,
    `ipcName    = ${footprint.name}`,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`footprint pcb svg generated (${svg.length} chars) → ${outDir}`);