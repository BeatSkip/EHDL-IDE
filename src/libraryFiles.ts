/**
 * Plain-text library file model.
 *
 * A library folder holds one folder per category (components, symbols,
 * footprints, board-snippets, templates). Inside a category folder there are
 * **part files** (plain text) and optional **sub-category folders**. The real
 * part format is still to be decided, so everything here is deliberately
 * simple text — see `buildPartContent`.
 */

import type { FsEntry } from "./fs";
import type { LibrarySectionId } from "./settings";
import { FOOTPRINT_EXT } from "./ipcFootprint";

/**
 * Extension used for the part files of each category.
 *
 * Components are `.prt.ehd` (Part editor), symbols `.sym.ehd`, footprints
 * `.fpt.ehd` (IPC footprint wizard); the remaining categories keep the plain
 * `.txt` placeholder until their formats are decided.
 */
export const SECTION_EXT: Record<LibrarySectionId, string> = {
  components: ".prt.ehd",
  symbols: ".sym.ehd",
  footprints: FOOTPRINT_EXT,
  "board-snippets": ".txt",
  templates: ".txt",
};

/** Extension of a component part file. */
export const PART_EXT = ".prt.ehd";

/** True for component part files (`xxx.prt.ehd`) — opened in the Part editor. */
export function isPartFile(path: string): boolean {
  return path.toLowerCase().endsWith(PART_EXT);
}

/**
 * Extensions the Library Manager hides: the category folder already says what
 * the file is, so `mosfet_n.prt.ehd` is listed as `mosfet_n`. Anything with an
 * unknown extension (an imported `.kicad_mod`, say) keeps it.
 */
const HIDDEN_EXTS = [PART_EXT, ".sym.ehd", FOOTPRINT_EXT, ".txt"];

/** The hidden extension of a file name, or "" when it has none. */
export function hiddenExt(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of HIDDEN_EXTS) {
    if (lower.endsWith(ext) && name.length > ext.length) return name.slice(name.length - ext.length);
  }
  return "";
}

/** File name as shown in the Library Manager. */
export function displayName(name: string): string {
  const ext = hiddenExt(name);
  return ext ? name.slice(0, name.length - ext.length) : name;
}

/** Human labels for the category folders, in the order they are shown. */
export const SECTION_LABELS: Record<LibrarySectionId, string> = {
  components: "Components",
  symbols: "Symbols",
  footprints: "Footprints",
  "board-snippets": "Board Snippets",
  templates: "Templates",
};

/** Base name of a freshly created part / sub-category (renamed right away). */
export const DEFAULT_ITEM_NAMES: Record<LibrarySectionId, string> = {
  components: "new_component",
  symbols: "new_symbol",
  footprints: "new_footprint",
  "board-snippets": "new_board_snippet",
  templates: "new_template",
};

/** Default sub-category folder name. */
export const DEFAULT_SUBCATEGORY_NAME = "new_category";

/** What a part file in each category describes. */
export type PartKind = "component" | "symbol" | "footprint" | "board-snippet" | "template";

export const PART_KIND: Record<LibrarySectionId, PartKind> = {
  components: "component",
  symbols: "symbol",
  footprints: "footprint",
  "board-snippets": "board-snippet",
  templates: "template",
};

/** Extensions made of more than one dot-separated piece (checked first). */
const COMPOUND_EXTS = [PART_EXT, ".sym.ehd"];

/** Split a file name into base and extension ("res.prt.ehd" → "res", ".prt.ehd"). */
export function splitName(name: string): { base: string; ext: string } {
  const lower = name.toLowerCase();
  for (const ext of COMPOUND_EXTS) {
    if (lower.endsWith(ext)) {
      const cut = name.length - ext.length;
      return { base: name.slice(0, cut), ext: name.slice(cut) };
    }
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/** Last path segment ("C:\\lib\\components\\a.txt" → "a.txt"). */
export function fileNameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/**
 * A name `base + ext` that is free in `existing` (appends _copy, _copy2…).
 * Pass an empty `ext` to get a free folder name.
 */
export function uniqueFileName(base: string, ext: string, existing: FsEntry[]): string {
  const taken = new Set(existing.map((entry) => entry.name.toLowerCase()));
  if (!taken.has(`${base}${ext}`.toLowerCase())) return `${base}${ext}`;
  let index = 2;
  let candidate = `${base}_copy${ext}`;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}_copy${index}${ext}`;
    index += 1;
  }
  return candidate;
}

/** Directions a pin can have. */
export const PIN_DIRECTIONS = ["in", "out", "inout", "passive", "power"] as const;
export type PinDirection = (typeof PIN_DIRECTIONS)[number];

export interface PartPin {
  /** Pin number / designator, e.g. "1" or "A1". */
  number: string;
  /** Pin name, e.g. "VCC". */
  name: string;
  direction: PinDirection;
}

/**
 * Render a part file. PROVISIONAL FORMAT: plain text, human readable, easy to
 * replace once the real EHDL part format is defined.
 */
export function buildPartContent(opts: {
  kind: PartKind;
  name: string;
  description?: string;
  library?: string;
  pins?: PartPin[];
}): string {
  const { kind, name, description = "", library = "", pins = [] } = opts;
  const lines: string[] = [
    `# EHDL ${kind}: ${name}`,
    "# Provisional plain-text format — the definition language/backend is not chosen yet.",
    "",
    `kind        = ${kind}`,
    `name        = ${name}`,
  ];
  if (library) lines.push(`library     = ${library}`);
  if (description) lines.push(`description = ${description}`);
  if (pins.length > 0) {
    lines.push("", `pins:            # number | name | direction`);
    for (const pin of pins) {
      lines.push(`  ${pin.number || "-"} | ${pin.name || "-"} | ${pin.direction}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
