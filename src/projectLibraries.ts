/**
 * Library folders that live inside the current project.
 *
 * The Library Manager dropdown lists the libraries configured in
 * Settings → Library; on top of that, any library folder found inside the
 * opened project is offered as "current project - <project name>" so a project
 * that carries its own parts can be used without registering it first.
 *
 * A folder counts as a library when it holds category folders (components,
 * symbols, footprints, board-snippets, templates) or a `.ehdlib.json` manifest.
 * The project root itself and its immediate subfolders are checked.
 */

import { listDir } from "./fs";
import type { FsEntry } from "./fs";
import { LIBRARY_SECTIONS } from "./settings";

export interface ProjectLibrary {
  /** Virtual id (`project:<path>`) — kept apart from configured libraries. */
  id: string;
  /** Folder name, so the manifest `<name>.ehdlib.json` resolves. */
  name: string;
  path: string;
  /** Text shown in the dropdown. */
  label: string;
}

const CATEGORIES = new Set<string>(LIBRARY_SECTIONS);
const MANIFEST = /\.ehdlib\.json$/i;

/** True when a folder's contents look like an EHDL library. */
export function isLibraryFolder(entries: FsEntry[]): boolean {
  return entries.some(
    (entry) => (entry.isDir && CATEGORIES.has(entry.name.toLowerCase())) || MANIFEST.test(entry.name),
  );
}

/** Last path segment. */
function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/** Library folders inside a project: the root itself and its subfolders. */
export async function findProjectLibraries(
  projectRoot: string,
  projectName: string,
): Promise<ProjectLibrary[]> {
  const found: ProjectLibrary[] = [];
  const add = (path: string, label: string) =>
    found.push({ id: `project:${path}`, name: baseName(path), path, label });

  try {
    const rootEntries = await listDir(projectRoot);
    if (isLibraryFolder(rootEntries)) add(projectRoot, `current project - ${projectName}`);

    for (const entry of rootEntries) {
      if (!entry.isDir) continue;
      const children = await listDir(entry.path);
      if (isLibraryFolder(children)) add(entry.path, `current project - ${projectName}/${entry.name}`);
    }
  } catch {
    return [];
  }

  return found;
}

/**
 * A library the project explorer asked the Library Manager to show. The
 * explorer only switches the activity bar; the Library Manager is mounted a
 * moment later and picks the request up once its scan has finished.
 */
let pendingLibraryPath: string | null = null;

export function requestLibrary(path: string): void {
  pendingLibraryPath = path;
}

export function takePendingLibrary(): string | null {
  const path = pendingLibraryPath;
  pendingLibraryPath = null;
  return path;
}