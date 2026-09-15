/**
 * Component database — Phase 2 of `docs/vhdl-implementation.md`.
 *
 * Walks a library's components folder (including sub-categories), parses every
 * component file and builds the database keyed by entity name. Duplicate entity
 * names across files are reported, as the spec requires.
 *
 * The elaboration / netlist / BOM stages (Phases 3–5) build on this.
 */

import { listDir } from "./fs";
import { isPartFile, fileNameOf } from "./libraryFiles";
import { parseComponentVhdl } from "./vhdlPart";
import type { ComponentModel } from "./vhdlPart";

export interface LibraryIssue {
  severity: "error" | "warning";
  /** File the issue belongs to (name only, for compactness in the UI). */
  file: string;
  message: string;
}

export interface LibraryComponent {
  /** Entity name as written in the file. */
  entity: string;
  model: ComponentModel;
  /** Absolute path of the file it came from. */
  path: string;
}

export interface ComponentDatabase {
  components: LibraryComponent[];
  issues: LibraryIssue[];
  /** Number of component files that were parsed. */
  fileCount: number;
}

/** Depth limit so a deep or symlinked tree can't run away. */
const MAX_DEPTH = 8;

/** Every `*.vhd` file under `dir`, recursively. */
async function collectComponentFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await listDir(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) files.push(...(await collectComponentFiles(entry.path, depth + 1)));
    else if (isPartFile(entry.name)) files.push(entry.path);
  }
  return files;
}

/**
 * Parse every component file in a library's components folder.
 * Never throws: unreadable folders/files become issues.
 */
export async function loadComponentDatabase(
  componentsDir: string,
  readText: (path: string) => Promise<string>,
): Promise<ComponentDatabase> {
  const paths = await collectComponentFiles(componentsDir);
  const byEntity = new Map<string, LibraryComponent>();
  const issues: LibraryIssue[] = [];

  for (const path of paths) {
    const file = fileNameOf(path);
    let text: string;
    try {
      text = await readText(path);
    } catch (err) {
      issues.push({
        severity: "error",
        file,
        message: `Could not read the file: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const { model, issues: fileIssues } = parseComponentVhdl(text, file.replace(/\..*$/, ""));
    for (const issue of fileIssues) issues.push({ severity: issue.severity, file, message: issue.message });

    const key = model.name.toLowerCase();
    const existing = byEntity.get(key);
    if (existing) {
      issues.push({
        severity: "error",
        file,
        message: `Duplicate entity '${model.name}' in files ${fileNameOf(existing.path)} and ${file}`,
      });
      continue;
    }
    byEntity.set(key, { entity: model.name, model, path });
  }

  return { components: [...byEntity.values()], issues, fileCount: paths.length };
}
