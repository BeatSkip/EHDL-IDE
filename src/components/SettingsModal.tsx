import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
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
// Library and Services categories: rows are selected, then edited inline with
// the Add / Edit / Delete button column (Enter commits, Esc cancels).
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

/** Common component suppliers / repositories offered as service suggestions. */
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

  // Esc closes the modal (grids and inputs stop propagation while editing).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const servicesPane = (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Services</div>
          <div className="settings-row-desc">
            Accounts and API keys for external services — component suppliers (Octopart, Digi-Key,
            Mouser, LCSC…) and repositories. Select a row and use the buttons to edit it, or
            double-click the row.
          </div>
        </div>
      </div>

      <InlineGrid<ServiceAccount>
        rows={services}
        emptyText="No services yet — click “Add”."
        createRow={() => ({
          id: crypto.randomUUID(),
          service: "",
          account: "",
          apiKey: "",
        })}
        onChange={(rows) => setServices(saveServices(rows))}
        columns={[
          {
            label: "Service",
            width: 170,
            render: (row) =>
              row.service ? (
                <span className="settings-cell-strong" title={row.service}>
                  {row.service}
                </span>
              ) : (
                <span className="settings-cell-missing">(unnamed)</span>
              ),
            edit: (draft, patch, onKey) => (
              <EditInput
                ariaLabel="Service name"
                placeholder="e.g. Octopart"
                autoFocus
                list="ehdl-service-suggestions"
                value={draft.service}
                onChange={(service) => patch({ service })}
                onKey={onKey}
              />
            ),
          },
          {
            label: "Account",
            render: (row) =>
              row.account ? (
                <span title={row.account}>{row.account}</span>
              ) : (
                <span className="settings-cell-missing">(no account)</span>
              ),
            edit: (draft, patch, onKey) => (
              <EditInput
                ariaLabel="Service account"
                placeholder="user name or e-mail"
                value={draft.account}
                onChange={(account) => patch({ account })}
                onKey={onKey}
              />
            ),
          },
          {
            label: "API key",
            width: 190,
            render: (row) =>
              row.apiKey ? (
                <span className="settings-cell-mono" title="Hidden — use Edit to view or change">
                  {maskKey(row.apiKey)}
                </span>
              ) : (
                <span className="settings-cell-missing">(not set)</span>
              ),
            edit: (draft, patch, onKey) => (
              <EditInput
                ariaLabel="Service API key"
                placeholder="paste the API key"
                value={draft.apiKey}
                onChange={(apiKey) => patch({ apiKey })}
                onKey={onKey}
              />
            ),
          },
        ]}
      />

      <datalist id="ehdl-service-suggestions">
        {SERVICE_SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <p className="settings-note">
        Keys are stored locally on this machine (app storage, plain text for now — moving them to
        the OS credential store is planned) and are only shown while editing a row.
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
                onClick={() => setCategory(c.id)}
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
  );
}
