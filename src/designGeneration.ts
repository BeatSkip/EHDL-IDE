/**
 * On-demand design generation.
 *
 * The VHDL → tscircuit pipeline lives in Node (`scripts/generate-schematic.mjs`)
 * because tscircuit cannot run inside the webview. This module drives it for the
 * *open project*: it finds the project's component library and design files,
 * runs the generator through the Rust command, and reads the artifacts back.
 *
 * Outputs land in `<project>/generated/` (schematic.svg, netlist.json, bom.json,
 * generation.json) so the last run is on disk and can be committed or ignored.
 */

import { generateSchematic, joinPath, listDir, readFileText, inTauri } from "./fs";
import type { BomRow, Netlist } from "./elaborate";

export interface GeneratedDesign {
  /** Design file the schematic came from. */
  design: string;
  /** Folder holding the generated artifacts. */
  outDir: string;
  svg: string;
  netlist: Netlist;
  bom: BomRow[];
  logs: string[];
  generatedAt: string;
  library: string;
}

const VHDL = /\.vhd$/i;
const OUT_DIR_NAME = "generated";

/** Top-level design candidates: `…/src/*.vhd` plus any `.vhd` in the root. */
export async function findDesignFiles(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for (const entry of await listDir(projectRoot)) {
      if (entry.isDir && entry.name.toLowerCase() === "src") {
        for (const child of await listDir(entry.path)) {
          if (!child.isDir && VHDL.test(child.name)) found.push(child.path);
        }
      } else if (!entry.isDir && VHDL.test(entry.name)) {
        found.push(entry.path);
      }
    }
  } catch {
    // unreadable project — no candidates
  }
  return found;
}

/** The project's component library: `<root>/components` or one level deeper. */
export async function findComponentsDir(projectRoot: string): Promise<string | null> {
  try {
    const entries = await listDir(projectRoot);
    const direct = entries.find((entry) => entry.isDir && entry.name.toLowerCase() === "components");
    if (direct) return direct.path;
    for (const entry of entries) {
      if (!entry.isDir) continue;
      const children = await listDir(entry.path);
      const nested = children.find((child) => child.isDir && child.name.toLowerCase() === "components");
      if (nested) return nested.path;
    }
  } catch {
    // unreadable project
  }
  return null;
}

export function outDirFor(projectRoot: string): string {
  return joinPath(projectRoot, OUT_DIR_NAME);
}

export interface GenerationOutcome {
  ok: boolean;
  output: string;
  outDir: string;
}

/** Run the backend generator for one design file. */
export async function generateDesign(
  projectRoot: string,
  topFile: string,
): Promise<GenerationOutcome> {
  const outDir = outDirFor(projectRoot);
  if (!inTauri) {
    return { ok: false, output: "Generating needs the desktop app (npm run tauri dev).", outDir };
  }
  const componentsDir = await findComponentsDir(projectRoot);
  if (!componentsDir) {
    return {
      ok: false,
      output: `No components folder found in ${projectRoot} — the design needs a library to instantiate.`,
      outDir,
    };
  }
  const result = await generateSchematic(componentsDir, topFile, outDir);
  return { ...result, outDir };
}

/** Read the artifacts of the last generation, or null when there are none. */
export async function loadGeneratedDesign(outDir: string): Promise<GeneratedDesign | null> {
  try {
    const [svg, netlist, bom, info] = await Promise.all([
      readFileText(joinPath(outDir, "schematic.svg")),
      readFileText(joinPath(outDir, "netlist.json")),
      readFileText(joinPath(outDir, "bom.json")),
      readFileText(joinPath(outDir, "generation.json")),
    ]);
    const parsedInfo = JSON.parse(info) as { design?: string; library?: string; generatedAt?: string; logs?: string[] };
    return {
      design: parsedInfo.design ?? "design.vhd",
      outDir,
      svg,
      netlist: JSON.parse(netlist) as Netlist,
      bom: JSON.parse(bom) as BomRow[],
      logs: parsedInfo.logs ?? [],
      generatedAt: parsedInfo.generatedAt ?? "",
      library: parsedInfo.library ?? "",
    };
  } catch {
    return null; // nothing generated yet
  }
}