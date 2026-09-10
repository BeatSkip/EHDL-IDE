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

/** Reveals a folder in the OS file manager (Explorer on Windows). */
export async function openInFileManager(path: string): Promise<void> {
  if (!inTauri) return;
  await invoke("open_in_file_manager", { path });
}
