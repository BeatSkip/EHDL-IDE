import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  loadLibraries,
  subscribeLibraries,
  loadLibraryItems,
  saveLibraryItems,
  libraryItemMapFor,
  emptyLibraryItemMap,
} from "../settings";
import type {
  LibraryEntry,
  LibraryItem,
  LibraryItemMap,
  LibraryItems,
  LibrarySectionId,
} from "../settings";
import { inTauri, openInFileManager } from "../fs";
import { usePopupPosition } from "../popupPosition";
import type { PopupAnchor } from "../popupPosition";

/** The four content sections every library exposes. */
const SECTIONS: { id: LibrarySectionId; label: string }[] = [
  { id: "components", label: "Components" },
  { id: "symbols", label: "Symbols" },
  { id: "footprints", label: "Footprints" },
  { id: "board-snippets", label: "Board Snippets" },
];

/** Name given to a freshly created item (renamed inline right away). */
const DEFAULT_ITEM_NAMES: Record<LibrarySectionId, string> = {
  components: "new_component",
  symbols: "new_symbol",
  footprints: "new_footprint",
  "board-snippets": "new_board_snippet",
};

/**
 * Session clipboard for library items. Kept outside the component so a copied
 * item can be pasted after switching library — or after the panel was closed
 * and reopened from the activity bar.
 */
let itemClipboard: { name: string; section: LibrarySectionId } | null = null;

/** A name that is free in `existing` (appends _copy, _copy2, … when taken). */
function uniqueItemName(base: string, existing: LibraryItem[]): string {
  const taken = new Set(existing.map((item) => item.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let index = 1;
  let candidate = `${base}_copy`;
  while (taken.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${base}_copy${index}`;
  }
  return candidate;
}

type ContextMenuState =
  | { kind: "item"; section: LibrarySectionId; id: string; x: number; y: number }
  | { kind: "section"; section: LibrarySectionId; x: number; y: number };

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M1.5 4.5h4.2l1.6 2h7.2v7H1.5z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14" />
    </svg>
  );
}

/**
 * Library manager sidebar panel. A dropdown picks one of the libraries
 * configured in Settings → Library; next to it the "+" button creates a new
 * item (component, symbol, footprint or board snippet) and the folder button
 * reveals the library folder in the OS file manager. Below, the library's four
 * sections list their items.
 */
export function LibraryView() {
  const [libraries, setLibraries] = useState<LibraryEntry[]>(() => loadLibraries());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItems>(() => loadLibraryItems());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((section) => [section.id, true])),
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addAnchor, setAddAnchor] = useState<PopupAnchor | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedItem, setSelectedItem] = useState<{
    section: LibrarySectionId;
    id: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<{
    section: LibrarySectionId;
    id: string;
    draft: string;
  } | null>(null);

  const addWrapRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Both menus measure themselves and flip when the sidebar is too narrow.
  const addMenuPos = usePopupPosition(addMenuOpen, addAnchor, addMenuRef);
  const contextMenuPos = usePopupPosition(
    contextMenu !== null,
    contextMenu ? { x: contextMenu.x, y: contextMenu.y, align: "left" } : null,
    contextMenuRef,
  );

  // Stay in sync when libraries are added/removed/renamed in the Settings modal.
  useEffect(() => subscribeLibraries(setLibraries), []);

  // Keep the selection valid: follow the first library until one is chosen.
  useEffect(() => {
    setSelectedId((current) => {
      if (current && libraries.some((lib) => lib.id === current)) return current;
      return libraries.length > 0 ? libraries[0].id : null;
    });
  }, [libraries]);

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

  const selected = libraries.find((lib) => lib.id === selectedId) ?? null;
  const sectionItems: LibraryItemMap = selectedId
    ? libraryItemMapFor(items, selectedId)
    : emptyLibraryItemMap();

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

  // While filtering, open every section so the matches are visible.
  useEffect(() => {
    if (!isFiltering) return;
    setOpenSections(Object.fromEntries(SECTIONS.map((section) => [section.id, true])));
  }, [isFiltering, query]);

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
    setSelectedItem(null);
    setRenaming(null);
    setAddMenuOpen(false);
    setContextMenu(null);
    setQuery("");
  };

  /** Replace one section's list of the selected library. */
  const writeSection = (section: LibrarySectionId, next: LibraryItem[]) => {
    if (!selectedId) return;
    const map = libraryItemMapFor(items, selectedId);
    setItems(saveLibraryItems({ ...items, [selectedId]: { ...map, [section]: next } }));
  };

  /** Create an item in the chosen section and start renaming it. */
  const addItem = (section: LibrarySectionId) => {
    if (!selectedId) return;
    const item: LibraryItem = { id: crypto.randomUUID(), name: DEFAULT_ITEM_NAMES[section] };
    writeSection(section, [...sectionItems[section], item]);
    setOpenSections((current) => ({ ...current, [section]: true }));
    setAddMenuOpen(false);
    setRenaming({ section, id: item.id, draft: item.name });
  };

  const startRename = (section: LibrarySectionId, item: LibraryItem) =>
    setRenaming({ section, id: item.id, draft: item.name });

  const commitRename = () => {
    if (!renaming) return;
    const { section, id, draft } = renaming;
    setRenaming(null);
    const name = draft.trim();
    if (!name) return; // empty name keeps the previous one
    writeSection(
      section,
      sectionItems[section].map((item) => (item.id === id ? { ...item, name } : item)),
    );
  };

  const onRenameKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setRenaming(null);
    }
  };

  // Close the item context menu on outside click, Esc, resize or window blur.
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

  /** Right-click on an item: select it and open its action menu. */
  const openContextMenu = (e: ReactMouseEvent, section: LibrarySectionId, id: string) => {
    e.preventDefault();
    e.stopPropagation(); // don't also open the section menu
    setAddMenuOpen(false);
    setSelectedItem({ section, id });
    setContextMenu({ kind: "item", section, id, x: e.clientX, y: e.clientY });
  };

  /** Right-click on a section (header, empty area): paste into that section. */
  const openSectionContextMenu = (e: ReactMouseEvent, section: LibrarySectionId) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // renaming: native menu
    e.preventDefault();
    setAddMenuOpen(false);
    setContextMenu({ kind: "section", section, x: e.clientX, y: e.clientY });
  };

  /** Copy an item onto the session clipboard (paste works across libraries). */
  const copyItem = (section: LibrarySectionId, id: string) => {
    const item = sectionItems[section].find((entry) => entry.id === id);
    if (!item) return;
    itemClipboard = { name: item.name, section };
    setContextMenu(null);
  };

  /** Paste the clipboard item into a section (name is made unique). */
  const pasteItem = (section: LibrarySectionId, afterId?: string) => {
    if (!itemClipboard || !selectedId) return;
    const list = sectionItems[section];
    const pasted: LibraryItem = {
      id: crypto.randomUUID(),
      name: uniqueItemName(itemClipboard.name, list),
    };
    const index = afterId ? list.findIndex((item) => item.id === afterId) : -1;
    writeSection(
      section,
      index >= 0
        ? [...list.slice(0, index + 1), pasted, ...list.slice(index + 1)]
        : [...list, pasted],
    );
    setContextMenu(null);
    setOpenSections((current) => ({ ...current, [section]: true }));
    setRenaming({ section, id: pasted.id, draft: pasted.name });
  };

  /** Duplicate an item in place: the copy lands right below it. */
  const duplicateItem = (section: LibrarySectionId, id: string) => {
    const list = sectionItems[section];
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const copy: LibraryItem = {
      id: crypto.randomUUID(),
      name: uniqueItemName(list[index].name, list),
    };
    writeSection(section, [...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
    setContextMenu(null);
    setOpenSections((current) => ({ ...current, [section]: true }));
    setRenaming({ section, id: copy.id, draft: copy.name });
  };

  /** Delete an item from its section. */
  const deleteItem = (section: LibrarySectionId, id: string) => {
    writeSection(section, sectionItems[section].filter((item) => item.id !== id));
    setRenaming((current) => (current && current.id === id ? null : current));
    setSelectedItem((current) => (current && current.id === id ? null : current));
    setContextMenu(null);
  };

  const openLibraryFolder = async () => {
    if (!selected?.path) return;
    try {
      await openInFileManager(selected.path);
    } catch (error) {
      console.error("Failed to open library folder:", error);
    }
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
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id} title={lib.path || "no folder set"}>
                    {lib.name || "(unnamed)"}
                  </option>
                ))}
              </select>

              <div className="library-add-wrap" ref={addWrapRef}>
                <button
                  className="library-icon-btn"
                  title="Add new…"
                  aria-label="Add new"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  disabled={!selectedId}
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
                    : selected?.path
                      ? `Open ${selected.path} in Explorer`
                      : "This library has no folder set"
                }
                aria-label="Open library folder"
                disabled={!selected?.path || !inTauri}
                onClick={() => void openLibraryFolder()}
              >
                <FolderIcon />
              </button>

              <button
                className={`library-icon-btn ${searchOpen ? "active" : ""}`}
                title={searchOpen ? "Hide the search bar" : "Search this library"}
                aria-label="Search library"
                aria-pressed={searchOpen}
                disabled={!selectedId}
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              >
                <SearchIcon />
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
                  title="Matches items containing any of the comma-separated terms"
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
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      fill="none"
                    />
                  </svg>
                </button>
              </div>
            )}

            <div className="library-sections">
              {SECTIONS.map((section) => {
                const list = sectionItems[section.id];
                const visible = isFiltering ? list.filter((item) => matchesQuery(item.name)) : list;
                const open = openSections[section.id];
                const badge = isFiltering ? `${visible.length}/${list.length}` : `${list.length}`;
                return (
                  <section
                    className="library-section"
                    key={section.id}
                    onContextMenu={(e) => openSectionContextMenu(e, section.id)}
                  >
                    <button
                      className="library-section-head"
                      aria-expanded={open}
                      title={open ? `Collapse ${section.label}` : `Expand ${section.label}`}
                      onClick={() => setOpenSections((cur) => ({ ...cur, [section.id]: !cur[section.id] }))}
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
                      (visible.length === 0 ? (
                        <div className="library-section-empty">
                          {list.length === 0
                            ? `No ${section.label.toLowerCase()} yet.`
                            : "No matches."}
                        </div>
                      ) : (
                        <ul className="library-section-items">
                          {visible.map((item) => {
                            const isSelected =
                              selectedItem?.section === section.id && selectedItem.id === item.id;
                            return renaming && renaming.id === item.id ? (
                              <li
                                className={`library-item ${isSelected ? "selected" : ""}`}
                                key={item.id}
                              >
                                <input
                                  className="settings-input library-item-input"
                                  type="text"
                                  autoFocus
                                  aria-label={`Rename ${section.label.slice(0, -1).toLowerCase()}`}
                                  value={renaming.draft}
                                  onChange={(e) =>
                                    setRenaming((cur) =>
                                      cur ? { ...cur, draft: e.target.value } : cur,
                                    )
                                  }
                                  onKeyDown={onRenameKey}
                                  onBlur={commitRename}
                                />
                              </li>
                            ) : (
                              <li
                                className={`library-item ${isSelected ? "selected" : ""}`}
                                key={item.id}
                                title={`${item.name} — right-click for options`}
                                onClick={() => setSelectedItem({ section: section.id, id: item.id })}
                                onContextMenu={(e) => openContextMenu(e, section.id, item.id)}
                              >
                                {item.name}
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                  </section>
                );
              })}
            </div>
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
            <div className="library-menu-title">Create new</div>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                className="library-menu-item"
                role="menuitem"
                onClick={() => addItem(section.id)}
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
            aria-label={contextMenu.kind === "item" ? "Item actions" : "Section actions"}
            ref={contextMenuRef}
            style={{
              left: contextMenuPos?.left ?? contextMenu.x,
              top: contextMenuPos?.top ?? contextMenu.y,
              visibility: contextMenuPos ? "visible" : "hidden",
            }}
          >
            {contextMenu.kind === "item" ? (
              <>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    const { section, id } = contextMenu;
                    const item = sectionItems[section].find((entry) => entry.id === id);
                    setContextMenu(null);
                    if (item) startRename(section, item);
                  }}
                >
                  Rename
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => copyItem(contextMenu.section, contextMenu.id)}
                >
                  Copy
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  disabled={!itemClipboard}
                  title={itemClipboard ? `Paste “${itemClipboard.name}”` : "Nothing copied yet"}
                  onClick={() => pasteItem(contextMenu.section, contextMenu.id)}
                >
                  Paste
                </button>
                <button
                  className="library-menu-item"
                  role="menuitem"
                  onClick={() => duplicateItem(contextMenu.section, contextMenu.id)}
                >
                  Duplicate
                </button>
                <div className="library-menu-sep" role="separator" />
                <button
                  className="library-menu-item danger"
                  role="menuitem"
                  onClick={() => deleteItem(contextMenu.section, contextMenu.id)}
                >
                  Delete
                </button>
              </>
            ) : (
              <button
                className="library-menu-item"
                role="menuitem"
                autoFocus
                disabled={!itemClipboard}
                title={itemClipboard ? `Paste “${itemClipboard.name}”` : "Nothing copied yet"}
                onClick={() => pasteItem(contextMenu.section)}
              >
                Paste
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
