import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Actions,
  BorderNode,
  DockLocation,
  IJsonModel,
  Layout,
  Model,
  Node,
  TabNode,
  TabSetNode,
} from "flexlayout-react";
import { defaultFileId, projectTree } from "./data";
import { baseName, docIdForPath, docName, docPath, initialContent, isRealDoc, registerRealDoc } from "./documents";
import { inTauri, openFolder, readFileText, writeFileText } from "./fs";
import { getEditorText, setEditorText } from "./editorState";
import { getEditor } from "./editors";
import { ProjectTree } from "./components/ProjectTree";
import { FileExplorer } from "./components/FileExplorer";
import { CodeEditor } from "./components/CodeEditor";
import { SchematicView } from "./components/SchematicView";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { MenuBar } from "./components/MenuBar";
import { WindowControls } from "./components/WindowControls";
import { ActivityBar } from "./components/ActivityBar";
import type { ActivityId } from "./components/ActivityBar";
import { LibraryView } from "./components/LibraryView";
import { CreateView } from "./components/CreateView";
import { SettingsModal } from "./components/SettingsModal";
import type { Menu } from "./components/MenuBar";
import { AppContext } from "./appContext";
import type { AppState, ProjectState } from "./appContext";

// ---- panel components ----

/** Sidebar (dock tab) title for each activity-bar view. */
const ACTIVITY_TITLES: Record<ActivityId, string> = {
  explorer: "Project Explorer",
  library: "Library Manager",
  create: "Create",
  settings: "Settings",
};

/** Remembers each file's editor/schematic divider position (percent). */
const schematicSplitRatios = new Map<string, number>();

/** The left dock: switches its content based on the activity bar.
 *  (Settings no longer lives here — it opens as a modal instead.) */
function SidebarPanel() {
  const { project, activeFileId, openFile, openFsPath, activity } = useContext(AppContext);

  if (activity === "library") return <LibraryView />;
  if (activity === "create") return <CreateView />;

  if (project.kind === "folder") {
    return (
      <FileExplorer
        rootPath={project.rootPath}
        rootName={project.rootName}
        onOpenFile={(path) => void openFsPath(path)}
      />
    );
  }
  return <ProjectTree nodes={projectTree} activeId={activeFileId} onSelect={openFile} />;
}

function PropertiesTab() {
  const { activeFileId } = useContext(AppContext);
  return (
    <PropertiesPanel file={{ id: activeFileId, name: docName(activeFileId), content: "" }} />
  );
}

/**
 * One editor document. Hosts Monaco; when the inline schematic is enabled for
 * this file the editor is split along the center with a draggable divider and
 * the schematic pane on the right.
 */
function EditorPane({ fileId }: { fileId?: string }) {
  const id = fileId ?? defaultFileId;
  const { inlineSchematicFileId, saveFile } = useContext(AppContext);
  const file = { id, name: docName(id), content: initialContent(id) };
  const showSchematic = inlineSchematicFileId === id;

  const hostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [pct, setPct] = useState(() => schematicSplitRatios.get(id) ?? 50);

  const clamp = (v: number) => Math.min(80, Math.max(20, v));

  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDividerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const next = clamp(((e.clientX - rect.left) / rect.width) * 100);
    setPct(next);
    schematicSplitRatios.set(id, next);
  };

  const onDividerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="editor-pane" ref={hostRef}>
      <div className="editor-pane-main" style={{ width: showSchematic ? `${pct}%` : "100%" }}>
        <CodeEditor file={file} onSave={isRealDoc(id) ? () => void saveFile(id) : undefined} />
      </div>
      {showSchematic && (
        <>
          <div
            className="editor-pane-divider"
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
          />
          <div className="editor-pane-schematic">
            <SchematicView file={file} />
          </div>
        </>
      )}
    </div>
  );
}

const factory = (node: TabNode) => {
  switch (node.getComponent()) {
    case "project":
      return <SidebarPanel />;
    case "editor":
      return <EditorPane fileId={node.getConfig()?.fileId} />;
    case "properties":
      return <PropertiesTab />;
    default:
      return null;
  }
};

// ---- model ----

const DEFAULT_JSON: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableMaximize: false,
    tabEnablePopoutIcon: false,
  },
  borders: [],
  layout: {
    type: "row",
    children: [
      {
        type: "tabset",
        id: "project-tabset",
        weight: 18,
        children: [{ id: "project-tab", type: "tab", component: "project", name: "Project" }],
      },
      {
        type: "tabset",
        id: "editor-tabset",
        weight: 100,
        children: [
          {
            id: "editor-top",
            type: "tab",
            component: "editor",
            name: "top.vhd",
            enableClose: true,
            config: { fileId: "top" },
          },
        ],
      },
      {
        type: "tabset",
        id: "properties-tabset",
        weight: 18,
        children: [{ id: "properties-tab", type: "tab", component: "properties", name: "Properties" }],
      },
    ],
  },
};

// ---- toolbar icons ----

function IconSchematicSplit() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="currentColor" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeDasharray="2 1.5" />
      <rect x="10" y="9" width="2.5" height="2.5" fill="currentColor" />
    </svg>
  );
}

function IconSplitLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="5" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="5" height="11" rx="1" fill="none" stroke="currentColor" />
    </svg>
  );
}

function IconSplitRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="5" height="11" rx="1" fill="none" stroke="currentColor" />
      <rect x="9.5" y="2.5" width="5" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

function IconMoveLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.5 3.5 5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconMoveRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 3.5 11 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export default function App() {
  const [activeFileId, setActiveFileId] = useState(defaultFileId);
  const [inlineSchematicFileId, setInlineSchematicFileId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectState>({ kind: "sample" });
  const [activity, setActivity] = useState<ActivityId>("explorer");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const model = useMemo(() => Model.fromJson(DEFAULT_JSON), []);

  const activeEditorTsRef = useRef<string>("editor-tabset");

  // Keep the left dock's tab label in sync with the active activity view.
  useEffect(() => {
    const name = ACTIVITY_TITLES[activity];
    if (model.getNodeById("project-tab")) {
      model.doAction(Actions.updateNodeAttributes("project-tab", { name }));
    }
  }, [activity, model]);

  /** Find the open editor tab for a document id (in any editor group). */
  const findOpenFileTab = (m: Model, fileId: string): TabNode | undefined => {
    let found: TabNode | undefined;
    m.visitNodes((node: Node) => {
      if (!found && node.getType() === "tab") {
        const t = node as TabNode;
        if (t.getComponent() === "editor" && t.getConfig()?.fileId === fileId) found = t;
      }
    });
    return found;
  };

  /** Open (or focus) an already-registered document as a tab. */
  const openFile = (id: string) => {
    setActiveFileId(id);
    const existing = findOpenFileTab(model, id);
    if (existing) {
      model.doAction(Actions.selectTab(existing.getId()));
      return;
    }

    const targetId = model.getNodeById(activeEditorTsRef.current) ? activeEditorTsRef.current : "editor-tabset";
    model.doAction(
      Actions.addTab(
        {
          id: `editor-${id}`,
          type: "tab",
          component: "editor",
          name: docName(id),
          enableClose: true,
          config: { fileId: id },
        },
        targetId,
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    activeEditorTsRef.current = targetId;
  };

  /** Read a real file from disk, register it, and open it in the editor. */
  const openFsPath = async (path: string) => {
    const id = docIdForPath(path);
    try {
      const existing = findOpenFileTab(model, id);
      if (existing) {
        openFile(id);
        return;
      }
      const content = await readFileText(path);
      registerRealDoc(id, { name: baseName(path), path });
      setEditorText(id, content);
      openFile(id);
    } catch (error) {
      console.error("Failed to open file:", path, error);
    }
  };

  /** Write the current editor text of a real document back to disk. */
  const saveFile = async (id: string) => {
    const path = docPath(id);
    if (!path) return;
    const text = getEditorText(id, "");
    try {
      await writeFileText(path, text);
    } catch (error) {
      console.error("Failed to save file:", path, error);
    }
  };

  const openFolderProject = async () => {
    if (!inTauri) return;
    const path = await openFolder();
    if (path) {
      setProject({ kind: "folder", rootPath: path, rootName: baseName(path) });
    }
  };

  /** Activity bar click: the gear toggles the Settings modal, the other
   *  buttons switch the sidebar view (and close the modal if it is open). */
  const handleActivitySelect = (id: ActivityId) => {
    if (id === "settings") {
      setSettingsOpen((open) => !open);
      return;
    }
    setSettingsOpen(false);
    setActivity(id);
  };

  /** Split the active editor group: active document moves to the new group. */
  const splitAndMoveEditor = (tabSetNode: TabSetNode, side: "left" | "right") => {
    const selected = tabSetNode.getSelectedNode();
    if (!selected) return;

    // Move the existing tab (name/config/content intact) to a new group on the
    // chosen side — flexlayout's drop creates the sibling tab set. If the source
    // group is left empty it is removed automatically.
    model.doAction(
      Actions.moveNode(
        selected.getId(),
        tabSetNode.getId(),
        side === "right" ? DockLocation.RIGHT : DockLocation.LEFT,
        -1,
        true,
      ),
    );

    // Track the moved tab's new group as the active editor group.
    const moved = model.getNodeById(selected.getId());
    const parent = moved?.getParent();
    if (parent && parent.getType() === "tabset") {
      activeEditorTsRef.current = parent.getId();
    }
  };

  const toggleInlineSchematic = (fileId: string) => {
    setInlineSchematicFileId((current) => (current === fileId ? null : fileId));
  };

  const appState: AppState = useMemo(
    () => ({
      activeFileId,
      project,
      activity,
      setActivity,
      openFolderProject,
      openFile,
      openFsPath,
      saveFile,
      inlineSchematicFileId,
      toggleInlineSchematic,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFileId, project, activity, inlineSchematicFileId, openFile, openFsPath, saveFile, openFolderProject, toggleInlineSchematic],
  );

  // Keep active-file + active editor group in sync (tab clicks, splits...).
  const handleModelChange = (m: Model) => {
    let activeFile: string | undefined;
    m.visitNodes((node: Node) => {
      if (node.getType() === "tab") {
        const t = node as TabNode;
        if (t.getComponent() === "editor" && t.isSelected()) {
          activeFile = t.getConfig()?.fileId ?? activeFile;
          const parent = t.getParent();
          if (parent) activeEditorTsRef.current = parent.getId();
        }
      }
    });
    if (activeFile) setActiveFileId(activeFile);
  };

  // True for every editor tab set — including ones created by splitting/moving,
  // which flexlayout names with random ids (not "editor-...").
  const isEditorTabSet = (ts: TabSetNode): boolean => {
    if (ts.getId().startsWith("editor")) return true;
    const hasEditorTab = ts
      .getChildren()
      .some((child) => child.getType() === "tab" && (child as TabNode).getComponent() === "editor");
    return hasEditorTab;
  };

  /** Editor groups ordered left→right by geometry (for "move to group"). */
  const editorGroupsInOrder = (): TabSetNode[] => {
    const groups: TabSetNode[] = [];
    model.visitNodes((node) => {
      if (node instanceof TabSetNode && isEditorTabSet(node)) groups.push(node);
    });
    groups.sort((a, b) => a.getRect().x - b.getRect().x);
    return groups;
  };

  /** Move the active document into the neighbouring editor group (no DnD). */
  const moveToAdjacentGroup = (tabSetNode: TabSetNode, delta: -1 | 1) => {
    const selected = tabSetNode.getSelectedNode();
    if (!selected) return;
    const groups = editorGroupsInOrder();
    const idx = groups.findIndex((g) => g.getId() === tabSetNode.getId());
    const target = groups[idx + delta];
    if (!target) return;

    model.doAction(Actions.moveNode(selected.getId(), target.getId(), DockLocation.CENTER, -1, true));

    const moved = model.getNodeById(selected.getId());
    const parent = moved?.getParent();
    if (parent && parent.getType() === "tabset") activeEditorTsRef.current = parent.getId();
  };

  // Three-button editor toolbar (replaces flexlayout's maximize button).
  const onRenderTabSet = (
    tabSetNode: TabSetNode | BorderNode,
    renderValues: { buttons: ReactNode[] },
  ) => {
    if (!(tabSetNode instanceof TabSetNode) || !isEditorTabSet(tabSetNode)) return;
    const ts = tabSetNode;
    const groupFileId = ts.getSelectedNode()?.getConfig()?.fileId as string | undefined;
    const canAct = groupFileId !== undefined;

    const groups = editorGroupsInOrder();
    const idx = groups.findIndex((g) => g.getId() === ts.getId());
    const hasLeftGroup = idx > 0;
    const hasRightGroup = idx >= 0 && idx < groups.length - 1;

    renderValues.buttons.push(
      <button
        key="inline-schematic"
        className="flexlayout__tab_toolbar_button editor-tool-button"
        title="Toggle schematic pane (split editor along the center)"
        aria-label="Toggle schematic pane"
        disabled={!canAct}
        onClick={() => groupFileId && toggleInlineSchematic(groupFileId)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconSchematicSplit />
      </button>,
      <button
        key="split-left"
        className="flexlayout__tab_toolbar_button editor-tool-button"
        title="Split editor group, move document to the left"
        aria-label="Split editor left"
        disabled={!canAct}
        onClick={() => splitAndMoveEditor(ts, "left")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconSplitLeft />
      </button>,
      <button
        key="split-right"
        className="flexlayout__tab_toolbar_button editor-tool-button"
        title="Split editor group, move document to the right"
        aria-label="Split editor right"
        disabled={!canAct}
        onClick={() => splitAndMoveEditor(ts, "right")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconSplitRight />
      </button>,
      <button
        key="move-left"
        className="flexlayout__tab_toolbar_button editor-tool-button editor-move-button"
        title="Move document to the editor group on the left"
        aria-label="Move document to the left group"
        disabled={!canAct || !hasLeftGroup}
        onClick={() => moveToAdjacentGroup(ts, -1)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconMoveLeft />
      </button>,
      <button
        key="move-right"
        className="flexlayout__tab_toolbar_button editor-tool-button editor-move-button"
        title="Move document to the editor group on the right"
        aria-label="Move document to the right group"
        disabled={!canAct || !hasRightGroup}
        onClick={() => moveToAdjacentGroup(ts, 1)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconMoveRight />
      </button>,
    );
  };

  // ---- menu bar ----

  const runEditorCommand = (command: string) => {
    getEditor(activeFileId)?.trigger("ehdl-menu", command, null);
  };

  const handleMenuAction = (id: string) => {
    switch (id) {
      case "open-folder":
        void openFolderProject();
        break;
      case "save":
        void saveFile(activeFileId);
        break;
      case "exit":
        window.close();
        break;
      case "edit-undo":
        runEditorCommand("undo");
        break;
      case "edit-redo":
        runEditorCommand("redo");
        break;
      case "edit-cut":
        runEditorCommand("cut");
        break;
      case "edit-copy":
        runEditorCommand("copy");
        break;
      case "edit-paste":
        runEditorCommand("paste");
        break;
      case "view-schematic":
        toggleInlineSchematic(activeFileId);
        break;
    }
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { id: "open-folder", label: "Open Folder…", disabled: !inTauri },
        { id: "f-sep-1", label: "", separator: true },
        { id: "save", label: "Save", shortcut: "Ctrl+S", disabled: !isRealDoc(activeFileId) },
        { id: "save-as", label: "Save As…", disabled: true },
        { id: "f-sep-2", label: "", separator: true },
        { id: "exit", label: "Exit" },
      ],
    },
    {
      label: "Edit",
      items: [
        { id: "edit-undo", label: "Undo", shortcut: "Ctrl+Z" },
        { id: "edit-redo", label: "Redo", shortcut: "Ctrl+Y" },
        { id: "e-sep-1", label: "", separator: true },
        { id: "edit-cut", label: "Cut", shortcut: "Ctrl+X" },
        { id: "edit-copy", label: "Copy", shortcut: "Ctrl+C" },
        { id: "edit-paste", label: "Paste", shortcut: "Ctrl+V" },
      ],
    },
    {
      label: "View",
      items: [
        { id: "view-schematic", label: "Toggle Schematic Pane" },
        { id: "v-sep-1", label: "", separator: true },
        { id: "theme-dark", label: "Theme: Dark (VS Code)", disabled: true },
      ],
    },
    {
      label: "Help",
      items: [{ id: "help-about", label: "About EHDL", disabled: true }],
    },
  ];

  // Drag the window by the title bar (except on interactive elements).
  // Uses a native mousedown listener: Tauri's drag must be started from a
  // real (not synthetic) mouse-down. A fast second click = maximize/restore.
  const titlebarRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    const el = titlebarRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select, .menu-popup")) return;
      try {
        const win = getCurrentWindow();
        if (e.detail >= 2) {
          void win.toggleMaximize();
        } else {
          void win.startDragging();
        }
      } catch (err) {
        console.error("window action failed", err);
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    return () => el.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div className="app">
      <header className="titlebar" ref={titlebarRef}>
        <div className="titlebar-left">
          <span className="ehdl-logo" aria-hidden="true">
            E
          </span>
          <MenuBar menus={menus} onSelect={handleMenuAction} />
        </div>
        <div className="titlebar-center">
          <span className="title">EHDL — ECAD using HDL</span>
        </div>
        <div className="titlebar-right">
          <span className="titlebar-file">{docName(activeFileId)}</span>
          {inTauri && <WindowControls />}
        </div>
      </header>

      <div className="app-body">
        <ActivityBar active={settingsOpen ? "settings" : activity} onSelect={handleActivitySelect} />

        <AppContext.Provider value={appState}>
          <div className="dock-host">
            <Layout
              model={model}
              factory={factory}
              onModelChange={handleModelChange}
              onRenderTabSet={onRenderTabSet}
            />
          </div>
        </AppContext.Provider>
      </div>

      <footer className="statusbar">
        <span className="status-item status-project">
          {project.kind === "folder" ? project.rootName : "example_project"}
        </span>
        <span className="status-spacer" />
        <span className="status-item">{docName(activeFileId)}</span>
        <span className="status-item">VHDL</span>
        <span className="status-item">Ready</span>
      </footer>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
