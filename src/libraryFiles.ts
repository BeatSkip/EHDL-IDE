/**
 * Plain-text library file model.
 *
 * A library folder holds one folder per category (components, symbols,
 * footprints, board-snippets). Inside a category folder there are **part
 * files** (plain text) and optional **sub-category folders**. The real part
 * format is still to be decided, so everything here is deliberately simple
 * text — see `buildPartContent`.
 */

import type { FsEntry } from "./fs";
import type { LibrarySectionId } from "./settings";

/** Extension used for part files (placeholder — the format is still open). */
export const ITEM_EXT = ".txt";

/** Human labels for the four category folders. */
export const SECTION_LABELS: Record<LibrarySectionId, string> = {
  components: "Components",
  symbols: "Symbols",
  footprints: "Footprints",
  "board-snippets": "Board Snippets",
};

/** Base name of a freshly created part / sub-category (renamed right away). */
export const DEFAULT_ITEM_NAMES: Record<LibrarySectionId, string> = {
  components: "new_component",
  symbols: "new_symbol",
  footprints: "new_footprint",
  "board-snippets": "new_board_snippet",
};

/** Default sub-category folder name. */
export const DEFAULT_SUBCATEGORY_NAME = "new_category";

/** What a part file in each category describes. */
export type PartKind = "component" | "symbol" | "footprint" | "board-snippet";

export const PART_KIND: Record<LibrarySectionId, PartKind> = {
  components: "component",
  symbols: "symbol",
  footprints: "footprint",
  "board-snippets": "board-snippet",
};

/** Split a file name into its base and extension ("res.txt" → "res", ".txt"). */
export function splitName(name: string): { base: string; ext: string } {
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
    "# Provisional plain-text format — the real part format is still to be decided.",
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
