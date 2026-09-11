/**
 * Library manifest — `<library_name>.ehdlib.json`, stored in the library's top
 * folder next to the category folders.
 *
 * It holds the details that describe the library and its folders rather than a
 * single part file: library description/notes, and the icon / description /
 * notes of each sub-category. Plain JSON, so it can be hand-edited and diffed;
 * every key is optional and a missing file simply means "no details yet".
 */

import { readFileText, writeFileText, joinPath } from "./fs";
import { fileNameOf } from "./libraryFiles";

/** Suffix of the manifest file: `<library_name>` + this. */
export const LIBRARY_META_EXT = ".ehdlib.json";

export const LIBRARY_META_VERSION = 1;

/** Details of one sub-category folder (keyed by its path inside the library). */
export interface SubCategoryMeta {
  /** Icon id from LIBRARY_ICONS (e.g. "chip"). */
  icon?: string;
  description?: string;
  notes?: string;
}

/** Details of one part file (keyed by its path inside the library). */
export interface PartMeta {
  description?: string;
  notes?: string;
}

export interface LibraryMeta {
  version: number;
  /** Logical library name — the same one used in Settings → Library. */
  name?: string;
  description?: string;
  notes?: string;
  /** Sub-category details, keyed by path relative to the library root. */
  subCategories: Record<string, SubCategoryMeta>;
  /** Part details, keyed by path relative to the library root. */
  parts: Record<string, PartMeta>;
}

/** A manifest with no details set. */
export function emptyLibraryMeta(name?: string): LibraryMeta {
  return { version: LIBRARY_META_VERSION, name, subCategories: {}, parts: {} };
}

/** File name of a library's manifest: `<library_name>.ehdlib.json`. */
export function libraryMetaFileName(libraryName: string, folderName = "library"): string {
  const safe = (libraryName || folderName).replace(/[\\/:*?"<>|]/g, "_").trim();
  return `${safe || "library"}${LIBRARY_META_EXT}`;
}

/** Full path of a library's manifest inside its top folder. */
export function libraryMetaPath(libraryPath: string, libraryName: string): string {
  return joinPath(libraryPath, libraryMetaFileName(libraryName, fileNameOf(libraryPath)));
}

/** Manifest key for an entry: its path inside the library, with "/" separators. */
export function relativeKey(libraryPath: string, entryPath: string): string {
  const sep = libraryPath.includes("\\") ? "\\" : "/";
  const prefix = libraryPath.endsWith(sep) ? libraryPath : libraryPath + sep;
  const relative = entryPath.startsWith(prefix) ? entryPath.slice(prefix.length) : entryPath;
  return relative.split(/[\\/]/).filter(Boolean).join("/");
}

function asRecord(value: unknown): Record<string, never> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, never>;
}

/** Read a library's manifest (a missing or broken file yields empty details). */
export async function loadLibraryMeta(
  libraryPath: string,
  libraryName: string,
): Promise<LibraryMeta> {
  try {
    const raw = await readFileText(libraryMetaPath(libraryPath, libraryName));
    const parsed = JSON.parse(raw) as Partial<LibraryMeta>;
    return {
      version:
        typeof parsed.version === "number" && Number.isFinite(parsed.version)
          ? parsed.version
          : LIBRARY_META_VERSION,
      name: typeof parsed.name === "string" ? parsed.name : libraryName,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
      subCategories: asRecord(parsed.subCategories) ?? {},
      parts: asRecord(parsed.parts) ?? {},
    };
  } catch {
    return emptyLibraryMeta(libraryName);
  }
}

/** Write a library's manifest as pretty JSON (creating the file if needed). */
export async function saveLibraryMeta(
  libraryPath: string,
  libraryName: string,
  meta: LibraryMeta,
): Promise<void> {
  const payload: LibraryMeta = {
    version: LIBRARY_META_VERSION,
    name: meta.name ?? libraryName,
    subCategories: meta.subCategories,
    parts: meta.parts,
  };
  if (meta.description) payload.description = meta.description;
  if (meta.notes) payload.notes = meta.notes;
  await writeFileText(libraryMetaPath(libraryPath, libraryName), `${JSON.stringify(payload, null, 2)}\n`);
}
