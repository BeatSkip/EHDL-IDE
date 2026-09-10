import { findFile } from "./data";

/**
 * Documents registry. Sample files (from `data.ts`) are known statically; real
 * files opened from the file explorer are registered here under an id of the
 * form `fs:<absolute path>`.
 */

export interface DocInfo {
  name: string;
  path: string | null;
}

const realDocs = new Map<string, DocInfo>();

export function isRealDoc(id: string): boolean {
  return realDocs.has(id);
}

export function registerRealDoc(id: string, info: DocInfo): void {
  realDocs.set(id, info);
}

/** Disk path of a real document, or null for sample documents. */
export function docPath(id: string): string | null {
  return realDocs.get(id)?.path ?? null;
}

/** Display name of a document (tab title). */
export function docName(id: string): string {
  const info = realDocs.get(id);
  if (info) return info.name;
  return findFile(id).name;
}

/** Initial text used when mounting an editor whose store has no entry yet. */
export function initialContent(id: string): string {
  const info = realDocs.get(id);
  if (info && info.path) return ""; // content is set before the editor mounts
  return findFile(id).content;
}

export function docIdForPath(path: string): string {
  return `fs:${path}`;
}

/** File/folder name from an absolute path. */
export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}
