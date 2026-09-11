import { invoke, isTauri } from "@tauri-apps/api/core";

export interface FsEntry {
  path: string;
  name: string;
  isDir: boolean;
}

/** True when running inside the Tauri shell (has access to the file system). */
export const inTauri = typeof window !== "undefined" && isTauri();

/** Native "pick a folder" dialog (Tauri only). */
export async function openFolder(): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string | null>("open_folder_dialog");
}

/** Native "pick a file" dialog (Tauri only) — used by "Import a part". */
export async function openFile(): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string | null>("open_file_dialog");
}

/** Lists a directory: directories first, then files (both sorted by name). */
export async function listDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("read_dir", { path });
}

/** Reads a UTF-8 text file. */
export async function readFileText(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

/** Writes text to a file. */
export async function writeFileText(path: string, content: string): Promise<void> {
  await invoke("write_file", { path, content });
}

/** Creates a directory (and any missing parents). Succeeds if it exists. */
export async function createDir(path: string): Promise<void> {
  await invoke("create_dir", { path });
}

/** Renames / moves a file or directory. */
export async function renameEntry(from: string, to: string): Promise<void> {
  await invoke("rename_entry", { from, to });
}

/** Deletes a file, or a directory recursively. */
export async function deleteEntry(path: string): Promise<void> {
  await invoke("delete_entry", { path });
}

/** Recursively copies a file or directory (with its contents). */
export async function copyEntry(from: string, to: string): Promise<void> {
  await invoke("copy_entry", { from, to });
}

/**
 * Join path parts using the separator already used by `base` (the file system
 * returns native `\` on Windows and `/` elsewhere).
 */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  let path = base;
  for (const part of parts) {
    path = path.endsWith(sep) ? path + part : path + sep + part;
  }
  return path;
}

/** Reveals a folder in the OS file manager (Explorer on Windows). */
export async function openInFileManager(path: string): Promise<void> {
  if (!inTauri) return;
  await invoke("open_in_file_manager", { path });
}

/** Opens a URL (or file) with the OS default handler — the browser for links. */
export async function openExternal(target: string): Promise<void> {
  if (!inTauri) return;
  await invoke("open_external", { target });
}
