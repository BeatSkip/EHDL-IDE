import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { AppContext } from "../appContext";
import { loadLibraries, subscribeLibraries, LIBRARY_SECTIONS } from "../settings";
import type { LibraryEntry, LibrarySectionId } from "../settings";
import {
  inTauri,
  openInFileManager,
  listDir,
  createDir,
  renameEntry,
  deleteEntry,
  copyEntry,
  writeFileText,
  readFileText,
  joinPath,
} from "../fs";
import type { FsEntry } from "../fs";
import { usePopupPosition } from "../popupPosition";
import type { PopupAnchor } from "../popupPosition";
import {
  SECTION_EXT,
  SECTION_LABELS,
  DEFAULT_ITEM_NAMES,
  DEFAULT_SUBCATEGORY_NAME,
  displayName,
  fileNameOf,
  hiddenExt,
  splitName,
  uniqueFileName,
} from "../libraryFiles";
import { LIBRARY_ICONS, DEFAULT_ICON_ID, LibraryIconGlyph } from "../libraryIcons";
import {
  loadLibraryMeta,
  saveLibraryMeta,
  relativeKey,
  libraryMetaPath,
  emptyLibraryMeta,
} from "../libraryMeta";
import type { LibraryMeta, SubCategoryMeta } from "../libraryMeta";
import { emptyComponent, serializeComponent } from "../vhdlPart";
import { loadComponentDatabase } from "../componentLibrary";
import type { LibraryIssue } from "../componentLibrary";
import { PanelDialog } from "./PanelDialog";
import { findProjectLibraries, requestLibrary, takePendingLibrary } from "../projectLibraries";
import { FootprintWizard } from "./FootprintWizard";
import type { ProjectLibrary } from "../projectLibraries";

/** The category folders every library exposes, in display order. */
const SECTIONS: { id: LibrarySectionId; label: string }[] = LIBRARY_SECTIONS.map((id) => ({
  id,
  label: SECTION_LABELS[id],
}));

/**
 * Session clipboard for parts. Kept outside the component so a copied part can
 * be pasted after switching library — or after the panel was closed and
 * reopened from the activity bar. `fromPath` is the folder the part came from,
 * so a paste works across libraries too.
 */
let itemClipboard: { name: string; fromPath: string } | null = null;

/** A loaded section: its absolute folder path plus its direct entries. */
interface SectionData {
  path: string;
  entries: FsEntry[];
}
type LibraryData = Record<LibrarySectionId, SectionData>;

/** What a context menu was opened on. */
type MenuTarget =
  | { kind: "category"; section: LibrarySectionId; folderPath: string }
  | { kind: "sub"; section: LibrarySectionId; folderPath: string; parentPath: string; name: string }
  | { kind: "part"; section: LibrarySectionId; path: string; parentPath: string; name: string };

type ContextMenuState = MenuTarget & { x: number; y: number };

interface Renaming {
  path: string;
  parentPath: string;
  name: string;
  draft: string;
  isDir: boolean;
}

type DetailsTarget = { kind: "library" } | { kind: "sub"; path: string; name: string };

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.5 4.5h4.2l1.6 2h7.2v7H1.5z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3.5 2.5h6l3 3v8h-9z" />
      <path d="M9.5 2.5v3h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7.2v4M8 4.9v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 8.5l4 4 7-9" />
    </svg>
  );
}

/** Details of one sub-category: icon, description and notes. */
function SubDetailsDialog({
  name,
  initial,
  onSave,
  onClose,
}: {
  name: string;
  initial: SubCategoryMeta;
  onSave: (patch: SubCategoryMeta) => void;
  onClose: () => void;
}) {
  const [icon, setIcon] = useState(initial.icon ?? DEFAULT_ICON_ID);
  const [description, setDescription] = useState(initial.description ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  return (
    <PanelDialog
      wide
      title={`Sub-category “${name}”`}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn settings-primary-btn"
            onClick={() =>
              onSave({
                icon,
                description: description.trim() || undefined,
                notes: notes.trim() || undefined,
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="panel-dialog-field">
        <label>Icon</label>
        <div className="icon-grid">
          {LIBRARY_ICONS.map((entry) => (
            <button
              key={entry.id}
              className={`icon-choice ${icon === entry.id ? "active" : ""}`}
              title={entry.label}
              aria-label={entry.label}
              aria-pressed={icon === entry.id}
              onClick={() => setIcon(entry.id)}
            >
              <LibraryIconGlyph id={entry.id} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="panel-dialog-field">
        <label htmlFor="sub-desc">Description</label>
        <input
          id="sub-desc"
          className="settings-input"
          type="text"
          spellCheck={false}
          placeholder="optional — shown as the row tooltip"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="panel-dialog-field">
        <label htmlFor="sub-notes">Notes</label>
        <textarea
          id="sub-notes"
          className="settings-input panel-dialog-textarea"
          rows={3}
          spellCheck={false}
          placeholder="optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </PanelDialog>
  );
}

/** Details of the library itself. */
function LibraryDetailsDialog({
  name,
  metaFile,
  initial,
  onSave,
  onClose,
}: {
  name: string;
  metaFile: string;
  initial: LibraryMeta;
  onSave: (patch: { description: string; notes: string }) => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(initial.description ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  return (
    <PanelDialog
      title={`Library “${name}”`}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn settings-primary-btn"
            onClick={() => onSave({ description: description.trim(), notes: notes.trim() })}
          >
            Save
          </button>
        </>
      }
    >
      <div className="panel-dialog-field">
        <label htmlFor="lib-desc">Description</label>
        <input
          id="lib-desc"
          className="settings-input"
          type="text"
          spellCheck={false}
          placeholder="optional"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="panel-dialog-field">
        <label htmlFor="lib-notes">Notes</label>
        <textarea
          id="lib-notes"
          className="settings-input panel-dialog-textarea"
          rows={4}
          spellCheck={false}
          placeholder="optional — free-form notes about this library"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <p className="panel-dialog-hint">Saved in {metaFile} inside the library folder.</p>
    </PanelDialog>
  );
}

/**
 * Library manager sidebar panel.
 *
 * A library is a folder. Its categories (components, symbols, footprints,
 * board-snippets, templates) are subfolders, holding plain-text part files plus
 * optional **sub-category folders**. Details that are not part of a part file —
 * library description/notes, and each sub-category's icon/description/notes —
 * live in `<library_name>.ehdlib.json` in the library's top folder.
 */
export function LibraryView() {
  const { openFsPath, project } = useContext(AppContext);

  const [libraries, setLibraries] = useState<LibraryEntry[]>(() => loadLibraries());
  /** Library folders found inside the opened project (see projectLibraries.ts). */
  const [projectLibraries, setProjectLibraries] = useState<ProjectLibrary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [libraryData, setLibraryData] = useState<LibraryData | null>(null);
  const [meta, setMeta] = useState<LibraryMeta | null>(null);
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A failed operation (rename, delete, …) — shown as a banner, not instead of the tree. */
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((section) => [section.id, true])),
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addAnchor, setAddAnchor] = useState<PopupAnchor | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [detailsFor, setDetailsFor] = useState<DetailsTarget | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [checkResult, setCheckResult] = useState<{
    fileCount: number;
    componentCount: number;
    issues: LibraryIssue[];
  } | null>(null);
  const [checking, setChecking] = useState(false);
  /** The IPC footprint wizard is open (footprints are generated, not blank). */
  const [footprintWizard, setFootprintWizard] = useState(false);

  const addWrapRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const lastPathRef = useRef<string | null>(null);

  /** Project libraries first, then the ones configured in Settings → Library. */
  const allLibraries: LibraryEntry[] = [
    ...projectLibraries.map((library) => ({
      id: library.id,
      name: library.name,
      path: library.path,
    })),
    ...libraries,
  ];

  const selected = allLibraries.find((lib) => lib.id === selectedId) ?? null;
  const libPath = selected?.path ?? null;
  const usable = inTauri && !!libPath && !!libraryData;

  // Both menus measure themselves and flip when the sidebar is too narrow.
  const addMenuPos = usePopupPosition(addMenuOpen, addAnchor, addMenuRef);
  const contextMenuPos = usePopupPosition(
    contextMenu !== null,
    contextMenu ? { x: contextMenu.x, y: contextMenu.y, align: "left" } : null,
    contextMenuRef,
  );

  // Search terms: comma separated, any of them may match (OR).
  const terms = query
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  const isFiltering = terms.length > 0;
  const matchesQuery = (name: string) => {
    const lower = name.toLowerCase();
    return terms.some((term) => lower.includes(term));
  };

  /** Sub-category details from the library manifest. */
  const subMeta = (path: string): SubCategoryMeta | undefined =>
    libPath && meta ? meta.subCategories[relativeKey(libPath, path)] : undefined;

  const metaFileName = libPath && selected ? fileNameOf(libraryMetaPath(libPath, selected.name)) : "";

  // Stay in sync when libraries are added/removed/renamed in the Settings modal.
  useEffect(() => subscribeLibraries(setLibraries), []);

  // Keep the selection valid: follow the first library until one is chosen. A
  // project library sorts first, so opening the panel inside a project shows
  // that project's own parts straight away.
  useEffect(() => {
    setSelectedId((current) => {
      if (current && allLibraries.some((lib) => lib.id === current)) return current;
      return allLibraries.length > 0 ? allLibraries[0].id : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraries, projectLibraries]);

  // Look for a library folder inside the opened project.
  useEffect(() => {
    if (!inTauri || project.kind !== "folder") {
      setProjectLibraries([]);
      return;
    }
    const rootPath = project.rootPath;
    const rootName = project.rootName;
    let cancelled = false;
    void (async () => {
      const found = await findProjectLibraries(rootPath, rootName);
      if (!cancelled) setProjectLibraries(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [project, refresh]);

  // Opened from the project explorer (double-clicking a library folder):
  // select that library once it appears in the list.
  useEffect(() => {
    const pending = takePendingLibrary();
    if (!pending) return;
    const match = allLibraries.find((lib) => lib.path === pending);
    if (match) setSelectedId(match.id);
    else requestLibrary(pending); // the project scan may still be running
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLibraries, libraries]);

  // While filtering, open every category so the matches are visible.
  useEffect(() => {
    if (!isFiltering) return;
    setOpenSections(Object.fromEntries(SECTIONS.map((section) => [section.id, true])));
  }, [isFiltering, query]);

  // Close the "create new" menu on outside click, Esc, resize or window blur.
  useEffect(() => {
    if (!addMenuOpen) return;
    const close = () => setAddMenuOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (addWrapRef.current?.contains(target) || addMenuRef.current?.contains(target)) return;
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
  }, [addMenuOpen]);

  // Close the context menu on outside click, Esc, resize or window blur.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!contextMenuRef.current?.contains(e.target as Node)) close();
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
  }, [contextMenu]);

  // Load the selected library: its manifest, its category folders (creating any
  // that are missing) and each category's entries.
  useEffect(() => {
    const path = selected?.path ?? null;
    const name = selected?.name ?? "";
    if (lastPathRef.current !== path) {
      lastPathRef.current = path;
      setLibraryData(null);
      setMeta(null);
      setChildren({});
      setExpanded({});
      setSelectedPath(null);
      setRenaming(null);
    }
    if (!path || !inTauri) {
      setLibraryData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const loadedMeta = await loadLibraryMeta(path, name);
        if (!cancelled) setMeta(loadedMeta);
        const root = await listDir(path);
        const map = {} as LibraryData;
        for (const section of SECTIONS) {
          const existing = root.find((entry) => entry.isDir && entry.name === section.id);
          const sectionPath = existing?.path ?? joinPath(path, section.id);
          if (!existing) await createDir(sectionPath); // auto-create the category folder
          map[section.id] = { path: sectionPath, entries: await listDir(sectionPath) };
        }
        if (!cancelled) setLibraryData(map);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.path, selected?.name, inTauri, refresh]);

  // Load the contents of expanded sub-categories that aren't cached yet.
  useEffect(() => {
    if (!inTauri) return;
    for (const path of Object.keys(expanded)) {
      if (expanded[path] && !(path in children)) void loadChildren(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, children, inTauri]);

  // While searching, load the whole tree (bounded) so matches inside
  // sub-categories can be found.
  useEffect(() => {
    if (!isFiltering || !libraryData || !inTauri) return;
    let cancelled = false;
    const walk = async (path: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      let entries: FsEntry[];
      try {
        entries = await listDir(path);
      } catch {
        return;
      }
      if (cancelled) return;
      setChildren((current) => ({ ...current, [path]: entries }));
      for (const entry of entries) {
        if (entry.isDir) await walk(entry.path, depth + 1);
      }
    };
    void (async () => {
      for (const section of SECTIONS) await walk(libraryData[section.id].path, 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [isFiltering, libraryData]);

  const loadChildren = async (path: string) => {
    try {
      const entries = await listDir(path);
      setChildren((current) => ({ ...current, [path]: entries }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const sectionEntries = (section: LibrarySectionId): FsEntry[] =>
    libraryData?.[section]?.entries ?? [];

  /** Direct entries of a folder: the category root or a loaded sub-category. */
  const entriesFor = (section: LibrarySectionId, folderPath: string): FsEntry[] =>
    libraryData && folderPath === libraryData[section].path
      ? libraryData[section].entries
      : (children[folderPath] ?? []);

  const invalidate = (path: string) =>
    setChildren((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });

  const forget = (path: string) => {
    invalidate(path);
    setExpanded((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  };

  const persistMeta = async (next: LibraryMeta) => {
    setMeta(next);
    if (!libPath || !selected) return;
    try {
      await saveLibraryMeta(libPath, selected.name, next);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const saveSubDetails = (path: string, patch: SubCategoryMeta) => {
    if (!libPath || !meta) return;
    const key = relativeKey(libPath, path);
    void persistMeta({
      ...meta,
      subCategories: { ...meta.subCategories, [key]: { ...meta.subCategories[key], ...patch } },
    });
    setDetailsFor(null);
  };

  const saveLibraryDetails = (patch: { description: string; notes: string }) => {
    if (!meta) return;
    void persistMeta({
      ...meta,
      description: patch.description || undefined,
      notes: patch.notes || undefined,
    });
    setDetailsFor(null);
  };

  /** Move a sub-category's manifest entry when its folder is renamed. */
  const rekeyMeta = (oldKey: string, newKey: string) => {
    if (!meta) return;
    const subCategories: Record<string, SubCategoryMeta> = {};
    let changed = false;
    for (const [key, value] of Object.entries(meta.subCategories)) {
      if (key === oldKey || key.startsWith(`${oldKey}/`)) {
        subCategories[`${newKey}${key.slice(oldKey.length)}`] = value;
        changed = true;
      } else {
        subCategories[key] = value;
      }
    }
    if (changed) void persistMeta({ ...meta, subCategories });
  };

  /** Drop a sub-category's manifest entry — and those of its descendants. */
  const removeMetaEntry = (path: string) => {
    if (!libPath || !meta) return;
    const key = relativeKey(libPath, path);
    const doomed = Object.keys(meta.subCategories).filter(
      (entry) => entry === key || entry.startsWith(`${key}/`),
    );
    if (doomed.length === 0) return;
    const subCategories = { ...meta.subCategories };
    for (const entry of doomed) delete subCategories[entry];
    void persistMeta({ ...meta, subCategories });
  };

  /** Count every part file inside a folder (recursively, bounded). */
  const countParts = async (path: string, depth = 0): Promise<number> => {
    if (depth > 8) return 0;
    let entries: FsEntry[];
    try {
      entries = await listDir(path);
    } catch {
      return 0;
    }
    let total = 0;
    for (const entry of entries) {
      total += entry.isDir ? await countParts(entry.path, depth + 1) : 1;
    }
    return total;
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (query) setQuery("");
    else closeSearch();
  };

  const selectLibrary = (id: string) => {
    setSelectedId(id);
    setSelectedPath(null);
    setRenaming(null);
    setAddMenuOpen(false);
    setContextMenu(null);
    setQuery("");
  };

  /** Toggle the "create new" menu, anchored to the + button. */
  const toggleAddMenu = () => {
    if (addMenuOpen) {
      setAddMenuOpen(false);
      return;
    }
    const rect = addWrapRef.current?.getBoundingClientRect();
    setAddAnchor(rect ? { x: rect.right, y: rect.bottom, h: rect.height, align: "right" } : null);
    setAddMenuOpen(true);
  };

  const openContextMenu = (e: ReactMouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation(); // don't also open the parent's menu
    setAddMenuOpen(false);
    if (target.kind === "part") setSelectedPath(target.path);
    setContextMenu({ ...target, x: e.clientX, y: e.clientY });
  };

  /** Right-click on a category header / its empty area. */
  const openCategoryMenu = (e: ReactMouseEvent, section: LibrarySectionId) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // renaming: native menu
    const folderPath = libraryData?.[section]?.path;
    if (!folderPath) return;
    openContextMenu(e, { kind: "category", section, folderPath });
  };

  /** Create a new part file in a folder and start renaming it. */
  const addPart = async (section: LibrarySectionId, folderPath: string) => {
    // Footprints are built by the IPC wizard rather than from a blank template.
    if (section === "footprints") {
      setFootprintWizard(true);
      return;
    }
    const name = uniqueFileName(
      DEFAULT_ITEM_NAMES[section],
      SECTION_EXT[section],
      entriesFor(section, folderPath),
    );
    try {
      const path = joinPath(folderPath, name);
      // Components start from a valid VHDL component file, so they can be
      // opened in the Part editor straight away.
      const content =
        section === "components" ? serializeComponent(emptyComponent(splitName(name).base)) : "";
      await writeFileText(path, content);
      invalidate(folderPath);
      setRefresh((r) => r + 1);
      setExpanded((current) => ({ ...current, [folderPath]: true }));
      setRenaming({ path, parentPath: folderPath, name, draft: displayName(name), isDir: false });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  /** Create a new sub-category folder inside a category (or another
   *  sub-category — nesting is allowed at any depth) and start renaming it. */
  const addSubCategory = async (section: LibrarySectionId, folderPath: string) => {
    const name = uniqueFileName(DEFAULT_SUBCATEGORY_NAME, "", entriesFor(section, folderPath));
    try {
      const path = joinPath(folderPath, name);
      await createDir(path);
      invalidate(folderPath);
      setRefresh((r) => r + 1);
      // Make sure the parent is open, so the new folder is visible.
      setExpanded((current) => ({ ...current, [folderPath]: true }));
      setRenaming({ path, parentPath: folderPath, name, draft: name, isDir: true });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const startRename = (parentPath: string, path: string, name: string, isDir: boolean) =>
    setRenaming({
      path,
      parentPath,
      name,
      // Files are listed (and renamed) without their part extension.
      draft: isDir ? name : displayName(name),
      isDir,
    });

  const commitRename = async () => {
    if (!renaming) return;
    const { path, parentPath, name, draft, isDir } = renaming;
    const typed = draft.trim();
    setRenaming(null);
    if (!typed) return;
    // Renaming a file keeps its (hidden) extension unless a new one is typed.
    const ext = isDir ? "" : hiddenExt(name);
    const newName = !isDir && ext && !hiddenExt(typed) ? `${typed}${ext}` : typed;
    if (newName === name) return;
    const newPath = joinPath(parentPath, newName);
    try {
      await renameEntry(path, newPath);
      if (isDir && libPath) rekeyMeta(relativeKey(libPath, path), relativeKey(libPath, newPath));
      forget(path);
      invalidate(parentPath);
      setRefresh((r) => r + 1);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const onRenameKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRename();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setRenaming(null);
    }
  };

  const copyPart = (name: string, fromPath: string) => {
    itemClipboard = { name, fromPath };
    setContextMenu(null);
  };

  const pasteInto = async (section: LibrarySectionId, folderPath: string) => {
    if (!itemClipboard) return;
    const { base, ext } = splitName(itemClipboard.name);
    const name = uniqueFileName(base, ext, entriesFor(section, folderPath));
    try {
      await copyEntry(joinPath(itemClipboard.fromPath, itemClipboard.name), joinPath(folderPath, name));
      invalidate(folderPath);
      setRefresh((r) => r + 1);
      setExpanded((current) => ({ ...current, [folderPath]: true }));
      setRenaming({ path: joinPath(folderPath, name), parentPath: folderPath, name, draft: displayName(name), isDir: false });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
    setContextMenu(null);
  };

  const duplicatePart = async (section: LibrarySectionId, parentPath: string, name: string) => {
    const { base, ext } = splitName(name);
    const newName = uniqueFileName(base, ext, entriesFor(section, parentPath));
    try {
      await copyEntry(joinPath(parentPath, name), joinPath(parentPath, newName));
      invalidate(parentPath);
      setRefresh((r) => r + 1);
      setExpanded((current) => ({ ...current, [parentPath]: true }));
      setRenaming({ path: joinPath(parentPath, newName), parentPath, name: newName, draft: displayName(newName), isDir: false });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
    setContextMenu(null);
  };

  const performDelete = async (path: string, parentPath: string) => {
    try {
      await deleteEntry(path);
      forget(path);
      removeMetaEntry(path);
      invalidate(parentPath);
      setRefresh((r) => r + 1);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
    setSelectedPath((current) => (current === path ? null : current));
    setContextMenu(null);
  };

  /** Deleting a sub-category warns first when it still holds parts. */
  const requestDeleteSub = async (
    folderPath: string,
    parentPath: string,
    name: string,
  ) => {
    setContextMenu(null);
    const parts = await countParts(folderPath);
    if (parts > 0) {
      setConfirmState({
        title: `Delete “${name}”?`,
        message: `This sub-category holds ${parts} part${parts === 1 ? "" : "s"}. Deleting it removes the folder and everything inside it.`,
        confirmLabel: "Delete",
        onConfirm: () => {
          setConfirmState(null);
          void performDelete(folderPath, parentPath);
        },
      });
    } else {
      void performDelete(folderPath, parentPath);
    }
  };

  /**
   * Parse every component file of this library and report the spec's problems
   * (missing constructs, port/pin-map mismatches, duplicate entities).
   */
  const runLibraryCheck = async () => {
    const componentsPath = libraryData?.components?.path;
    if (!componentsPath || checking) return;
    setChecking(true);
    try {
      const database = await loadComponentDatabase(componentsPath, readFileText);
      setCheckResult({
        fileCount: database.fileCount,
        componentCount: database.components.length,
        issues: database.issues,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const openLibraryFolder = async () => {    if (!libPath) return;
    try {
      await openInFileManager(libPath);
    } catch (err) {
      console.error("Failed to open library folder:", err);
    }
  };

  const entryMatches = (entry: FsEntry): boolean => {
    if (matchesQuery(displayName(entry.name))) return true;
    if (!entry.isDir) return false;
    const kids = children[entry.path];
    if (!kids) return false;
    return kids.some((kid) => entryMatches(kid));
  };

  const renderPart = (
    section: LibrarySectionId,
    parentPath: string,
    entry: FsEntry,
  ): ReactNode => {
    if (isFiltering && !matchesQuery(displayName(entry.name))) return null;
    if (renaming?.path === entry.path) {
      return (
        <div className="library-item" key={entry.path}>
          <input
            className="settings-input library-item-input"
            type="text"
            autoFocus
            spellCheck={false}
            aria-label="Rename part"
            value={renaming.draft}
            onChange={(e) => setRenaming((cur) => (cur ? { ...cur, draft: e.target.value } : cur))}
            onKeyDown={onRenameKey}
            onBlur={() => void commitRename()}
          />
        </div>
      );
    }
    return (
      <div
        className={`library-item ${selectedPath === entry.path ? "selected" : ""}`}
        key={entry.path}
        title={`${entry.name} — double-click to open, right-click for options`}
        onClick={() => setSelectedPath(entry.path)}
        onDoubleClick={() => void openFsPath(entry.path)}
        onContextMenu={(e) =>
          openContextMenu(e, {
            kind: "part",
            section,            path: entry.path,
            parentPath,
            name: entry.name,
          })
        }
      >
        <span className="library-item-icon">
          <FileIcon />
        </span>
        <span className="library-item-name">{displayName(entry.name)}</span>
      </div>
    );
  };

  const renderFolder = (
    section: LibrarySectionId,
    parentPath: string,
    entry: FsEntry,
    forceOpen: boolean,
  ): ReactNode => {
    if (isFiltering && !entryMatches(entry)) return null;
    const details = subMeta(entry.path);

    if (renaming?.path === entry.path) {
      return (
        <div className="library-subcat" key={entry.path}>
          <div className="library-subcat-head">
            <input
              className="settings-input library-item-input"
              type="text"
              autoFocus
              spellCheck={false}
              aria-label="Rename sub-category"
              value={renaming.draft}
              onChange={(e) => setRenaming((cur) => (cur ? { ...cur, draft: e.target.value } : cur))}
              onKeyDown={onRenameKey}
              onBlur={() => void commitRename()}
            />
          </div>
        </div>
      );
    }

    const open = forceOpen || !!expanded[entry.path];
    const kids = children[entry.path];
    return (
      <div className="library-subcat" key={entry.path}>
        <div
          className="library-subcat-head"
          title={
            details?.description
              ? `${entry.name} — ${details.description}`
              : `${entry.name} — click to expand, right-click for options`
          }
          onClick={() => setExpanded((current) => ({ ...current, [entry.path]: !current[entry.path] }))}
          onContextMenu={(e) =>
            openContextMenu(e, {
              kind: "sub",
              section,
              folderPath: entry.path,
              parentPath,
              name: entry.name,
            })
          }
        >
          <span className={`library-subcat-caret ${open ? "open" : ""}`} aria-hidden="true">
            ▸
          </span>
          <span className="library-item-icon">
            <LibraryIconGlyph id={details?.icon ?? DEFAULT_ICON_ID} />
          </span>
          <span className="library-item-name">{entry.name}</span>
          {kids && <span className="library-subcat-count">{kids.length}</span>}
        </div>
        {open && (
          <div className="library-subcat-body">
            {kids ? (
              kids.map((kid) =>
                kid.isDir
                  ? renderFolder(section, entry.path, kid, forceOpen)
                  : renderPart(section, entry.path, kid),
              )
            ) : (
              <div className="library-subcat-loading">Loading…</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-body library-panel-body">
        {libraries.length === 0 ? (
          <p className="hint">
            No libraries configured yet. Add the top folder of each HDL library under Settings →
            Library.
          </p>
        ) : (
          <>
            <div className="library-toolbar">
              <select
                className="settings-select library-select"
                aria-label="Select library"
                value={selectedId ?? ""}
                onChange={(e) => selectLibrary(e.target.value)}
              >
                {projectLibraries.map((library) => (
                  <option key={library.id} value={library.id} title={library.path}>
                    {library.label}
                  </option>
                ))}
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id} title={lib.path || "no folder set"}>
                    {lib.name || "(unnamed)"}
                  </option>
                ))}
              </select>

              <div className="library-add-wrap" ref={addWrapRef}>
                <button
                  className="library-icon-btn"
                  title="Create a new part…"
                  aria-label="Create a new part"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  disabled={!usable}
                  onClick={toggleAddMenu}
                >
                  <PlusIcon />
                </button>
              </div>

              <button
                className="library-icon-btn"
                title={
                  !inTauri
                    ? "Opening folders is only available in the desktop app"
                    : libPath
                      ? `Open ${libPath} in Explorer`
                      : "This library has no folder set"
                }
                aria-label="Open library folder"
                disabled={!libPath || !inTauri}
                onClick={() => void openLibraryFolder()}
              >
                <FolderIcon />
              </button>

              <button
                className={`library-icon-btn ${searchOpen ? "active" : ""}`}
                title={searchOpen ? "Hide the search bar" : "Search this library"}
                aria-label="Search library"
                aria-pressed={searchOpen}
                disabled={!usable}
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              >
                <SearchIcon />
              </button>

              <button
                className="library-icon-btn"
                title="Check the library — parse every component file"
                aria-label="Check the library"
                disabled={!usable || checking}
                onClick={() => void runLibraryCheck()}
              >
                <CheckIcon />
              </button>

              <button
                className="library-icon-btn"
                title="Library details — description and notes"
                aria-label="Library details"
                disabled={!usable}
                onClick={() => setDetailsFor({ kind: "library" })}
              >
                <InfoIcon />
              </button>
            </div>

            {searchOpen && (
              <div className="library-search">
                <input
                  className="settings-input library-search-input"
                  type="text"
                  autoFocus
                  spellCheck={false}
                  placeholder="Search — commas separate terms (OR)"
                  title="Matches parts and sub-categories containing any of the comma-separated terms"
                  aria-label="Search library"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                />
                <button
                  className="library-icon-btn library-search-clear"
                  title="Clear the search"
                  aria-label="Clear search"
                  disabled={!query}
                  onClick={() => setQuery("")}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                  </svg>
                </button>
              </div>
            )}

            {notice && (
              <div className="library-notice" role="alert">
                <span className="library-notice-text">{notice}</span>
                <button
                  className="library-icon-btn"
                  title="Dismiss"
                  aria-label="Dismiss"
                  onClick={() => setNotice(null)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                  </svg>
                </button>
              </div>
            )}

            {!inTauri ? (
              <p className="hint">
                Library browsing requires the desktop app — run <code>npm run tauri dev</code>.
              </p>
            ) : loading ? (
              <p className="hint">Loading library…</p>
            ) : error ? (
              <p className="hint">{error}</p>
            ) : libraryData ? (
              <div className="library-sections">
                {SECTIONS.map((section) => {
                  const data = libraryData[section.id];
                  const entries = sectionEntries(section.id);
                  const visibleCount = isFiltering
                    ? entries.filter((entry) =>
                        entry.isDir ? entryMatches(entry) : matchesQuery(displayName(entry.name)),
                      ).length
                    : entries.length;
                  const open = openSections[section.id] || isFiltering;
                  const badge = isFiltering ? `${visibleCount}/${entries.length}` : `${entries.length}`;
                  return (
                    <section
                      className="library-section"
                      key={section.id}
                      onContextMenu={(e) => openCategoryMenu(e, section.id)}
                    >
                      <button
                        className="library-section-head"
                        aria-expanded={open}
                        title={open ? `Collapse ${section.label}` : `Expand ${section.label}`}
                        onClick={() =>
                          setOpenSections((current) => ({
                            ...current,
                            [section.id]: !current[section.id],
                          }))
                        }
                      >
                        <span
                          className={`library-section-caret ${open ? "open" : ""}`}
                          aria-hidden="true"
                        >
                          ▸
                        </span>
                        <span className="library-section-title">{section.label}</span>
                        <span className="library-section-count">{badge}</span>
                      </button>

                      {open &&
                        (entries.length === 0 ? (
                          <div className="library-section-empty">
                            No {section.label.toLowerCase()} yet.
                          </div>
                        ) : visibleCount === 0 ? (
                          <div className="library-section-empty">No matches.</div>
                        ) : (
                          <div className="library-section-items">
                            {entries.map((entry) =>
                              entry.isDir
                                ? renderFolder(section.id, data.path, entry, isFiltering)
                                : renderPart(section.id, data.path, entry),
                            )}
                          </div>
                        ))}
                    </section>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* "Create new" menu — portaled and measured: it opens leftwards from the
          + button, flipping to the right when the sidebar is too narrow. */}
      {addMenuOpen &&
        createPortal(
          <div
            className="library-menu"
            role="menu"
            aria-label="Create new"
            ref={addMenuRef}
            style={{
              left: addMenuPos?.left ?? addAnchor?.x ?? 0,
              top: addMenuPos?.top ?? addAnchor?.y ?? 0,
              visibility: addMenuPos ? "visible" : "hidden",
            }}
          >
            <div className="library-menu-title">Create new part in</div>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                className="library-menu-item"
                role="menuitem"
                onClick={() => {
                  const folderPath = libraryData?.[section.id]?.path;
                  setAddMenuOpen(false);
                  if (folderPath) void addPart(section.id, folderPath);
                }}
              >
                {section.label}
              </button>
            ))}
          </div>,
          document.body,
        )}

      {/* Context menu — portaled and measured: opens on the preferred side of
          the pointer, flipping when it would leave the window. */}
      {contextMenu &&
        createPortal(
          <div
            className="library-menu library-context-menu"
            role="menu"
            aria-label={
              contextMenu.kind === "category"
                ? "Category actions"
                : contextMenu.kind === "sub"
                  ? "Sub-category actions"
                  : "Part actions"
            }
            ref={contextMenuRef}
            style={{
              left: contextMenuPos?.left ?? contextMenu.x,
              top: contextMenuPos?.top ?? contextMenu.y,
              visibility: contextMenuPos ? "visible" : "hidden",
            }}
          >
            {contextMenu.kind === "category" && (
              <>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    const { section, folderPath } = contextMenu;
                    setContextMenu(null);
                    void addPart(section, folderPath);
                  }}
                >
                  New part
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => {
                    const { section, folderPath } = contextMenu;
                    setContextMenu(null);
                    void addSubCategory(section, folderPath);
                  }}
                >
                  New sub-category
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item"
                  role="menuitem"
                  disabled={!itemClipboard}
                  title={itemClipboard ? `Paste “${itemClipboard.name}”` : "Nothing copied yet"}
                  onClick={() => void pasteInto(contextMenu.section, contextMenu.folderPath)}
                >
                  Paste
                </button>
              </>
            )}

            {contextMenu.kind === "sub" && (
              <>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    const { section, folderPath } = contextMenu;
                    setContextMenu(null);
                    void addPart(section, folderPath);
                  }}
                >
                  New part
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => {
                    const { section, folderPath } = contextMenu;
                    setContextMenu(null);
                    void addSubCategory(section, folderPath);
                  }}
                >
                  New sub-category
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => {
                    const { folderPath, name } = contextMenu;
                    setContextMenu(null);
                    setDetailsFor({ kind: "sub", path: folderPath, name });
                  }}
                >
                  Icon & details…
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => {
                    const { folderPath, parentPath, name } = contextMenu;
                    setContextMenu(null);
                    startRename(parentPath, folderPath, name, true);
                  }}
                >
                  Rename
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item"
                  role="menuitem"
                  disabled={!itemClipboard}
                  title={itemClipboard ? `Paste “${itemClipboard.name}”` : "Nothing copied yet"}
                  onClick={() => void pasteInto(contextMenu.section, contextMenu.folderPath)}
                >
                  Paste
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item danger"
                  role="menuitem"
                  onClick={() => {
                    const { folderPath, parentPath, name } = contextMenu;
                    void requestDeleteSub(folderPath, parentPath, name);
                  }}
                >
                  Delete
                </button>
              </>
            )}

            {contextMenu.kind === "part" && (
              <>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    const { path } = contextMenu;
                    setContextMenu(null);
                    void openFsPath(path);
                  }}
                >
                  Open
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => {
                    const { parentPath, path, name } = contextMenu;
                    setContextMenu(null);
                    startRename(parentPath, path, name, false);
                  }}
                >
                  Rename
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => copyPart(contextMenu.name, contextMenu.parentPath)}
                >
                  Copy
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  disabled={!itemClipboard}
                  title={itemClipboard ? `Paste “${itemClipboard.name}”` : "Nothing copied yet"}
                  onClick={() => void pasteInto(contextMenu.section, contextMenu.parentPath)}
                >
                  Paste
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() =>
                    void duplicatePart(contextMenu.section, contextMenu.parentPath, contextMenu.name)
                  }
                >
                  Duplicate
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item danger"
                  role="menuitem"
                  onClick={() => void performDelete(contextMenu.path, contextMenu.parentPath)}
                >
                  Delete
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* Sub-category / library details (stored in <library_name>.ehdlib.json) */}
      {detailsFor?.kind === "sub" &&
        libPath &&
        meta && (
          <SubDetailsDialog
            name={detailsFor.name}
            initial={subMeta(detailsFor.path) ?? {}}
            onSave={(patch) => saveSubDetails(detailsFor.path, patch)}
            onClose={() => setDetailsFor(null)}
          />
        )}

      {detailsFor?.kind === "library" && selected && (
        <LibraryDetailsDialog
          name={selected.name || "(unnamed)"}
          metaFile={metaFileName}
          initial={meta ?? emptyLibraryMeta(selected.name)}
          onSave={saveLibraryDetails}
          onClose={() => setDetailsFor(null)}
        />
      )}

      {/* Component-database check: every component file parsed, spec problems listed */}
      {checkResult && (
        <PanelDialog
          wide
          title={`Library check — ${selected?.name || "library"}`}
          onClose={() => setCheckResult(null)}
          actions={
            <button className="btn" onClick={() => setCheckResult(null)}>
              Close
            </button>
          }
        >
          <p className="panel-dialog-text">
            {checkResult.componentCount} component
            {checkResult.componentCount === 1 ? "" : "s"} parsed from {checkResult.fileCount} file
            {checkResult.fileCount === 1 ? "" : "s"} ·{" "}
            {checkResult.issues.filter((issue) => issue.severity === "error").length} error
            {checkResult.issues.filter((issue) => issue.severity === "error").length === 1 ? "" : "s"}
            ,{" "}
            {checkResult.issues.filter((issue) => issue.severity === "warning").length} warning
            {checkResult.issues.filter((issue) => issue.severity === "warning").length === 1 ? "" : "s"}
          </p>
          {checkResult.issues.length === 0 ? (
            <p className="part-ok">No problems found — the library matches the component spec.</p>
          ) : (
            <ul className="library-check-list">
              {checkResult.issues.map((issue, index) => (
                <li key={`${issue.file}-${issue.message}-${index}`} className={issue.severity}>
                  <span className="library-check-file">{issue.file}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </PanelDialog>
      )}

      {/* IPC footprint wizard — the library manager's way to add a footprint */}
      {footprintWizard && libPath && (
        <FootprintWizard
          libraryPath={libPath}
          onClose={() => setFootprintWizard(false)}
          onCreated={(path) => {
            setFootprintWizard(false);
            setRefresh((r) => r + 1);
            void openFsPath(path);
          }}
        />
      )}

      {/* Confirmation before deleting a sub-category that holds parts */}
      {confirmState && (
        <PanelDialog
          title={confirmState.title}
          onClose={() => setConfirmState(null)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirmState(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmState.onConfirm}>
                {confirmState.confirmLabel}
              </button>
            </>
          }
        >
          <p className="panel-dialog-text">{confirmState.message}</p>
          <p className="panel-dialog-text panel-dialog-muted">
            Part files inside the folder are deleted with it; this cannot be undone from EHDL.
          </p>
        </PanelDialog>
      )}
    </div>
  );
}
