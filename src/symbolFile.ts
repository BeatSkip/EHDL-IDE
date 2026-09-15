/**
 * Symbols are tscircuit React programs.
 *
 * A symbol says how a part is *drawn*: which tscircuit element it is, on which
 * pins its ports sit, and what goes around them. tscircuit's own documentation
 * uses React elements (`<chip>`, `<led>`, `<capacitor>`, …), so a symbol is
 * written the same way here:
 *
 *   export default ({ name }: SymbolOptions) => (
 *     <chip name={name} pinLabels={{ 1: "GND", 2: "TRIG" }} />
 *   );
 *
 * `name` is the instance's reference designator, which is the name the design's
 * wires address the part by (`U1.OUT`).
 *
 * A part can carry its symbol in three places, in this order:
 *
 *   1. **inline in the component file** — a `--#symbol … --#/symbol` comment
 *      block (see `inlineSymbolSource`), so the part *is* its symbol;
 *   2. **a kind constant** — `<PART>_SYMBOL_KIND := "led"`, one of the built-in
 *      tscircuit elements, with the part's ports and pin map filled in;
 *   3. **a linked symbol file** — the `SYMBOL` constant holds a path to a
 *      `.tsx` (or old `.ts`) module in the library's `symbols` folder.
 *
 * With none of those, a two-pin part whose name says what it is (LED, capacitor,
 * resistor, diode) is drawn with the matching tscircuit element — see
 * `detectKind` — and everything else as a `<chip>` body.
 *
 * The modules are run by `scripts/generate-symbol.mjs` (one symbol on its own,
 * for the editor's preview) and `scripts/generate-schematic.mjs` (every symbol
 * of a design), through `scripts/lib/symbol-module.mjs`.
 */

import type { ComponentModel, PortDirection } from "./vhdlPart";
import { dirNameOf, fileNameOf } from "./libraryFiles";

/** Generated symbol files are React modules. */
export const SYMBOL_EXT = ".tsx";

/** The old function-API form (still run, but new symbols are `.tsx`). */
export const SYMBOL_LEGACY_EXT = ".ts";

/**
 * True for symbol files — a `.tsx` (or legacy `.ts`) module inside a library's
 * `symbols` folder. Plain TypeScript elsewhere (a design-side helper, say) is
 * not a symbol.
 */
export function isSymbolFile(path: string): boolean {
  const segments = path.toLowerCase().split(/[\\/]/);
  const file = segments[segments.length - 1] ?? "";
  return (
    (file.endsWith(SYMBOL_EXT) || file.endsWith(SYMBOL_LEGACY_EXT)) && segments.includes("symbols")
  );
}

// ---- symbols carried inside a component file -------------------------------

/** Opens an inline symbol block: the VHDL comment line `--#symbol`. */
export const SYMBOL_BLOCK_OPEN = "--#symbol";

/** Closes an inline symbol block: the VHDL comment line `--#/symbol`. */
export const SYMBOL_BLOCK_CLOSE = "--#/symbol";

/**
 * The symbol source a component file carries inline, or null when it has none.
 *
 * The block is a comment, so VHDL tools ignore it; every line between the
 * delimiters loses its leading `--` and becomes a line of the React module.
 */
export function inlineSymbolSource(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === SYMBOL_BLOCK_OPEN);
  if (start < 0) return null;
  const end = lines.findIndex(
    (line, index) => index > start && line.trim().toLowerCase() === SYMBOL_BLOCK_CLOSE,
  );
  const body = lines.slice(start + 1, end < 0 ? undefined : end);
  const source = body.map(uncommentLine).join("\n").replace(/\s+$/, "");
  return source.trim() ? `${source}\n` : null;
}

/** Strips the VHDL comment marker from one line of an inline symbol block. */
function uncommentLine(line: string): string {
  const trimmed = line.replace(/^\s*/, "");
  if (!trimmed.startsWith("--")) return trimmed;
  return trimmed.slice(2).replace(/^ /, "");
}

/** A line of symbol source as a VHDL comment line. */
function commentLine(line: string): string {
  return line ? `-- ${line}` : "--";
}

/**
 * The component file with `source` as its inline symbol block: an existing block
 * is replaced, a file without one gets it appended after a blank line.
 */
export function withInlineSymbol(text: string, source: string): string {
  const body = source
    .replace(/\s+$/, "")
    .split(/\r?\n/)
    .map(commentLine)
    .join("\n");
  const block = `${SYMBOL_BLOCK_OPEN}\n${body}\n${SYMBOL_BLOCK_CLOSE}`;

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === SYMBOL_BLOCK_OPEN);
  if (start < 0) {
    const head = text.replace(/\s+$/, "");
    return `${head}${head ? "\n\n" : ""}${block}\n`;
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.trim().toLowerCase() === SYMBOL_BLOCK_CLOSE,
  );
  const rest = lines.slice(end < 0 ? lines.length : end + 1);
  return [...lines.slice(0, start), ...block.split("\n"), ...rest].join("\n");
}

/** The component file without its inline symbol block. */
export function withoutInlineSymbol(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === SYMBOL_BLOCK_OPEN);
  if (start < 0) return text;
  const end = lines.findIndex(
    (line, index) => index > start && line.trim().toLowerCase() === SYMBOL_BLOCK_CLOSE,
  );
  const kept = [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end + 1)];
  return `${kept.join("\n").replace(/\s+$/, "")}\n`;
}

// ---- built-in symbol kinds -------------------------------------------------

/**
 * The tscircuit elements a symbol can name instead of being written out: a part
 * whose drawing is the standard component symbol only needs the name.
 */
export type SymbolKind = "chip" | "led" | "diode" | "resistor" | "capacitor";

/** Every kind a `SYMBOL_KIND` constant may name. */
export const SYMBOL_KINDS: SymbolKind[] = ["chip", "led", "diode", "resistor", "capacitor"];

export function isSymbolKind(value: string): value is SymbolKind {
  return SYMBOL_KINDS.includes(value.trim().toLowerCase() as SymbolKind);
}

/** Normalise a declared kind, or null when it names no element. */
export function asSymbolKind(value: string): SymbolKind | null {
  const kind = value.trim().toLowerCase();
  return isSymbolKind(kind) ? kind : null;
}

/** What a part's name says it is, when it is one of the standard two-pin parts. */
const KIND_BY_NAME: [SymbolKind, RegExp][] = [
  ["led", /(^|_)LED($|_)/i],
  ["diode", /(^|_)DIODE($|_)/i],
  ["capacitor", /(^|_)(CAP|CAPACITOR)($|_)/i],
  ["resistor", /(^|_)(RES|RESISTOR)($|_)/i],
];

/**
 * The element a part is drawn with when nothing says otherwise: the standard
 * symbol for a two-pin part whose name says what it is (LED_RED → `<led>`,
 * CAPACITOR_10N → `<capacitor>`), and a chip body for anything else.
 */
export function detectKind(component: ComponentModel): SymbolKind {
  if (component.ports.length !== 2) return "chip";
  for (const [kind, pattern] of KIND_BY_NAME) {
    if (pattern.test(component.name)) return kind;
  }
  return "chip";
}

/** A `<PART>_<KEY>` metadata value, or "" when the part does not set it. */
export function metadataValue(component: ComponentModel, key: string): string {
  const entry = component.metadata.find((item) => item.key.toLowerCase() === key.toLowerCase());
  return entry?.value?.trim() ?? "";
}

// ---- the generated source --------------------------------------------------

/** Where a pin goes on the drawn body. */
function sideFor(direction: PortDirection): "left" | "right" {
  return direction === "out" ? "right" : "left";
}

/** Port names that say which end of a two-pin part is which. */
const ANODE_NAMES = /^(a|an|anode|pos|positive|p|\+)$/i;
const CATHODE_NAMES = /^(k|c|cathode|neg|negative|n|-)$/i;

/**
 * tscircuit source for a symbol of a component: a React module drawing the part
 * with `kind` — every port becomes a pin, with its number from the chosen
 * package variant — complete, and ready to tune.
 *
 * The body size is left to tscircuit for chip bodies: the `width`/`height`
 * constants and the `schWidth`/`schHeight` props they feed are written into the
 * template but commented out, so the drawn body fits the pins on its own.
 * Uncomment the four lines to pin the size to the grid-computed values.
 */
export function symbolSourceFromComponent(
  component: ComponentModel,
  variantName: string,
  symbolName?: string,
  kind?: SymbolKind,
): string {
  const variant = variantOf(component, variantName);
  const name = symbolName ?? component.name;
  const element = kind ?? detectKind(component);
  const header =
    `// ${name} — symbol generated from the component's ports and pins ` +
    `(${variant?.name ?? variantName}).\n` +
    "// This is an ordinary tscircuit React program: https://docs.tscircuit.com\n" +
    'import type { ReactElement } from "react";\n';

  /** The whole module: header, options type, and the element that draws it. */
  const module = (drawing: string) => `${header}
/** \`name\` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default ({ name, schX, schY }: SymbolOptions): ReactElement => (
${drawing}
);
`;

  if (element !== "chip") {
    return module(kindElement(component, variant, name, element));
  }

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

  return `${header}
const pinLabels = {
${pinEntries}
} as const;

// Which pin sits on which side of the body (top to bottom).
// The body size is left to tscircuit by default — uncomment these two constants
// (and the matching schWidth/schHeight below) to pin it to the size the ports
// imply. The values are on the usual 2.54 mm grid.
// const width = ${width};
// const height = ${height};
const leftSide = ${listOf(left)};
const rightSide = ${listOf(right)};

/** \`name\` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default ({ name, schX, schY }: SymbolOptions): ReactElement => (
  <chip
    name={name ?? ${JSON.stringify(name)}}
    pinLabels={pinLabels}
    // schWidth={width}
    // schHeight={height}
    schPinArrangement={{ leftSide, rightSide }}
    // No position on purpose: tscircuit lays the part out itself, which is what
    // a design needs. Pass schX/schY to pin it to a fixed spot.
    {...(schX === undefined ? {} : { schX, schY: schY ?? 0 })}
  />
);

// Extra drawing, in symbol coordinates (centre = 0,0), e.g.:
// <schematicline x1={-3.8} y1={0} x2={3.8} y2={0} />
`;
}

/** The variant a symbol draws, by name, then by the part's default. */
function variantOf(component: ComponentModel, variantName: string) {
  return (
    component.variants.find((item) => item.name.toLowerCase() === variantName.toLowerCase()) ??
    component.variants.find(
      (item) => item.name.toLowerCase() === component.defaultVariant.toLowerCase(),
    ) ??
    component.variants[0]
  );
}

/**
 * The JSX element for a part drawn with one of tscircuit's own elements.
 *
 * `<led>` and `<diode>` have the anode on pin 1 and the cathode on pin 2, so
 * their pins are labelled from the part's port names (A on the anode, K on the
 * cathode): the drawing comes out the right way round even when the package
 * puts the cathode on pin 1, which is what chip LEDs do.
 *
 * `<resistor>` and `<capacitor>` carry no port names of their own — their pins
 * are numbered, and the design's wires reach them by the part's pin numbers —
 * so they only need the value the part declares.
 */
function kindElement(
  component: ComponentModel,
  variant: { pins: Record<string, number> } | undefined,
  name: string,
  kind: Exclude<SymbolKind, "chip">,
): string {
  const pinOf = (port: string) => variant?.pins[port] ?? 0;
  const lines = [`    name={name ?? ${JSON.stringify(name)}}`];

  if (kind === "led" || kind === "diode") {
    const anode =
      component.ports.find((port) => ANODE_NAMES.test(port.name)) ??
      component.ports.find((port) => pinOf(port.name) === 1) ??
      component.ports[0];
    const cathode =
      component.ports.find((port) => port !== anode && CATHODE_NAMES.test(port.name)) ??
      component.ports.find((port) => port !== anode);
    lines.push(
      `    pinLabels={{ 1: ${JSON.stringify(anode?.name ?? "")}, 2: ${JSON.stringify(
        cathode?.name ?? "",
      )} }}`,
    );
    if (kind === "led") {
      const color = metadataValue(component, "COLOR");
      if (/^[a-z]+$/i.test(color)) lines.push(`    color=${JSON.stringify(color.toLowerCase())}`);
    }
  } else {
    const value = metadataValue(component, "VALUE") || "?";
    const prop = kind === "resistor" ? "resistance" : "capacitance";
    lines.push(`    ${prop}=${JSON.stringify(value)}`);
  }

  // A design lays the part out itself; schX/schY pin it to a fixed spot.
  lines.push("    {...(schX === undefined ? {} : { schX, schY: schY ?? 0 })}");

  return `  <${kind}\n${lines.join("\n")}\n  />`;
}

// ---- paths -----------------------------------------------------------------

/** Split a path into segments and keep the separator it uses. */
function splitPath(path: string): { segments: string[]; sep: string } {
  return { segments: path.split(/[\\/]/), sep: path.includes("\\") ? "\\" : "/" };
}

/**
 * Absolute path of a symbol link. Links are stored relative to the part file
 * (`..\\symbols\\ne555.tsx`) so they keep working on another machine; a link that
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
 * `source.tsx` — so an unsaved symbol can be previewed too.
 */
export function symbolPreviewDir(symbolPath: string): string {
  const { sep } = splitPath(symbolPath);
  const name = fileNameOf(symbolPath).replace(/\.[^.]*$/, "") || "symbol";
  return [dirNameOf(symbolPath), "generated", name].join(sep);
}

/** Source the preview handed to the generator (inside `symbolPreviewDir`). */
export const SYMBOL_PREVIEW_SOURCE = "source.tsx";

/** Drawing the generator writes (inside `symbolPreviewDir`). */
export const SYMBOL_PREVIEW_SVG = "symbol.svg";
