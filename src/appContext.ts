/**
 * Application-wide state shared through React context. Lives in its own module
 * (rather than inside App.tsx) so sidebar panels — e.g. the Create view — can
 * use it without importing App itself.
 */

import { createContext } from "react";
import { defaultFileId } from "./data";
import type { ActivityId } from "./components/ActivityBar";

export type ProjectState = { kind: "sample" } | { kind: "folder"; rootPath: string; rootName: string };

export interface AppState {
  activeFileId: string;
  project: ProjectState;
  activity: ActivityId;
  setActivity: (id: ActivityId) => void;
  openFolderProject: () => Promise<void>;
  /** Open a sample/document id that is already registered (content loaded). */
  openFile: (id: string) => void;
  /** Open a real file from disk (reads + registers it first). */
  openFsPath: (path: string) => Promise<void>;
  /** Persist a real document to disk. */
  saveFile: (id: string) => Promise<void>;
  inlineSchematicFileId: string | null;
  toggleInlineSchematic: (fileId: string) => void;
}

export const AppContext = createContext<AppState>({
  activeFileId: defaultFileId,
  project: { kind: "sample" },
  activity: "explorer",
  setActivity: () => {},
  openFolderProject: async () => {},
  openFile: () => {},
  openFsPath: async () => {},
  saveFile: async () => {},
  inlineSchematicFileId: null,
  toggleInlineSchematic: () => {},
});
