/**
 * IPC-7351 style footprint generation.
 *
 * The wizard collects the package parameters, this module computes the land
 * pattern (pads, courtyard, silkscreen), names it after the IPC-7351B naming
 * convention and writes the footprint file. tscircuit then builds the actual
 * footprint geometry from the same pad list (see
 * `scripts/generate-footprint.mjs`), which is what ends up in the design.
 *
 * IMPORTANT: the joint constants below are defaults in the spirit of IPC-7351
 * (per family and density level). Every dimension is exposed as an editable
 * number in the wizard, and a generated footprint should be reviewed against
 * the standard and the part's datasheet before production use.
 */

export type IpcFamily = "chip" | "dual" | "quad" | "no-lead" | "dip" | "tab" | "sot" | "bga";
export type IpcDensity = "least" | "nominal" | "most";
export type PadKind = "smd" | "tht";

export interface IpcPad {
  /** Pin number / name. */
  number: string;
  kind: PadKind;
  /** Centre in mm, origin at the package centre. */
  x: number;
  y: number;
  /** Pad size in mm. */
  width: number;
  height: number;
  /** Round pads (through-hole) vs. rectangular (SMD). */
  shape: "rect" | "round" | "oval";
  /** Drill diameter for through-hole pads. */
  hole?: number;
  /** Exposed thermal pad (paste-only pads are marked too). */
  thermal?: boolean;
}

export interface IpcFootprint {
  name: string;
  family: IpcFamily;
  density: IpcDensity;
  description: string;
  pads: IpcPad[];
  /** Courtyard and silkscreen outlines, as centre/width/height rectangles. */
  courtyard: { width: number; height: number };
  silkscreen: { width: number; height: number };
}

/** Density letter used by IPC-7351B names: L = least, N = nominal, M = most. */
export const DENSITY_LETTER: Record<IpcDensity, string> = {
  least: "L",
  nominal: "N",
  most: "M",
};

export const DENSITY_LABEL: Record<IpcDensity, string> = {
  least: "Least (A) — most solder, easiest to assemble",
  nominal: "Nominal (B) — the usual choice",
  most: "Most (C) — densest, hardest to assemble",
};

/** Joint constants per family and density (mm). Editable defaults. */
interface Joints {
  /** Pad extension beyond the lead tip (per side). */
  toe: number;
  /** Pad extension inwards, under the lead. */
  heel: number;
  /** Pad extension on each side of the lead (width growth / 2). */
  side: number;
  /** Through-hole only: hole clearance over the lead diameter. */
  hole: number;
  /** Through-hole only: annular ring width. */
  annular: number;
}

const JOINT_TABLE: Record<IpcFamily, Record<IpcDensity, Joints>> = {
  chip: {
    least: { toe: 0.55, heel: 0.05, side: 0.05, hole: 0, annular: 0 },
    nominal: { toe: 0.35, heel: 0.05, side: 0.03, hole: 0, annular: 0 },
    most: { toe: 0.15, heel: 0.05, side: 0.01, hole: 0, annular: 0 },
  },
  dual: {
    least: { toe: 0.55, heel: 0.45, side: 0.05, hole: 0, annular: 0 },
    nominal: { toe: 0.35, heel: 0.35, side: 0.03, hole: 0, annular: 0 },
    most: { toe: 0.15, heel: 0.25, side: 0.01, hole: 0, annular: 0 },
  },
  quad: {
    least: { toe: 0.55, heel: 0.45, side: 0.05, hole: 0, annular: 0 },
    nominal: { toe: 0.35, heel: 0.35, side: 0.03, hole: 0, annular: 0 },
    most: { toe: 0.15, heel: 0.25, side: 0.01, hole: 0, annular: 0 },
  },
  "no-lead": {
    least: { toe: 0.4, heel: 0.2, side: 0.05, hole: 0, annular: 0 },
    nominal: { toe: 0.3, heel: 0.15, side: 0.03, hole: 0, annular: 0 },
    most: { toe: 0.2, heel: 0.1, side: 0.01, hole: 0, annular: 0 },
  },
  dip: {
    least: { toe: 0, heel: 0, side: 0, hole: 0.2, annular: 0.25 },
    nominal: { toe: 0, heel: 0, side: 0, hole: 0.15, annular: 0.2 },
    most: { toe: 0, heel: 0, side: 0, hole: 0.1, annular: 0.15 },
  },
  // DPAK/D2PAK/SOT-223: a wide tab opposite the leads takes more solder.
  tab: {
    least: { toe: 0.55, heel: 0.4, side: 0.3, hole: 0, annular: 0 },
    nominal: { toe: 0.4, heel: 0.3, side: 0.2, hole: 0, annular: 0 },
    most: { toe: 0.25, heel: 0.2, side: 0.1, hole: 0, annular: 0 },
  },
  // SOT-23/SC-70: short gullwing leads.
  sot: {
    least: { toe: 0.4, heel: 0.35, side: 0.06, hole: 0, annular: 0 },
    nominal: { toe: 0.3, heel: 0.25, side: 0.04, hole: 0, annular: 0 },
    most: { toe: 0.2, heel: 0.2, side: 0.02, hole: 0, annular: 0 },
  },
  // BGA: the ball diameter is grown by `side` on each side.
  bga: {
    least: { toe: 0, heel: 0, side: 0.05, hole: 0, annular: 0 },
    nominal: { toe: 0, heel: 0, side: 0.03, hole: 0, annular: 0 },
    most: { toe: 0, heel: 0, side: 0.01, hole: 0, annular: 0 },
  },
};

export const FAMILY_LABEL: Record<IpcFamily, string> = {
  chip: "Two-terminal chip (resistor, capacitor, LED)",
  dual: "Dual row gullwing (SOIC, SOP, TSSOP)",
  quad: "Quad gullwing (QFP, LQFP)",
  "no-lead": "Quad no-lead (QFN, DFN)",
  dip: "Through-hole dual row (DIP)",
  tab: "Tab with leads (DPAK, D2PAK, SOT-223, TO-220)",
  sot: "Small outline transistor (SOT-23, SC-70)",
  bga: "Ball grid array (BGA, CSP)",
};

/** Editable parameters of one generation run (mm unless noted). */
export interface IpcParams {
  family: IpcFamily;
  density: IpcDensity;
  /** Part name prefix used for the file name, e.g. "LM358". */
  partName: string;
  /** Family prefix in the IPC name: SOIC, QFP, QFN, CAPC… */
  namePrefix: string;
  /** Pin count (chip: always 2). */
  count: number;
  /** Lead pitch along a row/side. */
  pitch: number;
  /** Pin 1 to pin n spacing, i.e. the lead-tip span across the package. */
  span: number;
  /** Lead / terminal width. */
  leadWidth: number;
  /** Lead length for gullwing and no-lead families. */
  leadLength: number;
  /** Body size across the leads (dual) or in X and Y (quad, no-lead). */
  body: { width: number; height: number };
  /** Package height (used in the IPC name). */
  height: number;
  /** Through-hole: lead diameter and row spacing. */
  leadDiameter: number;
  rowSpacing: number;
  /** No-lead: exposed thermal pad, given as its own size (0 = none). */
  thermalPad: { width: number; height: number };
  /** Tab family: the tab pad opposite the leads (0 = derived from the body). */
  tab: { width: number; height: number };
}

export function defaultParams(family: IpcFamily = "dual", density: IpcDensity = "nominal"): IpcParams {
  const base: IpcParams = {
    family,
    density,
    partName: "new_footprint",
    namePrefix: family === "dual" ? "SOIC" : family === "quad" ? "QFP" : family === "no-lead" ? "QFN" : family === "dip" ? "DIP" : "CAPC",
    count: family === "chip" ? 2 : family === "dip" ? 8 : 8,
    pitch: family === "dip" ? 2.54 : family === "quad" || family === "no-lead" ? 0.5 : family === "chip" ? 0 : 1.27,
    span: 6,
    leadWidth: 0.6,
    leadLength: 1.5,
    body: { width: 3.9, height: 5 },
    height: 1.75,
    leadDiameter: 0.5,
    rowSpacing: 7.62,
    thermalPad: { width: 0, height: 0 },
    tab: { width: 0, height: 0 },
  };
  if (family === "chip") {
    return { ...base, pitch: 0, span: 1.6, leadWidth: 0.8, body: { width: 0.5, height: 1.6 }, height: 0.55, namePrefix: "CAPC" };
  }
  if (family === "quad") {
    return { ...base, count: 32, pitch: 0.5, span: 9, leadWidth: 0.3, leadLength: 0.6, body: { width: 7, height: 7 }, height: 1.4, namePrefix: "QFP" };
  }
  if (family === "no-lead") {
    return { ...base, count: 32, pitch: 0.5, span: 5, leadWidth: 0.28, leadLength: 0.4, body: { width: 5, height: 5 }, height: 0.9, namePrefix: "QFN", thermalPad: { width: 3.4, height: 3.4 } };
  }
  if (family === "dip") {
    return { ...base, count: 8, pitch: 2.54, leadWidth: 0.6, leadLength: 0, body: { width: 6.35, height: 9.27 }, height: 5.08, leadDiameter: 0.5, rowSpacing: 7.62, namePrefix: "DIP" };
  }
  if (family === "tab") {
    // DPAK (TO-252) by default: two leads plus the tab.
    return {
      ...base,
      count: 2,
      pitch: 2.28,
      span: 6.1,
      leadWidth: 0.9,
      leadLength: 2.2,
      body: { width: 6.1, height: 6.5 },
      height: 2.3,
      namePrefix: "TO252",
    };
  }
  if (family === "sot") {
    // SOT-23: two leads on one side, one opposite.
    return {
      ...base,
      count: 3,
      pitch: 0.95,
      span: 2.9,
      leadWidth: 0.5,
      leadLength: 0.6,
      body: { width: 1.3, height: 2.9 },
      height: 1.1,
      namePrefix: "SOT23",
    };
  }
  if (family === "bga") {
    return {
      ...base,
      count: 49,
      pitch: 0.8,
      leadWidth: 0.35, // ball diameter
      body: { width: 8, height: 8 },
      height: 1.2,
      namePrefix: "BGA",
    };
  }
  return base;
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

/** `6.005` → `600`, the way IPC names encode hundredths of a millimetre. */
function ipcNumber(mm: number, scale = 100): string {
  return String(Math.round(mm * scale));
}

/**
 * IPC-7351B name, e.g. `SOIC127P600X175-8N` (pitch 1.27, span 6.00, height
 * 1.75, 8 pins, nominal density) — the same shape as the names used by the
 * component `*_FP` constants.
 */
export function ipcName(params: IpcParams): string {
  const letter = DENSITY_LETTER[params.density];
  const pitch = ipcNumber(params.pitch);
  switch (params.family) {
    case "chip":
      return `${params.namePrefix}${ipcNumber(params.body.width, 10)}${ipcNumber(
        params.body.height,
        10,
      )}X${ipcNumber(params.height)}${letter}`;
    case "dip":
      return `${params.namePrefix}${ipcNumber(params.rowSpacing)}W${ipcNumber(
        params.leadWidth,
      )}P${ipcNumber(params.pitch)}L${ipcNumber(params.body.height)}H${ipcNumber(
        params.height,
      )}Q${params.count}${letter}`;
    case "quad":
    case "no-lead": {
      const pads = params.count + (params.thermalPad.width > 0 ? 1 : 0);
      return `${params.namePrefix}${pitch}P${ipcNumber(params.body.width)}X${ipcNumber(
        params.body.height,
      )}X${ipcNumber(params.height)}-${pads}${letter}`;
    }
    case "tab":
      return `${params.namePrefix}${pitch}P${ipcNumber(params.body.width)}X${ipcNumber(
        params.height,
      )}-${params.count + 1}${letter}`;
    case "sot":
      return `${params.namePrefix}${pitch}P${ipcNumber(params.span)}X${ipcNumber(
        params.height,
      )}-${params.count}${letter}`;
    case "bga":
      return `${params.namePrefix}${pitch}P${ipcNumber(params.body.width)}X${ipcNumber(
        params.body.height,
      )}-${params.count}${letter}`;
    default:
      return `${params.namePrefix}${pitch}P${ipcNumber(params.span)}X${ipcNumber(
        params.height,
      )}-${params.count}${letter}`;
  }
}

/** Two-terminal chip: one pad on each end. */
function chipPads(params: IpcParams, joints: Joints): IpcPad[] {
  const z = params.span + 2 * joints.toe; // outer-to-outer pad span
  const g = params.span - 2 * joints.heel; // gap between pads
  const length = (z - g) / 2;
  const width = params.leadWidth + 2 * joints.side;
  const offset = (z + g) / 4;
  return [1, 2].map((index) => ({
    number: String(index),
    kind: "smd" as PadKind,
    x: round(index === 1 ? -offset : offset),
    y: 0,
    width: round(length),
    height: round(width),
    shape: "rect" as const,
  }));
}

/** Dual row gullwing: pin 1 top-left, down the left column, up the right. */
function dualPads(params: IpcParams, joints: Joints): IpcPad[] {
  const perSide = Math.max(1, Math.floor(params.count / 2));
  const z = params.span + 2 * joints.toe;
  const length = joints.toe + params.leadLength - joints.heel;
  const width = params.leadWidth + 2 * joints.side;
  const offset = (z + (z - 2 * length)) / 4;
  const pads: IpcPad[] = [];
  for (let i = 0; i < perSide; i += 1) {
    const y = round((i - (perSide - 1) / 2) * params.pitch);
    pads.push({
      number: String(i + 1),
      kind: "smd",
      x: round(-offset),
      y,
      width: round(length),
      height: round(width),
      shape: "rect",
    });
    pads.push({
      number: String(params.count - i),
      kind: "smd",
      x: round(offset),
      y,
      width: round(length),
      height: round(width),
      shape: "rect",
    });
  }
  return pads.sort((a, b) => Number(a.number) - Number(b.number));
}

/** Quad gullwing / no-lead: pads on all four sides, numbered anticlockwise. */
function quadPads(params: IpcParams, joints: Joints): IpcPad[] {
  const perSide = Math.max(1, Math.floor(params.count / 4));
  const outward = params.family === "no-lead" ? params.leadLength / 2 : params.leadLength;
  const length = params.family === "no-lead" ? joints.toe + joints.heel : joints.toe + outward - joints.heel;
  const width = params.leadWidth + 2 * joints.side;
  const pads: IpcPad[] = [];

  for (let i = 0; i < perSide; i += 1) {
    const along = round((i - (perSide - 1) / 2) * params.pitch);
    const bodyHalfX = params.body.width / 2;
    const bodyHalfY = params.body.height / 2;
    const sideOffsetX =
      params.family === "no-lead" ? bodyHalfX + (joints.toe - joints.heel) / 2 : bodyHalfX + outward / 2 - joints.heel / 2 + joints.toe / 2;
    const sideOffsetY =
      params.family === "no-lead" ? bodyHalfY + (joints.toe - joints.heel) / 2 : bodyHalfY + outward / 2 - joints.heel / 2 + joints.toe / 2;

    // left side (numbers 1…n/4, top to bottom)
    pads.push({ number: String(i + 1), kind: "smd", x: round(-sideOffsetX), y: along, width: round(length), height: round(width), shape: "rect" });
    // bottom side (left to right)
    pads.push({ number: String(perSide + i + 1), kind: "smd", x: along, y: round(-sideOffsetY), width: round(width), height: round(length), shape: "rect" });
    // right side (bottom to top)
    pads.push({ number: String(2 * perSide + i + 1), kind: "smd", x: round(sideOffsetX), y: round(-along), width: round(length), height: round(width), shape: "rect" });
    // top side (right to left)
    pads.push({ number: String(3 * perSide + i + 1), kind: "smd", x: round(-along), y: round(sideOffsetY), width: round(width), height: round(length), shape: "rect" });
  }

  if (params.thermalPad.width > 0 && params.thermalPad.height > 0) {
    pads.push({
      number: String(params.count + 1),
      kind: "smd",
      x: 0,
      y: 0,
      width: round(params.thermalPad.width),
      height: round(params.thermalPad.height),
      shape: "rect",
      thermal: true,
    });
  }

  return pads.sort((a, b) => Number(a.number) - Number(b.number));
}

/** Through-hole dual row: round pads, pin 1 top-left. */
function dipPads(params: IpcParams, joints: Joints): IpcPad[] {
  const perSide = Math.max(1, Math.floor(params.count / 2));
  const hole = params.leadDiameter + joints.hole;
  const pad = hole + 2 * joints.annular;
  const pads: IpcPad[] = [];
  for (let i = 0; i < perSide; i += 1) {
    const y = round((i - (perSide - 1) / 2) * params.pitch);
    pads.push({
      number: String(i + 1),
      kind: "tht",
      x: round(-params.rowSpacing / 2),
      y,
      width: round(pad),
      height: round(pad),
      shape: "round",
      hole: round(hole, 2),
    });
    pads.push({
      number: String(params.count - i),
      kind: "tht",
      x: round(params.rowSpacing / 2),
      y,
      width: round(pad),
      height: round(pad),
      shape: "round",
      hole: round(hole, 2),
    });
  }
  return pads.sort((a, b) => Number(a.number) - Number(b.number));
}

/**
 * Tab with leads (DPAK/TO-252, D2PAK/TO-263, SOT-223, TO-220): leads along one
 * edge and one wide tab opposite them, which is pin `count + 1`.
 */
function tabPads(params: IpcParams, joints: Joints): IpcPad[] {
  const width = params.leadWidth + 2 * joints.side;
  const length = joints.toe + params.leadLength - joints.heel;
  const halfBody = params.body.height / 2;
  const pads: IpcPad[] = [];

  for (let i = 0; i < params.count; i += 1) {
    pads.push({
      number: String(i + 1),
      kind: "smd",
      x: round((i - (params.count - 1) / 2) * params.pitch),
      y: round(-(halfBody + params.leadLength / 2 - joints.heel / 2 + joints.toe / 2)),
      width: round(width),
      height: round(length),
      shape: "rect",
    });
  }

  // The tab is sized from the body and the lead length unless overridden.
  const tabHeight = params.tab.height || params.leadLength + joints.toe + joints.heel;
  const tabWidth = params.tab.width || params.body.width * 0.8;
  pads.push({
    number: String(params.count + 1),
    kind: "smd",
    x: 0,
    y: round(halfBody + tabHeight / 2 - joints.heel),
    width: round(tabWidth),
    height: round(tabHeight),
    shape: "rect",
    thermal: true,
  });

  return pads;
}

/** Small outline transistor: uneven rows, e.g. SOT-23 = 2 + 1. */
function sotPads(params: IpcParams, joints: Joints): IpcPad[] {
  const bottom = Math.ceil(params.count / 2);
  const top = params.count - bottom;
  const z = params.span + 2 * joints.toe;
  const length = joints.toe + params.leadLength - joints.heel;
  const width = params.leadWidth + 2 * joints.side;
  const offset = (z + (z - 2 * length)) / 4;
  const pads: IpcPad[] = [];

  for (let i = 0; i < bottom; i += 1) {
    pads.push({
      number: String(i + 1),
      kind: "smd",
      x: round((i - (bottom - 1) / 2) * params.pitch),
      y: round(-offset),
      width: round(width),
      height: round(length),
      shape: "rect",
    });
  }
  for (let i = 0; i < top; i += 1) {
    pads.push({
      number: String(bottom + i + 1),
      kind: "smd",
      x: round(-(i - (top - 1) / 2) * params.pitch),
      y: round(offset),
      width: round(width),
      height: round(length),
      shape: "rect",
    });
  }

  return pads.sort((a, b) => Number(a.number) - Number(b.number));
}

/** Ball grid array: a square-ish grid of round pads under the body. */
function bgaPads(params: IpcParams, joints: Joints): IpcPad[] {
  const cols = Math.max(1, Math.round(Math.sqrt(params.count)));
  const rows = Math.ceil(params.count / cols);
  const ball = params.leadWidth + 2 * joints.side;
  const pads: IpcPad[] = [];
  let index = 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols && index <= params.count; col += 1) {
      pads.push({
        number: String(index),
        kind: "smd",
        x: round((col - (cols - 1) / 2) * params.pitch),
        y: round(((rows - 1) / 2 - row) * params.pitch),
        width: round(ball),
        height: round(ball),
        shape: "round",
      });
      index += 1;
    }
  }

  return pads;
}

/** Compute the land pattern for the given parameters. */
export function generateFootprint(params: IpcParams): IpcFootprint {
  const joints = JOINT_TABLE[params.family][params.density];
  let pads: IpcPad[];
  switch (params.family) {
    case "chip":
      pads = chipPads(params, joints);
      break;
    case "quad":
    case "no-lead":
      pads = quadPads(params, joints);
      break;
    case "dip":
      pads = dipPads(params, joints);
      break;
    case "tab":
      pads = tabPads(params, joints);
      break;
    case "sot":
      pads = sotPads(params, joints);
      break;
    case "bga":
      pads = bgaPads(params, joints);
      break;
    default:
      pads = dualPads(params, joints);
  }

  const extent = (axis: "x" | "y") =>
    pads.reduce((max, pad) => Math.max(max, Math.abs(pad[axis]) + (axis === "x" ? pad.width : pad.height) / 2), 0);

  // Courtyard: whichever is larger — the pads or the package body — plus the
  // usual 0.25 mm excess. The body only counts where its axes map to x/y (for
  // chips and dual/sot/tab the pads always extend past the body).
  const bodySpansAxes =
    params.family === "quad" || params.family === "no-lead" || params.family === "bga" || params.family === "dip";
  const courtyard = {
    width: round(Math.max(extent("x") * 2, bodySpansAxes ? params.body.width : 0) + 0.5),
    height: round(Math.max(extent("y") * 2, bodySpansAxes ? params.body.height : 0) + 0.5),
  };
  const silkscreen = {
    width: round(Math.max(params.body.width, extent("x") * 2) + 0.2),
    height: round(Math.max(params.body.height, extent("y") * 2) + 0.2),
  };

  return {
    name: ipcName(params),
    family: params.family,
    density: params.density,
    description: `${FAMILY_LABEL[params.family]} · ${params.count} pins · ${DENSITY_LABEL[params.density]}`,
    pads,
    courtyard,
    silkscreen,
  };
}

// ---------------------------------------------------------------------------
// Footprint file format (provisional plain text, like the other EHDL files)
// ---------------------------------------------------------------------------

/** Extension of footprint files. */
export const FOOTPRINT_EXT = ".fpt";

export function serializeFootprint(footprint: IpcFootprint): string {
  const lines = [
    "# EHDL footprint — provisional plain-text format.",
    "# Generated by the IPC footprint wizard; the geometry is rebuilt by tscircuit.",
    "",
    "kind        = footprint",
    `name        = ${footprint.name}`,
    `family      = ${footprint.family}`,
    `density     = ${footprint.density}`,
    `description = ${footprint.description}`,
    `courtyard   = ${footprint.courtyard.width} x ${footprint.courtyard.height}`,
    `silkscreen  = ${footprint.silkscreen.width} x ${footprint.silkscreen.height}`,
    "",
    "pads:            # number | kind | x | y | width | height | shape | hole",
  ];
  for (const pad of footprint.pads) {
    lines.push(
      `  ${pad.number} | ${pad.kind}${pad.thermal ? " (thermal)" : ""} | ${pad.x} | ${pad.y} | ${pad.width} | ${pad.height} | ${pad.shape} | ${pad.hole ?? 0}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Parse a footprint file back (tolerant; unknown lines are ignored). */
export function parseFootprint(text: string): IpcFootprint {
  const footprint: IpcFootprint = {
    name: "",
    family: "dual",
    density: "nominal",
    description: "",
    pads: [],
    courtyard: { width: 0, height: 0 },
    silkscreen: { width: 0, height: 0 },
  };
  let inPads = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^pads\s*:/i.test(line)) {
      inPads = true;
      continue;
    }
    const keyValue = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
    if (keyValue && !inPads) {
      const key = keyValue[1].toLowerCase();
      const value = keyValue[2].trim();
      if (key === "name") footprint.name = value;
      else if (key === "family") footprint.family = value as IpcFamily;
      else if (key === "density") footprint.density = value as IpcDensity;
      else if (key === "description") footprint.description = value;
      else if (key === "courtyard" || key === "silkscreen") {
        const [width, height] = value.split("x").map((part) => Number(part.trim()));
        footprint[key] = { width: width || 0, height: height || 0 };
      }
      continue;
    }
    if (inPads) {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length < 6) continue;
      footprint.pads.push({
        number: parts[0],
        kind: (parts[1].startsWith("tht") ? "tht" : "smd") as PadKind,
        x: Number(parts[2]),
        y: Number(parts[3]),
        width: Number(parts[4]),
        height: Number(parts[5]),
        shape: (parts[6] as IpcPad["shape"]) ?? "rect",
        hole: Number(parts[7]) || undefined,
        thermal: parts[1].includes("thermal"),
      });
    }
  }
  return footprint;
}

// ---------------------------------------------------------------------------
// Preview: a small SVG drawn straight from the pad list, so the wizard can show
// the land pattern without running tscircuit (which needs the Node process).
// ---------------------------------------------------------------------------

export function footprintToSvg(footprint: IpcFootprint, size = 260): string {
  const padExtentX = footprint.pads.reduce((max, pad) => Math.max(max, Math.abs(pad.x) + pad.width / 2), 1);
  const padExtentY = footprint.pads.reduce((max, pad) => Math.max(max, Math.abs(pad.y) + pad.height / 2), 1);
  const halfX = Math.max(padExtentX, footprint.courtyard.width / 2);
  const halfY = Math.max(padExtentY, footprint.courtyard.height / 2);
  const scale = (size - 20) / (2 * Math.max(halfX, halfY, 0.5));
  const cx = size / 2;
  const cy = size / 2;
  const px = (value: number) => round(cx + value * scale, 2);
  const py = (value: number) => round(cy - value * scale, 2);

  const rect = (x: number, y: number, w: number, h: number, cls: string, extra = "") =>
    `<rect x="${px(x - w / 2)}" y="${py(y + h / 2)}" width="${round(w * scale, 2)}" height="${round(
      h * scale,
      2,
    )}" class="${cls}"${extra} />`;

  const parts: string[] = [
    `<rect x="${px(-footprint.courtyard.width / 2)}" y="${py(footprint.courtyard.height / 2)}" width="${round(
      footprint.courtyard.width * scale,
      2,
    )}" height="${round(footprint.courtyard.height * scale, 2)}" class="fp-courtyard" />`,
    `<rect x="${px(-footprint.silkscreen.width / 2)}" y="${py(footprint.silkscreen.height / 2)}" width="${round(
      footprint.silkscreen.width * scale,
      2,
    )}" height="${round(footprint.silkscreen.height * scale, 2)}" class="fp-silk" />`,
  ];

  for (const pad of footprint.pads) {
    parts.push(
      rect(
        pad.x,
        pad.y,
        pad.width,
        pad.height,
        pad.thermal ? "fp-pad fp-pad-thermal" : "fp-pad",
        pad.shape === "round" ? ` rx="${round((pad.width * scale) / 2, 2)}"` : "",
      ),
    );
    if (pad.hole) {
      parts.push(
        `<circle cx="${px(pad.x)}" cy="${py(pad.y)}" r="${round((pad.hole * scale) / 2, 2)}" class="fp-hole" />`,
      );
    }
    parts.push(
      `<text x="${px(pad.x)}" y="${py(pad.y) + 3}" class="fp-pad-label">${pad.number}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${parts.join(
    "",
  )}</svg>`;
}