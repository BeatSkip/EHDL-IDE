/**
 * Documents registry. Every document is a file on disk: opening one registers
 * it here under an id of the form `fs:<absolute path>`. There is no built-in
 * sample document — the IDE starts with nothing open.
 */

/** A document handed to an editor component (id, tab title, initial text). */
export interface VhdlFile {
  id: string;
  name: string;
  content: string;
}

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

/** Disk path of a document, or null when it does not come from disk. */
export function docPath(id: string): string | null {
  return realDocs.get(id)?.path ?? null;
}

/** Display name of a document (tab title). */
export function docName(id: string): string {
  return realDocs.get(id)?.name ?? id;
}

export function docIdForPath(path: string): string {
  return `fs:${path}`;
}

/** File/folder name from an absolute path. */
export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}
