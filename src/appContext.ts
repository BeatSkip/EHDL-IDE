/**
 * Application-wide state shared through React context. Lives in its own module
 * (rather than inside App.tsx) so sidebar panels — e.g. the Create view — can
 * use it without importing App itself.
 */

import { createContext } from "react";
import type { ActivityId } from "./components/ActivityBar";

/**
 * What the explorer is showing. The IDE starts with nothing open (`none`) —
 * no sample project and no documents — until a folder is opened.
 */
export type ProjectState =
  | { kind: "none" }
  | { kind: "folder"; rootPath: string; rootName: string };

/** How an open document is shown inside its editor tab. */
export type EditorViewMode = "text" | "split" | "schematic";

export interface AppState {
  /** Id of the document in the active editor tab, or "" when none is open. */
  activeFileId: string;
  project: ProjectState;
  activity: ActivityId;
  setActivity: (id: ActivityId) => void;
  openFolderProject: () => Promise<void>;
  /** Make a folder the current project (Welcome view / "Open folder"). */
  openProjectFolder: (path: string) => void;
  /** Open a sample/document id that is already registered (content loaded). */
  openFile: (id: string) => void;
  /** Open a real file from disk (reads + registers it first). */
  openFsPath: (path: string) => Promise<void>;
  /** Persist a real document to disk. */
  saveFile: (id: string) => Promise<void>;
  /** Per-document view mode: VHDL text, schematic only, or both side by side. */
  viewModes: Record<string, EditorViewMode>;
  setViewMode: (fileId: string, mode: EditorViewMode) => void;
  /** Text → split → schematic → text. */
  cycleViewMode: (fileId: string) => void;
}

export const AppContext = createContext<AppState>({
  activeFileId: "",
  project: { kind: "none" },
  activity: "explorer",
  setActivity: () => {},
  openFolderProject: async () => {},
  openProjectFolder: () => {},
  openFile: () => {},
  openFsPath: async () => {},
  saveFile: async () => {},
  viewModes: {},
  setViewMode: () => {},
  cycleViewMode: () => {},
});
