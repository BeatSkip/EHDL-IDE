import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  listDir,
  createDir,
  writeFileText,
  copyEntry,
  deleteEntry,
  readFileText,
  joinPath,
  inTauri,
} from "../fs";
import type { FsEntry } from "../fs";
import { usePopupPosition } from "../popupPosition";
import type { PopupAnchor } from "../popupPosition";
import { SECTION_EXT, uniqueFileName } from "../libraryFiles";
import { loadLibraries, LIBRARY_SECTIONS } from "../settings";
import { emptyLibraryMeta, libraryMetaPath, saveLibraryMeta } from "../libraryMeta";
import {
  BOARD_EXT,
  LAYER_CHOICES,
  boardLayersOf,
  emptyBoard,
  isBoardFile,
  serializeBoardFile,
} from "../boardFile";
import { emptyComponent, serializeComponent } from "../vhdlPart";
import { PanelDialog } from "./PanelDialog";
import { FootprintWizard } from "./FootprintWizard";
import { findProjectLibraries, requestLibrary } from "../projectLibraries";
import { AppContext } from "../appContext";

/** What the "Create" submenu can add. */
type CreateKind =
  | "schematic"
  | "library"
  | "board"
  | "component"
  | "symbol"
  | "footprint"
  | "board-snippet";

/** Dialog titles per kind. */
const CREATE_TITLES: Record<CreateKind, string> = {
  schematic: "New schematic file",
  library: "New library folder",
  board: "New board file",
  component: "New component",
  symbol: "New symbol",
  footprint: "New footprint part",
  "board-snippet": "New board snippet",
};

const CREATE_ITEMS: { kind: CreateKind; label: string; hint: string }[] = [
  { kind: "schematic", label: "Schematic file", hint: "VHDL design — entity + architecture" },
  {
    kind: "library",
    label: "Library folder",
    hint: `components, symbols, footprints, board snippets, templates`,
  },
  { kind: "board", label: "Board file", hint: "PCB with its layer stack" },
];

const LIBRARY_CREATE_ITEMS: { kind: CreateKind; label: string; hint: string }[] = [
  {
    kind: "component",
    label: "Component",
    hint: `a VHDL part (${SECTION_EXT.components}) — package, entity, architecture`,
  },
  { kind: "symbol", label: "Symbol", hint: `a ${SECTION_EXT.symbols} drawing of a part` },
  { kind: "footprint", label: "Footprint part", hint: "a land pattern in the footprints folder" },
  {
    kind: "board-snippet",
    label: "Board snippet",
    hint: "a board file that fits any board with enough layers",
  },
];

/** Starter text for a new schematic (design) file. */
const schematicTemplate = (name: string) => `-- ${name}.vhd — top-level design.
library ieee;
use ieee.std_logic_1164.all;

entity ${name} is
  port (
    CLK : in  std_logic;
    RST : in  std_logic
  );
end entity;

architecture rtl of ${name} is
begin
  -- U1 : entity work.MY_PART
  --   generic map (PACKAGE_VARIANT => "SOIC8")
  --   port map ( ... );
end architecture;
`;

const symbolTemplate = (name: string) => `-- ${name}${SECTION_EXT.symbols} — symbol (format still to be decided).
kind = symbol
name = ${name}
`;

const footprintTemplate = (name: string) => `-- ${name}${SECTION_EXT.footprints} — footprint (format still to be decided).
kind = footprint
name = ${name}
`;

/** Library manifests are edited through the context menu, not listed. */
const MANIFEST = /\.ehdlib\.json$/i;

/** Cached "is this folder empty?" answers (cleared whenever the tree changes). */
const emptiness = new Map<string, boolean>();

/** Depth up to which nested folders are inspected for content. */
const EMPTY_DEPTH = 3;

/**
 * True when a folder holds nothing worth showing. A `.ehdlib.json` manifest
 * counts as content, so a library folder stays visible (and can be right-clicked
 * to edit its manifest) even before parts are added to it.
 */
async function isEmptyFolder(path: string, depth = 0): Promise<boolean> {
  const cached = emptiness.get(path);
  if (cached !== undefined) return cached;

  let empty = true;
  try {
    const entries = await listDir(path);
    for (const child of entries) {
      if (!child.isDir) {
        empty = false;
        break;
      }
      // Too deep to judge: keep the folder rather than hide real content.
      if (depth >= EMPTY_DEPTH) {
        empty = false;
        break;
      }
      if (!(await isEmptyFolder(child.path, depth + 1))) {
        empty = false;
        break;
      }
    }
  } catch {
    empty = false; // unreadable: better to show it than to hide it
  }

  emptiness.set(path, empty);
  return empty;
}

/** A folder's entries without the manifest and without empty subfolders. */
async function visibleChildren(path: string): Promise<FsEntry[]> {
  const entries = await listDir(path);
  const visible: FsEntry[] = [];
  for (const child of entries) {
    if (!child.isDir && MANIFEST.test(child.name)) continue;
    if (child.isDir && (await isEmptyFolder(child.path))) continue;
    visible.push(child);
  }
  return visible;
}

/** Shared menu plumbing for the tree rows. */
interface ExplorerApi {
  version: number;
  selected: string | null;
  /** Paths of the library folders inside this project (bottom of the tree). */
  libraries: Set<string>;
  select: (entry: FsEntry) => void;
  openFile: (path: string) => void;
  /** Switch to the Library Manager with this library selected. */
  openLibrary: (path: string) => void;
  contextMenu: (e: ReactMouseEvent, entry: FsEntry) => void;
}

/** Books icon used for the library folders in the tree. */
function BooksIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M2.5 3.5h2.6v9H2.5z" />
      <path d="M6.1 3.5h2.6v9H6.1z" />
      <path d="M10.2 4.3l2.5-.7 1.4 8.6-2.5.5z" />
    </svg>
  );
}

/** Parent folder of a path. */
function parentOf(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}

function FileRow({ entry, depth, api }: { entry: FsEntry; depth: number; api: ExplorerApi }) {
  return (
    <li className="tree-node">
      <div
        className={`tree-row tree-file-row ${api.selected === entry.path ? "selected" : ""}`}
        style={{ paddingLeft: depth * 14 + 18 }}
        title={entry.path}
        onClick={() => {
          api.select(entry);
          api.openFile(entry.path);
        }}
        onContextMenu={(e) => api.contextMenu(e, entry)}
      >
        <span className="tree-file">{entry.name}</span>
      </div>
    </li>
  );
}

function DirRow({ entry, depth, api }: { entry: FsEntry; depth: number; api: ExplorerApi }) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setChildren(await visibleChildren(entry.path));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && children === null && !loading) await load();
  };

  // Load when the row is open — including on mount, so an expanded root really
  // shows the project's contents instead of waiting for a first click — and
  // again after every tree change (create / copy / paste / remove).
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.version, entry.path]);

  return (
    <li className="tree-node">
      <div
        className={`tree-row tree-folder-row ${api.selected === entry.path ? "selected" : ""}`}
        style={{ paddingLeft: depth * 14 }}
        title={entry.path}
        onClick={() => void toggle()}
        onDoubleClick={() => {
          // A library folder opens in the Library Manager, not in the tree.
          if (api.libraries.has(entry.path)) api.openLibrary(entry.path);
        }}
        onContextMenu={(e) => api.contextMenu(e, entry)}
      >
        <button
          className="tree-caret"
          onClick={(e) => {
            e.stopPropagation();
            void toggle();
          }}
        >
          {open ? "\u25be" : "\u25b8"}
        </button>
        {api.libraries.has(entry.path) && (
          <span className="tree-icon" title="EHDL library folder">
            <BooksIcon />
          </span>
        )}
        <span className="tree-folder">{entry.name}</span>
        {loading && <span className="tree-folder-loading">…</span>}
      </div>
      {error && <div className="tree-error">{error}</div>}
      {open && children && (
        <ul className="tree-list">
          {[...children]
            // Library folders always sort to the bottom of their folder.
            .sort(
              (a, b) =>
                Number(a.isDir && api.libraries.has(a.path)) -
                Number(b.isDir && api.libraries.has(b.path)),
            )
            .map((child) =>
              child.isDir ? (
                <DirRow key={child.path} entry={child} depth={depth + 1} api={api} />
              ) : (
                <FileRow key={child.path} entry={child} depth={depth + 1} api={api} />
              ),
            )}
        </ul>
      )}
    </li>
  );
}

/**
 * Real file-system explorer. Right-clicking gives Add / Copy / Paste / Remove,
 * with a Create submenu (schematic file, library folder, board file) — and, on
 * a library folder, the library items (symbol, footprint part, board snippet).
 */
export function FileExplorer({
  rootPath,
  rootName,
  onOpenFile,
}: {
  rootPath: string;
  rootName: string;
  onOpenFile: (path: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    entry: FsEntry;
    x: number;
    y: number;
    isLibrary: boolean;
    /** For board files: the layer count, read when the menu opens. */
    layers: number | null;
    /** The library manifest inside the right-clicked library folder, if any. */
    manifestPath: string | null;
  } | null>(null);
  const [submenuAnchor, setSubmenuAnchor] = useState<PopupAnchor | null>(null);
  const [clipboard, setClipboard] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
  const [create, setCreate] = useState<{ parent: string; kind: CreateKind } | null>(null);
  /** Library whose footprints folder the IPC wizard writes into. */
  const [wizardLibrary, setWizardLibrary] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createLayers, setCreateLayers] = useState(2);
  const [removeTarget, setRemoveTarget] = useState<FsEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Library folders inside the project — shown last, with a books icon. */
  const [libraryPaths, setLibraryPaths] = useState<string[]>([]);

  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const createItemRef = useRef<HTMLButtonElement>(null);
  const anchor: PopupAnchor | null = menu ? { x: menu.x, y: menu.y, align: "left" } : null;
  const menuPos = usePopupPosition(menu !== null, anchor, menuRef);
  // The Create submenu opens beside its parent item and flips when it would
  // leave the window.
  const submenuPos = usePopupPosition(submenuAnchor !== null, submenuAnchor, submenuRef);

  const openSubmenu = () => {
    const rect = createItemRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSubmenuAnchor({ x: rect.right + 2, y: rect.top, h: rect.height, align: "left" });
  };

  const closeSubmenu = () => setSubmenuAnchor(null);

  const { setActivity } = useContext(AppContext);

  const refresh = () => {
    emptiness.clear(); // folder contents changed: re-judge what is empty
    setVersion((current) => current + 1);
  };

  /** Open a library's manifest in the editor, creating it when missing. */
  const openManifest = async (entry: FsEntry, existing: string | null) => {
    setNotice(null);
    try {
      const path = existing ?? libraryMetaPath(entry.path, entry.name);
      if (!existing) {
        await writeFileText(path, `${JSON.stringify(emptyLibraryMeta(entry.name), null, 2)}\n`);
        refresh();
      }
      onOpenFile(path);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  // Find the project's library folders (the same scan the Library Manager
  // dropdown uses), so they can be sorted to the bottom and given an icon.
  useEffect(() => {
    if (!inTauri) {
      setLibraryPaths([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const found = await findProjectLibraries(rootPath, rootName);
      if (!cancelled) setLibraryPaths(found.map((library) => library.path));
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, rootName, version]);

  // Close the menu (and its submenu) on outside click, Esc, resize or blur.
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(null);
      setSubmenuAnchor(null);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Clicks inside the submenu belong to it, not to the outside.
      if (menuRef.current?.contains(target) || submenuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  /** A folder counts as a library when it is registered or looks like one. */
  const looksLikeLibrary = async (entry: FsEntry): Promise<boolean> => {
    if (!entry.isDir) return false;
    if (loadLibraries().some((library) => library.path === entry.path)) return true;
    try {
      const entries = await listDir(entry.path);
      return entries.some(
        (child) =>
          (child.isDir && (LIBRARY_SECTIONS as readonly string[]).includes(child.name)) ||
          child.name.toLowerCase().endsWith(".ehdlib.json"),
      );
    } catch {
      return false;
    }
  };

  const contextMenu = async (e: ReactMouseEvent, entry: FsEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSubmenuAnchor(null);
    setSelected(entry.path);

    const isLibrary = entry.isDir ? await looksLikeLibrary(entry) : false;
    let layers: number | null = null;
    if (!entry.isDir && isBoardFile(entry.name)) {
      try {
        layers = boardLayersOf(await readFileText(entry.path));
      } catch {
        layers = null;
      }
    }
    // The manifest is hidden from the tree, so its path is offered in the menu.
    let manifestPath: string | null = null;
    if (isLibrary) {
      try {
        const entries = await listDir(entry.path);
        manifestPath =
          entries.find((child) => !child.isDir && MANIFEST.test(child.name))?.path ?? null;
      } catch {
        manifestPath = null;
      }
    }
    setMenu({ entry, x: e.clientX, y: e.clientY, isLibrary, layers, manifestPath });
  };

  /** The folder a create/copy action should target. */
  const targetFolder = (entry: FsEntry) => (entry.isDir ? entry.path : parentOf(entry.path));

  const openCreate = (parent: string, kind: CreateKind) => {
    setMenu(null);
    setSubmenuAnchor(null);
    // Footprints are built by the IPC wizard rather than from a template.
    if (kind === "footprint") {
      setWizardLibrary(parent);
      return;
    }
    setCreate({ parent, kind });
    setCreateName(kind === "library" ? "new_library" : kind === "board" || kind === "board-snippet" ? "new_board" : "new_file");
    setCreateLayers(2);
  };

  const runCreate = async () => {
    if (!create) return;
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    setNotice(null);
    try {
      const existing = await listDir(create.parent);
      /** A file worth opening right after it is created. */
      let created: string | null = null;
      switch (create.kind) {
        case "schematic": {
          const file = uniqueFileName(name, ".vhd", existing);
          const path = joinPath(create.parent, file);
          await writeFileText(path, schematicTemplate(name));
          created = path;
          break;
        }
        case "library": {
          const folder = uniqueFileName(name, "", existing);
          const libraryPath = joinPath(create.parent, folder);
          await createDir(libraryPath);
          for (const section of LIBRARY_SECTIONS) await createDir(joinPath(libraryPath, section));
          await saveLibraryMeta(libraryPath, folder, emptyLibraryMeta(folder));
          break;
        }
        case "board": {
          const file = uniqueFileName(name, BOARD_EXT, existing);
          await writeFileText(
            joinPath(create.parent, file),
            serializeBoardFile(emptyBoard(name, createLayers, "board")),
          );
          break;
        }
        case "component": {
          const dir = joinPath(create.parent, "components");
          await createDir(dir);
          const file = uniqueFileName(name, SECTION_EXT.components, await listDir(dir));
          const path = joinPath(dir, file);
          // A valid VHDL component file, ready for the Part editor.
          await writeFileText(path, serializeComponent(emptyComponent(name)));
          created = path;
          break;
        }
        case "symbol": {
          const dir = joinPath(create.parent, "symbols");
          await createDir(dir);
          const file = uniqueFileName(name, SECTION_EXT.symbols, await listDir(dir));
          const path = joinPath(dir, file);
          await writeFileText(path, symbolTemplate(name));
          created = path;
          break;
        }
        case "footprint": {
          const dir = joinPath(create.parent, "footprints");
          await createDir(dir);
          const file = uniqueFileName(name, SECTION_EXT.footprints, await listDir(dir));
          await writeFileText(joinPath(dir, file), footprintTemplate(name));
          break;
        }
        case "board-snippet": {
          const dir = joinPath(create.parent, "board-snippets");
          await createDir(dir);
          const file = uniqueFileName(name, BOARD_EXT, await listDir(dir));
          await writeFileText(
            joinPath(dir, file),
            serializeBoardFile(emptyBoard(name, createLayers, "board-snippet")),
          );
          break;
        }
      }
      setCreate(null);
      refresh();
      // Open what was just made: components land in the Part editor, symbols
      // and schematics in the text editor.
      if (created) onOpenFile(created);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Paste the clipboard item into a folder (name made unique). */
  const pasteInto = async (folder: string) => {
    if (!clipboard) return;
    setMenu(null);
    setNotice(null);
    try {
      const existing = await listDir(folder);
      const dot = clipboard.name.lastIndexOf(".");
      const base = dot > 0 ? clipboard.name.slice(0, dot) : clipboard.name;
      const ext = dot > 0 ? clipboard.name.slice(dot) : "";
      const name = uniqueFileName(base, clipboard.isDir ? "" : ext, existing);
      await copyEntry(clipboard.path, joinPath(folder, name));
      refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const runRemove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    setNotice(null);
    try {
      await deleteEntry(target.path);
      setSelected((current) => (current === target.path ? null : current));
      refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const api: ExplorerApi = {
    version,
    selected,
    libraries: new Set(libraryPaths),
    select: (entry) => setSelected(entry.path),
    openFile: onOpenFile,
    openLibrary: (path) => {
      requestLibrary(path);
      setActivity("library");
    },
    contextMenu: (e, entry) => void contextMenu(e, entry),
  };

  return (
    <div className="panel project">
      <div className="panel-title" title={rootPath}>
        {rootName}
      </div>
      <div className="panel-body">
        {notice && (
          <div className="library-notice" role="alert">
            <span className="library-notice-text">{notice}</span>
            <button className="library-icon-btn" title="Dismiss" onClick={() => setNotice(null)}>
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
            </button>
          </div>
        )}
        <ul className="tree-list">
          <DirRow entry={{ path: rootPath, name: rootName, isDir: true }} depth={0} api={api} />
        </ul>
      </div>

      {/* Context menu — portaled and measured, flipping near the window edge. */}
      {menu &&
        createPortal(
          <div
            className="library-menu library-context-menu"
            role="menu"
            aria-label="File actions"
            ref={menuRef}
            style={{
              left: menuPos?.left ?? menu.x,
              top: menuPos?.top ?? menu.y,
              visibility: menuPos ? "visible" : "hidden",
            }}
          >
            <div className="library-menu-title" title={menu.entry.path}>
              {menu.entry.name}
            </div>

            <button
              ref={createItemRef}
              className="library-menu-item"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenuAnchor !== null}
              onMouseEnter={openSubmenu}
              onClick={() => (submenuAnchor ? closeSubmenu() : openSubmenu())}
            >
              Create
              <span className="library-menu-arrow" aria-hidden="true">
                ▸
              </span>
            </button>

            {menu.isLibrary && (
              <button
                className="library-menu-item"
                role="menuitem"
                title="<library>.ehdlib.json — hidden from the tree"
                onMouseEnter={closeSubmenu}
                onClick={() => {
                  const { entry, manifestPath } = menu;
                  setMenu(null);
                  void openManifest(entry, manifestPath);
                }}
              >
                {menu.manifestPath ? "Edit library manifest" : "Create library manifest"}
              </button>
            )}

            <div className="library-menu-sep" role="separator" />

            <button
              className="library-menu-item"
              role="menuitem"
              onMouseEnter={closeSubmenu}
              onClick={() => {
                setClipboard({
                  path: menu.entry.path,
                  name: menu.entry.name,
                  isDir: menu.entry.isDir,
                });
                setMenu(null);
              }}
            >
              Copy
            </button>
            <button
              className="library-menu-item"
              role="menuitem"
              disabled={!clipboard}
              title={clipboard ? `Paste “${clipboard.name}” here` : "Nothing copied yet"}
              onMouseEnter={closeSubmenu}
              onClick={() => void pasteInto(targetFolder(menu.entry))}
            >
              Paste
            </button>

            <div className="library-menu-sep" role="separator" />

            <button
              className="library-menu-item danger"
              role="menuitem"
              onMouseEnter={closeSubmenu}
              onClick={() => {
                setRemoveTarget(menu.entry);
                setMenu(null);
              }}
            >
              Remove
            </button>

            {menu.layers !== null && (
              <>
                <div className="library-menu-sep" role="separator" />
                <div className="library-menu-note">
                  board file · {menu.layers} layer{menu.layers === 1 ? "" : "s"} — usable as a snippet on
                  boards with {menu.layers}+ layers
                </div>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* Create submenu — a second measured popup beside its parent item,
          listing what can be added (library items when a library folder was
          right-clicked). */}
      {submenuAnchor &&
        menu &&
        createPortal(
          <div
            className="library-menu library-submenu"
            role="menu"
            aria-label="Create"
            ref={submenuRef}
            style={{
              left: submenuPos?.left ?? submenuAnchor.x,
              top: submenuPos?.top ?? submenuAnchor.y,
              visibility: submenuPos ? "visible" : "hidden",
            }}
          >
            <div className="library-menu-title">
              {menu.isLibrary ? "New library item" : "Create"}
            </div>
            {(menu.isLibrary ? LIBRARY_CREATE_ITEMS : CREATE_ITEMS).map((item) => (
              <button
                key={item.kind}
                className="library-menu-item"
                role="menuitem"
                // The explanation lives in the hover label, not in the menu.
                title={`${item.label} — ${item.hint}`}
                onClick={() => openCreate(menu.entry.path, item.kind)}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}

      {/* Create dialog: name, plus the layer stack for boards and snippets. */}
      {create && (
        <PanelDialog
          title={CREATE_TITLES[create.kind]}
          onClose={() => setCreate(null)}
          onConfirm={() => {
            if (!busy && createName.trim()) void runCreate();
          }}
          actions={
            <>
              <button className="btn" onClick={() => setCreate(null)}>
                Cancel
              </button>
              <button
                className="btn settings-primary-btn"
                disabled={busy || !createName.trim()}
                onClick={() => void runCreate()}
              >
                Create
              </button>
            </>
          }
        >
          <div className="panel-dialog-field">
            <label htmlFor="explorer-create-name">Name</label>
            <input
              id="explorer-create-name"
              className="settings-input"
              type="text"
              spellCheck={false}
              autoFocus
              // The default name is meant to be replaced: select it on focus.
              onFocus={(e) => e.currentTarget.select()}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
          </div>
          {(create.kind === "board" || create.kind === "board-snippet") && (
            <div className="panel-dialog-field">
              <label htmlFor="explorer-create-layers">Layer stack</label>
              <select
                id="explorer-create-layers"
                className="settings-select"
                value={createLayers}
                onChange={(e) => setCreateLayers(Number(e.target.value))}
              >
                {LAYER_CHOICES.map((layers) => (
                  <option key={layers} value={layers}>
                    {layers} copper layers
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="panel-dialog-hint">
            {create.kind === "library" ? (
              <>
                Created in <b>{create.parent}</b> with the component, symbol, footprint, board-snippet
                and template folders plus its <code>.ehdlib.json</code> manifest.
              </>
            ) : create.kind === "component" ? (
              <>
                Written as a VHDL component (package, entity, architecture) in the library's{" "}
                <code>components</code> folder and opened in the Part editor.
              </>
            ) : create.kind === "board-snippet" ? (
              <>
                Saved in the library's <code>board-snippets</code> folder. A snippet only fits boards
                whose layer stack is at least this deep.
              </>
            ) : (
              <>
                Created in <b>{create.parent}</b>.
              </>
            )}
          </p>
        </PanelDialog>
      )}

      {/* IPC footprint wizard — computes the land pattern, previews it and
          writes <name>.fpt.ehd into the library's footprints folder. */}
      {wizardLibrary && (
        <FootprintWizard
          libraryPath={wizardLibrary}
          onClose={() => setWizardLibrary(null)}
          onCreated={(path) => {
            setWizardLibrary(null);
            refresh();
            onOpenFile(path);
          }}
        />
      )}

      {/* Remove confirmation */}
      {removeTarget && (
        <PanelDialog
          title={`Remove “${removeTarget.name}”?`}
          onClose={() => setRemoveTarget(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void runRemove()}>
                Remove
              </button>
            </>
          }
        >
          <p className="panel-dialog-text">
            {removeTarget.isDir
              ? "The folder and everything inside it are deleted from disk."
              : "The file is deleted from disk."}
          </p>
          <p className="panel-dialog-text panel-dialog-muted">{removeTarget.path}</p>
        </PanelDialog>
      )}
    </div>
  );
}