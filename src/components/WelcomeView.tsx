import { useContext, useEffect, useState } from "react";
import { AppContext } from "../appContext";
import {
  inTauri,
  openFolder,
  openFile,
  listDir,
  createDir,
  writeFileText,
  joinPath,
} from "../fs";
import {
  loadRecentFiles,
  subscribeRecentFiles,
  clearRecentFiles,
} from "../recentFiles";
import type { RecentFile } from "../recentFiles";
import { PanelDialog } from "./PanelDialog";

/** Starter file created inside a new project. */
const STARTER_VHDL = `-- Top level of a new EHDL project.
library ieee;
use ieee.std_logic_1164.all;

entity top is
  port (
    CLK : in  std_logic;
    RST : in  std_logic
  );
end entity;

architecture rtl of top is
begin
end architecture;
`;

/** Parent folder of a path (the text before the last separator). */
function parentDirOf(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}

/**
 * Welcome / overview panel — shown in the editor area whenever no document is
 * open, like VS Code's welcome page: start a new project, open a folder, open a
 * file, or jump back into a recent one.
 */
export function WelcomeView() {
  const { openFolderProject, openProjectFolder, openFsPath, project } = useContext(AppContext);

  const [recents, setRecents] = useState<RecentFile[]>(() => loadRecentFiles());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Pending "new project" — the parent folder plus the name being typed. */
  const [newProject, setNewProject] = useState<{ parent: string; name: string } | null>(null);

  useEffect(() => subscribeRecentFiles(setRecents), []);

  const startNewProject = async () => {
    setError(null);
    const parent = await openFolder();
    if (!parent) return;
    setNewProject({ parent, name: "new_project" });
  };

  const createProject = async () => {
    if (!newProject) return;
    const name = newProject.name.trim();
    if (!name) return;
    const target = joinPath(newProject.parent, name);
    setBusy(true);
    setError(null);
    try {
      await createDir(joinPath(target, "src"));
      await writeFileText(joinPath(joinPath(target, "src"), "top.vhd"), STARTER_VHDL);
      setNewProject(null);
      openProjectFolder(target);
      void openFsPath(joinPath(joinPath(target, "src"), "top.vhd"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openExistingFolder = async () => {
    setError(null);
    if (!inTauri) {
      setError("Opening folders needs the desktop app.");
      return;
    }
    await openFolderProject();
  };

  const openSingleFile = async () => {
    setError(null);
    const path = await openFile();
    if (path) await openFsPath(path);
  };

  const openRecent = async (file: RecentFile) => {
    setError(null);
    try {
      const entries = await listDir(parentDirOf(file.path));
      if (!entries.some((entry) => entry.name === file.name)) {
        setError(`'${file.path}' is no longer there — open it again with “Open file…”.`);
        return;
      }
      await openFsPath(file.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-head">
          <span className="welcome-logo" aria-hidden="true">
            E
          </span>
          <div>
            <div className="welcome-title">EHDL — ECAD using HDL</div>
            <div className="welcome-sub">
              {project.kind === "folder"
                ? `Project: ${project.rootName}`
                : "No folder open — the sample project is showing in the explorer"}
            </div>
          </div>
        </div>

        {error && <p className="welcome-error">{error}</p>}

        <div className="welcome-columns">
          <section className="welcome-col">
            <div className="welcome-col-title">Start</div>
            <button className="welcome-action" disabled={!inTauri} onClick={() => void startNewProject()}>
              <span className="welcome-action-title">Create a new project</span>
              <span className="welcome-action-desc">
                Pick a folder and EHDL creates the project with a <code>src/top.vhd</code> starter.
              </span>
            </button>
            <button className="welcome-action" disabled={!inTauri} onClick={() => void openExistingFolder()}>
              <span className="welcome-action-title">Open an existing folder</span>
              <span className="welcome-action-desc">
                Show a folder of VHDL sources in the project explorer.
              </span>
            </button>
            <button className="welcome-action" disabled={!inTauri} onClick={() => void openSingleFile()}>
              <span className="welcome-action-title">Open a file…</span>
              <span className="welcome-action-desc">Open a single file from anywhere on disk.</span>
            </button>
          </section>

          <section className="welcome-col">
            <div className="welcome-col-title">
              Recent
              {recents.length > 0 && (
                <button
                  className="welcome-clear"
                  title="Clear the recent-files list"
                  onClick={() => setRecents(clearRecentFiles())}
                >
                  Clear
                </button>
              )}
            </div>
            {recents.length === 0 ? (
              <p className="welcome-empty">Files you open will be listed here.</p>
            ) : (
              <ul className="welcome-recents">
                {recents.map((file) => (
                  <li key={file.path}>
                    <button
                      className="welcome-recent"
                      title={file.path}
                      onClick={() => void openRecent(file)}
                    >
                      <span className="welcome-recent-name">{file.name}</span>
                      <span className="welcome-recent-path">{parentDirOf(file.path)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <p className="welcome-hint">
          Close this overview by opening a file — it comes back when no document is open.
        </p>
      </div>

      {newProject && (
        <PanelDialog
          title="New project"
          onClose={() => setNewProject(null)}
          actions={
            <>
              <button className="btn" onClick={() => setNewProject(null)}>
                Cancel
              </button>
              <button
                className="btn settings-primary-btn"
                disabled={busy || !newProject.name.trim()}
                onClick={() => void createProject()}
              >
                Create
              </button>
            </>
          }
        >
          <div className="panel-dialog-field">
            <label htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              className="settings-input"
              type="text"
              spellCheck={false}
              autoFocus
              value={newProject.name}
              onChange={(e) =>
                setNewProject((current) => (current ? { ...current, name: e.target.value } : current))
              }
            />
          </div>
          <p className="panel-dialog-hint">
            Created in <b>{newProject.parent}</b> as a new folder with <code>src/top.vhd</code>.
          </p>
        </PanelDialog>
      )}
    </div>
  );
}
