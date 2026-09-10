/**
 * Application settings shown in the Settings modal (General category).
 * Values persist to localStorage and are pushed live to subscribers —
 * every open Monaco editor subscribes so font size / word wrap apply
 * immediately, without reopening files.
 */

export interface AppSettings {
  /** Editor text size in pixels. */
  fontSize: number;
  /** Wrap long editor lines instead of scrolling horizontally. */
  wordWrap: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { fontSize: 13, wordWrap: false };

const STORAGE_KEY = "ehdl.settings";

type SettingsListener = (settings: AppSettings) => void;

const listeners = new Set<SettingsListener>();

/** Read persisted settings, merged over the defaults (tolerant of bad JSON). */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const fontSize =
        typeof parsed.fontSize === "number" && parsed.fontSize >= 8 && parsed.fontSize <= 30
          ? parsed.fontSize
          : DEFAULT_SETTINGS.fontSize;
      const wordWrap =
        typeof parsed.wordWrap === "boolean" ? parsed.wordWrap : DEFAULT_SETTINGS.wordWrap;
      return { fontSize, wordWrap };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

/** Persist a settings change and push it to every subscriber immediately. */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (rare) — still apply for this session
  }
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Subscribe to settings changes. The listener is invoked right away with the
 * current settings, so freshly mounted editors (Monaco) initialize correctly.
 * Returns an unsubscribe function.
 */
export function subscribeSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  listener(loadSettings());
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Library registry — the top folders the user registers as HDL libraries.
// Each library is a folder (path) plus the logical name used in VHDL code
// (e.g. `library my_lib;`). Configured in Settings → Library; the Library
// Manager sidebar lists them.
// ---------------------------------------------------------------------------

export interface LibraryEntry {
  /** Stable unique id (rows are added/removed by it). */
  id: string;
  /** Logical library name, e.g. "my_lib". */
  name: string;
  /** Absolute path of the library's top folder. */
  path: string;
}

const LIBRARIES_KEY = "ehdl.libraries";

type LibrariesListener = (libraries: LibraryEntry[]) => void;

const libraryListeners = new Set<LibrariesListener>();

function isLibraryEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string" && typeof v.path === "string";
}

/** Read the configured libraries (tolerant of missing/corrupt storage). */
export function loadLibraries(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isLibraryEntry);
    }
  } catch {
    // fall through to empty list
  }
  return [];
}

/** Persist the library list and push it to every subscriber immediately. */
export function saveLibraries(libraries: LibraryEntry[]): LibraryEntry[] {
  try {
    localStorage.setItem(LIBRARIES_KEY, JSON.stringify(libraries));
  } catch {
    // storage unavailable (rare) — still apply for this session
  }
  for (const listener of libraryListeners) listener(libraries);
  return libraries;
}

/**
 * Subscribe to library-list changes; invoked immediately with the current
 * list so freshly mounted views initialize correctly. Returns an unsubscribe.
 */
export function subscribeLibraries(listener: LibrariesListener): () => void {
  libraryListeners.add(listener);
  listener(loadLibraries());
  return () => {
    libraryListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Library contents — the items shown in the Library Manager's four sections
// (components, symbols, footprints, board snippets). Stored per library id;
// real folder scanning will later feed the same structure.
// ---------------------------------------------------------------------------

export const LIBRARY_SECTIONS = ["components", "symbols", "footprints", "board-snippets"] as const;

export type LibrarySectionId = (typeof LIBRARY_SECTIONS)[number];

export interface LibraryItem {
  id: string;
  name: string;
}

export type LibraryItemMap = Record<LibrarySectionId, LibraryItem[]>;

/** All libraries' contents, keyed by library id. */
export type LibraryItems = Record<string, LibraryItemMap>;

const LIBRARY_ITEMS_KEY = "ehdl.libraryItems";

/** A fresh, empty section map (every section present). */
export function emptyLibraryItemMap(): LibraryItemMap {
  return { components: [], symbols: [], footprints: [], "board-snippets": [] };
}

function isLibraryItem(value: unknown): value is LibraryItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string";
}

function normalizeItemMap(value: unknown): LibraryItemMap {
  const map = emptyLibraryItemMap();
  if (typeof value !== "object" || value === null) return map;
  const source = value as Record<string, unknown>;
  for (const section of LIBRARY_SECTIONS) {
    const list = source[section];
    if (Array.isArray(list)) map[section] = list.filter(isLibraryItem);
  }
  return map;
}

/** Read the stored library contents (tolerant of missing/corrupt storage). */
export function loadLibraryItems(): LibraryItems {
  try {
    const raw = localStorage.getItem(LIBRARY_ITEMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        const result: LibraryItems = {};
        for (const [libraryId, value] of Object.entries(parsed as Record<string, unknown>)) {
          result[libraryId] = normalizeItemMap(value);
        }
        return result;
      }
    }
  } catch {
    // fall through to empty map
  }
  return {};
}

/** Persist the library contents. */
export function saveLibraryItems(items: LibraryItems): LibraryItems {
  try {
    localStorage.setItem(LIBRARY_ITEMS_KEY, JSON.stringify(items));
  } catch {
    // storage unavailable (rare) — changes still apply for this session
  }
  return items;
}

/** The section map of one library (always complete, even when never edited). */
export function libraryItemMapFor(items: LibraryItems, libraryId: string): LibraryItemMap {
  return items[libraryId] ?? emptyLibraryItemMap();
}

// ---------------------------------------------------------------------------
// Services — accounts and API keys for external services (component
// suppliers, repositories, …) configured in Settings → Services.
//
// NOTE: stored in localStorage, i.e. plain text inside the app's webview data.
// Moving these to the OS keychain (Tauri stronghold / credential store) is a
// planned hardening step.
// ---------------------------------------------------------------------------

export interface ServiceAccount {
  id: string;
  /** Service name, e.g. "Octopart" or "GitHub". */
  service: string;
  /** Account / user name the key belongs to. */
  account: string;
  /** API key or access token. */
  apiKey: string;
}

const SERVICES_KEY = "ehdl.services";

function isServiceAccount(value: unknown): value is ServiceAccount {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.service === "string" &&
    typeof v.account === "string" &&
    typeof v.apiKey === "string"
  );
}

/** Read the configured service accounts (tolerant of missing/corrupt storage). */
export function loadServices(): ServiceAccount[] {
  try {
    const raw = localStorage.getItem(SERVICES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isServiceAccount);
    }
  } catch {
    // fall through to empty list
  }
  return [];
}

/** Persist the service accounts. */
export function saveServices(services: ServiceAccount[]): ServiceAccount[] {
  try {
    localStorage.setItem(SERVICES_KEY, JSON.stringify(services));
  } catch {
    // storage unavailable (rare) — changes still apply for this session
  }
  return services;
}
