/**
 * Symbols are tscircuit programs.
 *
 * A symbol file is a TypeScript module (`<name>.ts`) in a library's `symbols`
 * folder that draws the part with tscircuit itself — the same element API the
 * schematic generator uses. Nothing about the drawing is EHDL-specific, so any
 * tscircuit feature works and the tscircuit documentation applies directly.
 *
 * Contract: the module default-exports a function that adds the symbol to the
 * circuit it is handed. The options place the drawing in a design — above all
 * `name`, the instance's reference designator, which is the name the design's
 * wires address the part by (`U1.OUT`):
 *
 *   export default (circuit: Circuit, options: SymbolOptions = {}) => {
 *     circuit.add(new Chip({ name: options.name ?? "NE555", … }));
 *   };
 *
 * `scripts/generate-symbol.mjs` renders the symbol on its own (`--file`), which
 * is what the Part editor's preview and the library use, and
 * `scripts/generate-schematic.mjs` runs the very same module inside a design's
 * circuit, so the drawn part is the one the symbol file describes.
 */

import type { ComponentModel, PortDirection } from "./vhdlPart";
import { dirNameOf, fileNameOf } from "./libraryFiles";

/** Symbol files are TypeScript modules. */
export const SYMBOL_EXT = ".ts";

/**
 * True for symbol files — a `.ts` module inside a library's `symbols` folder.
 * Plain TypeScript elsewhere (a design-side helper, say) is not a symbol.
 */
export function isSymbolFile(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]/);
  const file = segments[segments.length - 1] ?? "";
  return file.endsWith(SYMBOL_EXT) && segments.includes("symbols");
}

/** Where a pin goes on the drawn body. */
function sideFor(direction: PortDirection): "left" | "right" {
  return direction === "out" ? "right" : "left";
}

/**
 * tscircuit source for a symbol of a component: every entity port becomes a pin
 * with its number from the chosen package variant, inputs on the left and
 * outputs on the right — complete, and ready to tune.
 */
export function symbolSourceFromComponent(
  component: ComponentModel,
  variantName: string,
  symbolName?: string,
): string {
  const variant =
    component.variants.find((item) => item.name.toLowerCase() === variantName.toLowerCase()) ??
    component.variants.find(
      (item) => item.name.toLowerCase() === component.defaultVariant.toLowerCase(),
    ) ??
    component.variants[0];

  const name = symbolName ?? component.name;
  const pins = component.ports.map((port) => ({
    port: port.name,
    pin: variant?.pins[port.name] ?? 0,
    side: sideFor(port.direction),
  }));

  const bySide = (side: "left" | "right") => pins.filter((entry) => entry.side === side);
  const left = bySide("left");
  const right = bySide("right");

  // One body row per pin pair, on the usual 2.54 mm grid.
  const rows = Math.max(left.length, right.length, 2);
  const height = Math.max(5.08, Math.round(rows * 2.54 * 100) / 100);
  const width = 7.62;

  const pinEntries = pins
    .filter((entry) => entry.pin > 0)
    .map((entry) => `  ${entry.pin}: ${JSON.stringify(entry.port)},`)
    .join("\n");
  const listOf = (entries: { port: string }[]) =>
    `[${entries.map((entry) => JSON.stringify(entry.port)).join(", ")}]`;

  return `// ${name} — symbol generated from the component's ports and pins (${variant?.name ?? variantName}).
// This is an ordinary tscircuit program: https://docs.tscircuit.com
import { Chip, Circuit } from "tscircuit";

const pinLabels = {
${pinEntries}
} as const;

// The body, and which pin sits on which side of it (top to bottom).
const width = ${width};
const height = ${height};
const leftSide = ${listOf(left)};
const rightSide = ${listOf(right)};

/** \`name\` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default (circuit: Circuit, options: SymbolOptions = {}) => {
  circuit.add(
    new Chip({
      name: options.name ?? ${JSON.stringify(name)},
      pinLabels,
      schWidth: width,
      schHeight: height,
      schPinArrangement: { leftSide, rightSide },
      // No position on purpose: tscircuit lays the part out itself, which is what
      // a design needs. Pass schX/schY to pin it to a fixed spot.
      ...(options.schX === undefined ? {} : { schX: options.schX, schY: options.schY ?? 0 }),
    }),
  );

  // Extra drawing, in symbol coordinates (centre = 0,0), e.g.:
  // circuit.add(new SchematicLine({ x1: -3.8, y1: 0, x2: 3.8, y2: 0 }));
  // circuit.add(new SchematicText({ schX: 0, schY: ${-(height / 2 + 1.27)}, text: ${JSON.stringify(name)} }));
};
`;
}

// ---- paths -----------------------------------------------------------------

/** Split a path into segments and keep the separator it uses. */
function splitPath(path: string): { segments: string[]; sep: string } {
  return { segments: path.split(/[\\/]/), sep: path.includes("\\") ? "\\" : "/" };
}

/**
 * Absolute path of a symbol link. Links are stored relative to the part file
 * (`..\\symbols\\ne555.ts`) so they keep working on another machine; a link that
 * is already absolute is used as it is.
 */
export function resolveSymbolPath(partPath: string, link: string): string | null {
  const value = link.trim();
  if (!value) return null;
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\")) return value;

  const { sep } = splitPath(partPath);
  const parts = dirNameOf(partPath).split(/[\\/]/);
  for (const segment of value.split(/[\\/]/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join(sep);
}

/**
 * Where a symbol's drawing is rendered: `<symbols>/generated/<name>/`, next to
 * the symbol files (every `generated/` folder is ignored by git). The generator
 * writes `symbol.svg` there, and the preview writes the source it drew as
 * `source.ts` — so an unsaved symbol can be previewed too.
 */
export function symbolPreviewDir(symbolPath: string): string {
  const { sep } = splitPath(symbolPath);
  const name = fileNameOf(symbolPath).replace(/\.[^.]*$/, "") || "symbol";
  return [dirNameOf(symbolPath), "generated", name].join(sep);
}

/** Source the preview handed to the generator (inside `symbolPreviewDir`). */
export const SYMBOL_PREVIEW_SOURCE = "source.ts";

/** Drawing the generator writes (inside `symbolPreviewDir`). */
export const SYMBOL_PREVIEW_SVG = "symbol.svg";
