/**
 * Recently opened files — shown on the Welcome view so a file can be reopened
 * after every editor tab was closed. Persisted in localStorage and pushed to
 * subscribers, like the other small stores.
 */

export interface RecentFile {
  path: string;
  name: string;
  /** Epoch ms of the last time it was opened (most recent first). */
  openedAt: number;
}

const STORAGE_KEY = "ehdl.recentFiles";

/** How many entries the Welcome view keeps. */
const MAX_RECENT = 10;

type Listener = (files: RecentFile[]) => void;

const listeners = new Set<Listener>();

function isRecentFile(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string" && typeof v.name === "string" && typeof v.openedAt === "number";
}

/** Read the recent-file list, newest first. */
export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isRecentFile).slice(0, MAX_RECENT);
    }
  } catch {
    // fall through to an empty list
  }
  return [];
}

function persist(files: RecentFile[]): RecentFile[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch {
    // storage unavailable (rare) — the list still works for this session
  }
  for (const listener of listeners) listener(files);
  return files;
}

/** Record that a file was opened (de-duplicated by path, newest first). */
export function rememberRecentFile(path: string, name: string): RecentFile[] {
  const entry: RecentFile = { path, name, openedAt: Date.now() };
  const rest = loadRecentFiles().filter((file) => file.path !== path);
  return persist([entry, ...rest].slice(0, MAX_RECENT));
}

export function clearRecentFiles(): RecentFile[] {
  return persist([]);
}

/** Subscribe to changes; called immediately with the current list. */
export function subscribeRecentFiles(listener: Listener): () => void {
  listeners.add(listener);
  listener(loadRecentFiles());
  return () => {
    listeners.delete(listener);
  };
}
