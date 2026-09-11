import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  loadSettings,
  saveSettings,
  loadLibraries,
  saveLibraries,
  loadServices,
  saveServices,
} from "../settings";
import type { AppSettings, LibraryEntry, ServiceAccount } from "../settings";
import { inTauri, openFolder } from "../fs";
import { usePopupPosition } from "../popupPosition";
import type { PopupAnchor } from "../popupPosition";

type SettingsCategory = "general" | "library" | "shortcuts" | "services";

const FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18];

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "library", label: "Library" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
  { id: "services", label: "Services" },
];

/** One settings row: label + description on the left, control on the right. */
function Row({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.5 4.5h4.2l1.6 2h7.2v7H1.5z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Inline-edit grid — the Windows environment-variable-style table used by the
// Library category: rows are selected, then edited inline with the Add / Edit
// / Delete button column (Enter commits, Esc cancels). Services use a
// read-only table with a dialog instead — see servicesPane below.
// ---------------------------------------------------------------------------

interface GridColumn<T> {
  label: string;
  /** Fixed column width in px; omitted columns share the remaining space. */
  width?: number;
  /** Read-only cell content. */
  render: (row: T) => ReactNode;
  /** Editing cell content (draft value + patch + key handler). */
  edit: (
    draft: T,
    patch: (patch: Partial<T>) => void,
    onKey: (e: ReactKeyboardEvent<HTMLInputElement>) => void,
  ) => ReactNode;
}

function InlineGrid<T extends { id: string }>({
  rows,
  columns,
  emptyText,
  createRow,
  onChange,
}: {
  rows: T[];
  columns: GridColumn<T>[];
  emptyText: string;
  createRow: () => T;
  onChange: (rows: T[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<T | null>(null);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  /** Write the draft of the row being edited back into the list. */
  const commitEditing = () => {
    if (!editingId || !draft) {
      setEditingId(null);
      setDraft(null);
      return;
    }
    const id = editingId;
    const value = draft;
    setEditingId(null);
    setDraft(null);
    onChange(rows.map((row) => (row.id === id ? { ...value, id } : row)));
  };

  const startEditing = (row: T) => {
    if (editingId === row.id) return;
    if (editingId) commitEditing();
    setSelectedId(row.id);
    setDraft({ ...row });
    setEditingId(row.id);
  };

  const selectRow = (id: string) => {
    if (editingId === id) return; // click inside the row being edited
    if (editingId) commitEditing();
    setSelectedId(id);
  };

  const onEditKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEditing();
    } else if (e.key === "Escape") {
      e.stopPropagation(); // keep the Settings dialog open — just cancel the edit
      setEditingId(null);
      setDraft(null);
    }
  };

  const addRow = () => {
    if (editingId) commitEditing();
    const row = createRow();
    onChange([...rows, row]);
    setSelectedId(row.id);
    setDraft({ ...row });
    setEditingId(row.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const id = selectedId;
    if (editingId && editingId !== id) commitEditing();
    else {
      setEditingId(null);
      setDraft(null);
    }
    onChange(rows.filter((row) => row.id !== id));
    setSelectedId(null);
  };

  return (
    <div className="settings-table-editor">
      <div className="settings-tablebox">
        <table className="settings-table">
          <colgroup>
            {columns.map((column, i) => (
              <col key={i} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column.label}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              editingId === row.id && draft ? (
                <tr key={row.id} className="settings-grid-row editing">
                  {columns.map((column, i) => (
                    <td key={i}>
                      {column.edit(
                        draft,
                        (patch) => setDraft((current) => (current ? { ...current, ...patch } : current)),
                        onEditKey,
                      )}
                    </td>
                  ))}
                </tr>
              ) : (
                <tr
                  key={row.id}
                  className={`settings-grid-row ${selectedId === row.id ? "selected" : ""}`}
                  onClick={() => selectRow(row.id)}
                  onDoubleClick={() => startEditing(row)}
                >
                  {columns.map((column, i) => (
                    <td className="settings-table-cell" key={i}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
        {rows.length === 0 && <div className="settings-table-empty">{emptyText}</div>}
      </div>

      <div className="settings-table-actions">
        <button className="btn" onClick={addRow} title="Append a new row">
          Add
        </button>
        <button
          className="btn"
          onClick={() => selected && startEditing(selected)}
          disabled={!selected || editingId !== null}
          title={selected ? "Edit the selected row" : "Select a row first"}
        >
          Edit
        </button>
        <button
          className="btn btn-danger"
          onClick={deleteSelected}
          disabled={!selected}
          title={selected ? "Remove the selected row" : "Select a row first"}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Inline edit input shared by both grids. */
function EditInput({
  value,
  onChange,
  onKey,
  placeholder,
  autoFocus,
  ariaLabel,
  list,
}: {
  value: string;
  onChange: (value: string) => void;
  onKey: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel: string;
  list?: string;
}) {
  return (
    <input
      className="settings-input settings-table-input"
      type="text"
      spellCheck={false}
      autoFocus={autoFocus}
      placeholder={placeholder}
      aria-label={ariaLabel}
      list={list}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts reference
// ---------------------------------------------------------------------------

const SHORTCUT_GROUPS: { title: string; items: { command: string; chords: string[] }[] }[] = [
  {
    title: "Application",
    items: [
      { command: "Save the active file", chords: ["Ctrl+S"] },
      { command: "Close the Settings dialog", chords: ["Esc"] },
      { command: "Close the service add/edit dialog", chords: ["Esc"] },
      { command: "Commit an inline rename or edit", chords: ["Enter"] },
      { command: "Cancel an inline rename or edit", chords: ["Esc"] },
      { command: "Clear the library search (then close it)", chords: ["Esc"] },
      { command: "Maximize / restore the window", chords: ["Double-click title bar"] },
      { command: "Drag the window", chords: ["Drag title bar"] },
    ],
  },
  {
    title: "Code editor",
    items: [
      { command: "Undo", chords: ["Ctrl+Z"] },
      { command: "Redo", chords: ["Ctrl+Y"] },
      { command: "Cut", chords: ["Ctrl+X"] },
      { command: "Copy", chords: ["Ctrl+C"] },
      { command: "Paste", chords: ["Ctrl+V"] },
      { command: "Find", chords: ["Ctrl+F"] },
      { command: "Replace", chords: ["Ctrl+H"] },
      { command: "Go to line", chords: ["Ctrl+G"] },
      { command: "Toggle line comment", chords: ["Ctrl+/"] },
      { command: "Move line up / down", chords: ["Alt+↑", "Alt+↓"] },
      { command: "Add next occurrence to selection", chords: ["Ctrl+D"] },
      { command: "Delete line", chords: ["Ctrl+Shift+K"] },
    ],
  },
];

/** Concrete services offered by the Add menu; "" means free text (Custom…). */
const SERVICE_TYPES: { label: string; service: string; description: string }[] = [
  {
    label: "GitHub credentials",
    service: "GitHub",
    description: "Personal access token for repositories",
  },
  {
    label: "GitLab credentials",
    service: "GitLab",
    description: "Personal access token for repositories",
  },
  {
    label: "Octopart",
    service: "Octopart",
    description: "Parts catalog and inventory API",
  },
  {
    label: "Digi-Key",
    service: "Digi-Key",
    description: "Parts catalog API",
  },
  {
    label: "Mouser",
    service: "Mouser",
    description: "Parts catalog API",
  },
  {
    label: "LCSC",
    service: "LCSC",
    description: "Parts catalog API",
  },
  {
    label: "SnapEDA",
    service: "SnapEDA",
    description: "Symbols, footprints and 3D models",
  },
  {
    label: "Ultra Librarian",
    service: "Ultra Librarian",
    description: "CAD models and reference designs",
  },
  {
    label: "CAD file resources",
    service: "CAD files",
    description: "Generic CAD file download source",
  },
  {
    label: "Custom…",
    service: "",
    description: "Any other service",
  },
];

/** Free-text suggestions for the service name input (custom add / edit). */
const SERVICE_SUGGESTIONS = [
  "Octopart",
  "Digi-Key",
  "Mouser",
  "LCSC",
  "SnapEDA",
  "Ultra Librarian",
  "GitHub",
  "GitLab",
];

/** Show only the tail of a stored API key. */
function maskKey(key: string): string {
  if (!key) return "";
  return key.length <= 4 ? "•".repeat(key.length) : `${"•".repeat(8)}${key.slice(-4)}`;
}

/** Draft state of the add/edit service dialog. */
interface ServiceDialogState {
  mode: "add" | "edit";
  /** Row id in edit mode. */
  id: string | null;
  service: string;
  account: string;
  apiKey: string;
  /** Pre-filled service from the Add menu — shown read-only. */
  serviceLocked: boolean;
}

/**
 * Settings dialog opened from the gear at the bottom of the activity bar.
 * A VS Code-flavoured modal with a category rail: General, Library,
 * Keyboard Shortcuts and Services.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [libraries, setLibraries] = useState<LibraryEntry[]>(() => loadLibraries());
  const [services, setServices] = useState<ServiceAccount[]>(() => loadServices());
  const [browsing, setBrowsing] = useState(false);

  // Services: read-only table + Add menu (service types) + add/edit dialog.
  const [serviceSelectedId, setServiceSelectedId] = useState<string | null>(null);
  const [serviceDialog, setServiceDialog] = useState<ServiceDialogState | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addAnchor, setAddAnchor] = useState<PopupAnchor | null>(null);

  const addWrapRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // The Add menu measures itself and flips when it would leave the window.
  const addMenuPos = usePopupPosition(addMenuOpen, addAnchor, addMenuRef);

  const update = (patch: Partial<AppSettings>) => setSettings(saveSettings(patch));

  /** Native "pick a folder" dialog writes into the row being edited. */
  const browseIntoDraft = async (patch: (patch: Partial<LibraryEntry>) => void) => {
    if (!inTauri || browsing) return;
    setBrowsing(true);
    try {
      const folder = await openFolder();
      if (folder) patch({ path: folder });
    } finally {
      setBrowsing(false);
    }
  };

  const dialogOpen = serviceDialog !== null;

  // Esc closes the modal — but not while the service add/edit dialog or its
  // Add menu is open; those close themselves first.
  useEffect(() => {
    if (addMenuOpen || dialogOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, addMenuOpen, dialogOpen]);

  // Close the Add menu on outside click, Esc, resize or window blur.
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

  // Esc closes the service dialog (the modal itself stays open).
  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setServiceDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  /** Toggle the Add menu, anchored to the Add button. */
  const toggleAddMenu = () => {
    if (addMenuOpen) {
      setAddMenuOpen(false);
      return;
    }
    const rect = addWrapRef.current?.getBoundingClientRect();
    setAddAnchor(rect ? { x: rect.right, y: rect.bottom, h: rect.height, align: "right" } : null);
    setAddMenuOpen(true);
  };

  /** Start the add dialog pre-filled (and locked) for the chosen service. */
  const openAddService = (type: (typeof SERVICE_TYPES)[number]) => {
    setAddMenuOpen(false);
    setServiceDialog({
      mode: "add",
      id: null,
      service: type.service,
      account: "",
      apiKey: "",
      serviceLocked: type.service !== "",
    });
  };

  const editService = (row: ServiceAccount) => {
    setAddMenuOpen(false);
    setServiceSelectedId(row.id);
    setServiceDialog({
      mode: "edit",
      id: row.id,
      service: row.service,
      account: row.account,
      apiKey: row.apiKey,
      serviceLocked: false,
    });
  };

  const patchServiceDialog = (patch: Partial<ServiceDialogState>) =>
    setServiceDialog((current) => (current ? { ...current, ...patch } : current));

  /** Commit the add/edit dialog into the services list. */
  const saveServiceDialog = () => {
    if (!serviceDialog) return;
    const service = serviceDialog.service.trim();
    if (!service) return;
    const account = serviceDialog.account.trim();
    const apiKey = serviceDialog.apiKey.trim();
    if (serviceDialog.mode === "edit" && serviceDialog.id) {
      const id = serviceDialog.id;
      setServices(
        saveServices(
          services.map((row) => (row.id === id ? { ...row, service, account, apiKey } : row)),
        ),
      );
    } else {
      const id = crypto.randomUUID();
      setServices(saveServices([...services, { id, service, account, apiKey }]));
      setServiceSelectedId(id);
    }
    setServiceDialog(null);
  };

  /** Enter commits the dialog (from any of its inputs). */
  const onDialogInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveServiceDialog();
    }
  };

  const deleteSelectedService = () => {
    if (!serviceSelectedId) return;
    setServices(saveServices(services.filter((row) => row.id !== serviceSelectedId)));
    setServiceSelectedId(null);
  };

  /** Leave no menu or dialog behind when another category is opened. */
  const switchCategory = (id: SettingsCategory) => {
    setCategory(id);
    setAddMenuOpen(false);
    setServiceDialog(null);
  };

  const selectedService = services.find((row) => row.id === serviceSelectedId) ?? null;

  const generalPane = (
    <>
      <Row
        label="Theme"
        description="Color theme of the whole application."
        control={<span className="settings-static-value">Dark (VS Code)</span>}
      />
      <Row
        label="Font Size"
        description="Editor text size in pixels — applied live to every open editor."
        control={
          <select
            className="settings-select"
            aria-label="Font size"
            value={settings.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          >
            {FONT_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        }
      />
      <Row
        label="Word Wrap"
        description="Wrap long lines to the editor width instead of scrolling sideways."
        control={
          <select
            className="settings-select"
            aria-label="Word wrap"
            value={settings.wordWrap ? "on" : "off"}
            onChange={(e) => update({ wordWrap: e.target.value === "on" })}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        }
      />
    </>
  );

  const libraryPane = (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Libraries</div>
          <div className="settings-row-desc">
            Each library is a top folder on disk with a logical name — the one you use in VHDL code
            (e.g. <code>library my_lib;</code>). Select a row and use the buttons to edit it, or
            double-click the row.
          </div>
        </div>
      </div>

      <InlineGrid<LibraryEntry>
        rows={libraries}
        emptyText="No libraries yet — click “Add”."
        createRow={() => ({ id: crypto.randomUUID(), name: "", path: "" })}
        onChange={(rows) => setLibraries(saveLibraries(rows))}
        columns={[
          {
            label: "Path",
            render: (row) =>
              row.path ? (
                <span className="settings-cell-mono" title={row.path}>
                  {row.path}
                </span>
              ) : (
                <span className="settings-cell-missing">(no folder)</span>
              ),
            edit: (draft, patch, onKey) => (
              <span className="settings-cell-inline">
                <EditInput
                  ariaLabel="Library folder path"
                  placeholder="Path to the library folder"
                  value={draft.path}
                  onChange={(path) => patch({ path })}
                  onKey={onKey}
                />
                <button
                  className="settings-browse-btn"
                  title={
                    inTauri
                      ? "Choose folder…"
                      : "Folder picking is only available in the desktop app"
                  }
                  disabled={!inTauri || browsing}
                  onMouseDown={(e) => e.preventDefault()} // keep editing (no blur)
                  onClick={() => void browseIntoDraft(patch)}
                >
                  <FolderIcon />
                </button>
              </span>
            ),
          },
          {
            label: "Name",
            width: 170,
            render: (row) =>
              row.name ? (
                <span className="settings-cell-strong" title={row.name}>
                  {row.name}
                </span>
              ) : (
                <span className="settings-cell-missing">(unnamed)</span>
              ),
            edit: (draft, patch, onKey) => (
              <EditInput
                ariaLabel="Library name"
                placeholder="e.g. my_lib"
                autoFocus
                value={draft.name}
                onChange={(name) => patch({ name })}
                onKey={onKey}
              />
            ),
          },
        ]}
      />

      <p className="settings-note">
        Library roots are shared by all projects. The Library Manager sidebar lists the configured
        libraries; part scanning arrives with real library support.
      </p>
    </div>
  );

  const shortcutsPane = (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Keyboard Shortcuts</div>
          <div className="settings-row-desc">
            Shortcuts currently available in EHDL. Key bindings are fixed for now — remapping is a
            planned addition.
          </div>
        </div>
      </div>

      {SHORTCUT_GROUPS.map((group) => (
        <div className="settings-shortcut-group" key={group.title}>
          <div className="settings-shortcut-group-title">{group.title}</div>
          <table className="settings-table settings-shortcut-table">
            <tbody>
              {group.items.map((item) => (
                <tr key={`${group.title}-${item.command}`} className="settings-grid-row">
                  <td className="settings-table-cell settings-shortcut-command">{item.command}</td>
                  <td className="settings-table-cell settings-shortcut-keys">
                    {item.chords.map((chord) => (
                      <span className="settings-chord" key={chord}>
                        {chord.split("+").map((key) => (
                          <kbd className="settings-kbd" key={key}>
                            {key}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );

  // Read-only services table — accounts and keys are entered in the add/edit
  // dialog, never inline in the table.
  const servicesPane = (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Services</div>
          <div className="settings-row-desc">
            Accounts and API keys for external services — repositories (GitHub, GitLab) and CAD
            resources (Ultra Librarian, SnapEDA, parts suppliers…). Use <b>Add</b> to pick a
            service, then enter the account and key in the dialog. Select a row (or double-click
            it) to edit or remove it.
          </div>
        </div>
      </div>

      <div className="settings-table-editor">
        <div className="settings-tablebox">
          <table className="settings-table">
            <colgroup>
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Account</th>
                <th scope="col">API key</th>
              </tr>
            </thead>
            <tbody>
              {services.map((row) => (
                <tr
                  key={row.id}
                  className={`settings-grid-row ${serviceSelectedId === row.id ? "selected" : ""}`}
                  onClick={() => setServiceSelectedId(row.id)}
                  onDoubleClick={() => editService(row)}
                >
                  <td className="settings-table-cell">
                    {row.service ? (
                      <span className="settings-cell-strong" title={row.service}>
                        {row.service}
                      </span>
                    ) : (
                      <span className="settings-cell-missing">(unnamed)</span>
                    )}
                  </td>
                  <td className="settings-table-cell">
                    {row.account ? (
                      <span title={row.account}>{row.account}</span>
                    ) : (
                      <span className="settings-cell-missing">(no account)</span>
                    )}
                  </td>
                  <td className="settings-table-cell">
                    {row.apiKey ? (
                      <span className="settings-cell-mono" title="Hidden — use Edit to view or change">
                        {maskKey(row.apiKey)}
                      </span>
                    ) : (
                      <span className="settings-cell-missing">(not set)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {services.length === 0 && (
            <div className="settings-table-empty">No services yet — click “Add”.</div>
          )}
        </div>

        <div className="settings-table-actions">
          <div className="settings-add-wrap" ref={addWrapRef}>
            <button
              className="btn"
              onClick={toggleAddMenu}
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              title="Choose a service to add"
            >
              Add
            </button>
          </div>
          <button
            className="btn"
            onClick={() => selectedService && editService(selectedService)}
            disabled={!selectedService || dialogOpen}
            title={selectedService ? "Edit the selected service" : "Select a service first"}
          >
            Edit
          </button>
          <button
            className="btn btn-danger"
            onClick={deleteSelectedService}
            disabled={!selectedService}
            title={selectedService ? "Remove the selected service" : "Select a service first"}
          >
            Delete
          </button>
        </div>
      </div>

      <datalist id="ehdl-service-suggestions">
        {SERVICE_SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <p className="settings-note">
        Keys are stored locally on this machine (app storage, plain text for now — moving them to
        the OS credential store is planned). They are masked in the table and only shown in the
        add/edit dialog.
      </p>
    </div>
  );

  const panes: Record<SettingsCategory, ReactNode> = {
    general: generalPane,
    library: libraryPane,
    shortcuts: shortcutsPane,
    services: servicesPane,
  };

  return (
    <>
      <div className="settings-overlay" onClick={onClose}>
        <div
          className="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-modal-header">
            <span className="settings-modal-title">Settings</span>
            <button
              className="settings-modal-close"
              title="Close settings (Esc)"
              aria-label="Close settings"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
          </div>

          <div className="settings-modal-body">
            <nav className="settings-cats" aria-label="Settings categories">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className={`settings-cat-btn ${category === c.id ? "active" : ""}`}
                  onClick={() => switchCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </nav>
            <section className="settings-pane" aria-label="Settings content">
              {panes[category]}
            </section>
          </div>
        </div>
      </div>

      {/* Add menu — portaled above the Settings modal and positioned (with
          left/top) by usePopupPosition, opening leftwards from the Add
          button and flipping when it would leave the window. */}
      {addMenuOpen &&
        createPortal(
          <div
            className="settings-menu"
            role="menu"
            aria-label="Add service"
            ref={addMenuRef}
            style={{
              left: addMenuPos?.left ?? addAnchor?.x ?? 0,
              top: addMenuPos?.top ?? addAnchor?.y ?? 0,
              visibility: addMenuPos ? "visible" : "hidden",
            }}
          >
            <div className="settings-menu-title">Add service</div>
            {SERVICE_TYPES.map((type) => (
              <button
                key={type.label}
                className="settings-menu-item"
                role="menuitem"
                onClick={() => openAddService(type)}
              >
                <span className="settings-menu-label">{type.label}</span>
                <span className="settings-menu-desc">{type.description}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {/* Add/edit service dialog — portaled above the Settings modal. */}
      {serviceDialog &&
        createPortal(
          <div className="service-dialog-overlay">
            <div
              className="service-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={serviceDialog.mode === "add" ? "Add service" : "Edit service"}
            >
              <div className="service-dialog-title">
                {serviceDialog.mode === "add" ? "Add service" : "Edit service"}
              </div>
              <label className="service-field">
                <span>Service</span>
                {serviceDialog.serviceLocked ? (
                  <span className="service-dialog-value">{serviceDialog.service}</span>
                ) : (
                  <input
                    className="settings-input"
                    type="text"
                    spellCheck={false}
                    placeholder="e.g. Octopart"
                    aria-label="Service name"
                    list="ehdl-service-suggestions"
                    autoFocus
                    value={serviceDialog.service}
                    onChange={(e) => patchServiceDialog({ service: e.target.value })}
                    onKeyDown={onDialogInputKey}
                  />
                )}
              </label>
              <label className="service-field">
                <span>Account</span>
                <input
                  className="settings-input"
                  type="text"
                  spellCheck={false}
                  placeholder="user name or e-mail"
                  aria-label="Service account"
                  autoFocus={serviceDialog.serviceLocked}
                  value={serviceDialog.account}
                  onChange={(e) => patchServiceDialog({ account: e.target.value })}
                  onKeyDown={onDialogInputKey}
                />
              </label>
              <label className="service-field">
                <span>API key</span>
                <input
                  className="settings-input"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="paste the API key"
                  aria-label="Service API key"
                  value={serviceDialog.apiKey}
                  onChange={(e) => patchServiceDialog({ apiKey: e.target.value })}
                  onKeyDown={onDialogInputKey}
                />
              </label>
              <div className="service-dialog-actions">
                <button className="btn" onClick={() => setServiceDialog(null)}>
                  Cancel
                </button>
                <button
                  className="btn settings-primary-btn"
                  disabled={!serviceDialog.service.trim()}
                  title={serviceDialog.service.trim() ? undefined : "Enter a service name first"}
                  onClick={saveServiceDialog}
                >
                  {serviceDialog.mode === "add" ? "Add" : "Save"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
