/**
 * Board files and board snippets — provisional plain-text format.
 *
 * A board describes a PCB: its layer stack and (later) its placement/routing,
 * which will be expressed through tscircuit. A **board snippet** is simply a
 * board file that lives in a library's `board-snippets` folder, so any board
 * file can act as a snippet as long as its layer stack fits the target board:
 * a 2-layer snippet fits on a 2-, 4- or 6-layer board, a 4-layer snippet does
 * not fit on a 2-layer board.
 */

import type { ComponentIssue } from "./vhdlPart";

/** Extension of board files (and therefore of board snippets). */
export const BOARD_EXT = ".brd.ehd";

export type BoardKind = "board" | "board-snippet";

export interface BoardDoc {
  kind: BoardKind;
  /** Board / snippet name (also the logical name used in the design). */
  name: string;
  /** Copper layer count: 2, 4, 6, 8, … */
  layers: number;
  /** Optional layer names, front to back. */
  stack: string[];
  description: string;
  /** Unrecognised lines, preserved on save. */
  extra: string[];
}

/** Layer counts offered when creating a board. */
export const LAYER_CHOICES = [2, 4, 6, 8];

/** Default layer names for a copper count. */
export function defaultStack(layers: number): string[] {
  if (layers <= 2) return ["F.Cu", "B.Cu"];
  const inner: string[] = [];
  for (let index = 1; index <= layers - 2; index += 1) inner.push(`In${index}.Cu`);
  return ["F.Cu", ...inner, "B.Cu"];
}

export function emptyBoard(name: string, layers: number, kind: BoardKind = "board"): BoardDoc {
  return { kind, name, layers, stack: defaultStack(layers), description: "", extra: [] };
}

/** Turn a board file into a snippet (or back) without touching the layout. */
export function asSnippet(doc: BoardDoc, snippet = true): BoardDoc {
  return { ...doc, kind: snippet ? "board-snippet" : "board" };
}

/**
 * Can a snippet be used on a board? Its stack must not need more copper layers
 * than the board provides (that direction only — a 2-layer snippet fits a
 * 4-layer board, but a 4-layer snippet never fits a 2-layer board).
 */
export function canHostBoard(boardLayers: number, snippetLayers: number): boolean {
  return snippetLayers <= boardLayers;
}

/** Why a snippet does or does not fit — shown in the UI. */
export function compatibilityMessage(boardLayers: number, snippetLayers: number): string {
  if (canHostBoard(boardLayers, snippetLayers)) {
    return `${snippetLayers}-layer snippet fits a ${boardLayers}-layer board`;
  }
  return `${snippetLayers}-layer snippet does not fit a ${boardLayers}-layer board (needs ${snippetLayers}+ layers)`;
}

/** Read a board file (tolerant: unknown lines are kept). */
export function parseBoardFile(
  text: string,
  fallbackName = "board",
  kind: BoardKind = "board",
): { doc: BoardDoc; issues: ComponentIssue[] } {
  const issues: ComponentIssue[] = [];
  const doc = emptyBoard(fallbackName, 2, kind);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      doc.extra.push(raw);
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"(.*)"$/, "$1");
    if (key === "kind") doc.kind = value === "board-snippet" ? "board-snippet" : "board";
    else if (key === "name") doc.name = value;
    else if (key === "layers") {
      const layers = Number(value);
      if (Number.isFinite(layers) && layers >= 2) doc.layers = Math.floor(layers);
      else issues.push({ severity: "error", message: `Invalid layer count '${value}' (expected 2 or more).` });
    } else if (key === "stack") {
      doc.stack = value
        .split(",")
        .map((layer) => layer.trim())
        .filter(Boolean);
    } else if (key === "description") doc.description = value;
    else doc.extra.push(raw);
  }

  if (doc.layers % 2 !== 0) {
    issues.push({ severity: "warning", message: `${doc.layers} copper layers is unusual (boards are usually even).` });
  }
  if (doc.stack.length !== 0 && doc.stack.length !== doc.layers) {
    issues.push({
      severity: "warning",
      message: `The layer stack names ${doc.stack.length} layer(s) but 'layers' is ${doc.layers}.`,
    });
  }
  return { doc, issues };
}

/** Render a board file. */
export function serializeBoardFile(doc: BoardDoc): string {
  const lines = [
    "# EHDL board — provisional plain-text format.",
    "# A board file in a library's board-snippets folder acts as a board snippet.",
    "",
    `kind        = ${doc.kind}`,
    `name        = ${doc.name}`,
    `layers      = ${doc.layers}`,
    `stack       = ${(doc.stack.length ? doc.stack : defaultStack(doc.layers)).join(", ")}`,
  ];
  if (doc.description) lines.push(`description = ${doc.description}`);
  if (doc.extra.length > 0) lines.push("", ...doc.extra);
  lines.push("");
  return lines.join("\n");
}

/** Layer count of a board file's text, or null when it can't be read. */
export function boardLayersOf(text: string): number | null {
  const match = /^\s*layers\s*=\s*(\d+)/im.exec(text);
  if (!match) return null;
  const layers = Number(match[1]);
  return Number.isFinite(layers) ? layers : null;
}

/** True for a file name that is a board file / board snippet. */
export function isBoardFile(name: string): boolean {
  return name.toLowerCase().endsWith(BOARD_EXT);
}