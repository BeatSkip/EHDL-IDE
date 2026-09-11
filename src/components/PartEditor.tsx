import { useContext, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppContext } from "../appContext";
import { CodeEditor } from "./CodeEditor";
import { getEditorText, setEditorText } from "../editorState";
import { docName, docPath, initialContent } from "../documents";
import { inTauri, openFile, readFileText, openExternal, joinPath } from "../fs";
import { LIBRARY_SECTIONS } from "../settings";
import { relativeKey } from "../libraryMeta";
import { parsePart, serializePart } from "../partFile";
import type { PartDoc, PartVendor } from "../partFile";

type Mode = "graphical" | "vhdl";

/** Absolute path of a link: library-relative links resolve against the library root. */
function resolveLink(root: string | null, link: string): string {
  if (!root) return link;
  if (/^[A-Za-z]:[\\/]/.test(link) || link.startsWith("\\\\") || link.startsWith("/")) return link;
  return link
    .split(/[\\/]/)
    .filter(Boolean)
    .reduce((acc, part) => joinPath(acc, part), root);
}

/**
 * The library root of a part file: the parent of the category folder the file
 * sits in (`…/my_lib/components/Passives/R.prt.ehd` → `…/my_lib`).
 */
function libraryRootOf(filePath: string): string | null {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const parts = filePath.split(/[\\/]/);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if ((LIBRARY_SECTIONS as readonly string[]).includes(parts[i])) {
      return parts.slice(0, i).join(sep);
    }
  }
  return null;
}

/** One list of links (symbols or footprints) with view / remove controls. */
function LinkList({
  title,
  hint,
  links,
  onAdd,
  onRemove,
  onView,
  disabled,
}: {
  title: string;
  hint: string;
  links: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onView: (link: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="part-links">
      <div className="part-section-head">
        <span className="part-section-title">{title}</span>
        <button className="btn" disabled={disabled} title={hint} onClick={onAdd}>
          Link…
        </button>
      </div>
      {links.length === 0 ? (
        <p className="part-empty">{hint}</p>
      ) : (
        <ul className="part-link-list">
          {links.map((link, index) => (
            <li className="part-link" key={`${link}-${index}`}>
              <span className="part-link-path" title={link}>
                {link}
              </span>
              <button className="btn" onClick={() => onView(link)}>
                View
              </button>
              <button
                className="library-icon-btn"
                title="Remove this link"
                aria-label={`Remove ${link}`}
                onClick={() => onRemove(index)}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Part editor — the document editor for component part files (`xxx.prt.ehd`).
 *
 * It works like the normal editor (own dock tab, Ctrl+S saves to disk), but
 * instead of the schematic pane beside the text it offers the two ways of
 * defining a part: **VHDL** (the raw text) or **Graphical** (form for the part
 * name, linked symbols and footprints, and preferred vendor parts / links /
 * datasheets). The definition language and backend are not chosen yet, so both
 * modes work on the provisional plain-text format in `partFile.ts`.
 */
export function PartEditor({ fileId }: { fileId: string }) {
  const { openFsPath, saveFile } = useContext(AppContext);

  const text = () => getEditorText(fileId, initialContent(fileId));
  const path = docPath(fileId);
  const root = path ? libraryRootOf(path) : null;
  const rootKey = root && path ? relativeKey(root, path) : "";

  const [mode, setMode] = useState<Mode>("graphical");
  const [doc, setDoc] = useState<PartDoc>(() => parsePart(text()));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{
    link: string;
    path: string;
    text: string | null;
    error: string | null;
  } | null>(null);

  /** Graphical edits are written straight into the shared document text. */
  const applyDoc = (next: PartDoc) => {
    setDoc(next);
    setEditorText(fileId, serializePart(next));
    setDirty(true);
  };

  const switchMode = (next: Mode) => {
    // Coming back from the text view, re-read whatever the user typed there.
    if (next === "graphical") setDoc(parsePart(text()));
    setMode(next);
  };

  const save = () => {
    void saveFile(fileId).then(() => setDirty(false));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  /** Link a file (picked with the native dialog) as a symbol or footprint. */
  const addLink = async (field: "symbols" | "footprints") => {
    const picked = await openFile();
    if (!picked) return;
    const value = root ? relativeKey(root, picked) : picked;
    applyDoc({ ...doc, [field]: [...doc[field], value] });
  };

  const removeLink = (field: "symbols" | "footprints", index: number) =>
    applyDoc({ ...doc, [field]: doc[field].filter((_, i) => i !== index) });

  const patchVendor = (index: number, patch: Partial<PartVendor>) =>
    applyDoc({
      ...doc,
      vendors: doc.vendors.map((vendor, i) => (i === index ? { ...vendor, ...patch } : vendor)),
    });

  const viewLink = async (link: string) => {
    const resolved = resolveLink(root, link);
    setPreview({ link, path: resolved, text: null, error: null });
    try {
      const content = await readFileText(resolved);
      setPreview({ link, path: resolved, text: content, error: null });
    } catch (err) {
      setPreview({
        link,
        path: resolved,
        text: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="part-editor" onKeyDown={onKeyDown}>
      <div className="part-editor-header">
        <span className="part-editor-title" title={path ?? ""}>
          {docName(fileId)}
        </span>
        <div className="part-editor-modes" role="tablist" aria-label="Part definition mode">
          <button
            className={`part-mode-tab ${mode === "graphical" ? "active" : ""}`}
            role="tab"
            aria-selected={mode === "graphical"}
            title="Define the part with the graphical editor"
            onClick={() => switchMode("graphical")}
          >
            Graphical
          </button>
          <button
            className={`part-mode-tab ${mode === "vhdl" ? "active" : ""}`}
            role="tab"
            aria-selected={mode === "vhdl"}
            title="Define the part as text (VHDL-style source)"
            onClick={() => switchMode("vhdl")}
          >
            VHDL
          </button>
        </div>
        <span className="part-editor-spacer" />
        {doc.library && <span className="part-editor-meta">{doc.library}</span>}
        {dirty && (
          <span className="part-editor-dirty" title="Unsaved changes">
            ●
          </span>
        )}
        <button
          className="btn settings-primary-btn"
          disabled={!inTauri || !path}
          title={path ? "Save the part file (Ctrl+S)" : "This document has no file on disk"}
          onClick={save}
        >
          Save
        </button>
      </div>

      {mode === "vhdl" ? (
        <div className="part-editor-body">
          <CodeEditor
            file={{ id: fileId, name: docName(fileId), content: text() }}
            onSave={save}
          />
        </div>
      ) : (
        <div className="part-editor-body part-editor-graphical">
          <div className="part-form">
            <section className="part-field">
              <label htmlFor="part-name">Part name</label>
              <input
                id="part-name"
                className="settings-input"
                type="text"
                spellCheck={false}
                value={doc.name}
                onChange={(e) => applyDoc({ ...doc, name: e.target.value })}
              />
            </section>

            <section className="part-field">
              <label htmlFor="part-desc">Description</label>
              <input
                id="part-desc"
                className="settings-input"
                type="text"
                spellCheck={false}
                placeholder="optional"
                value={doc.description}
                onChange={(e) => applyDoc({ ...doc, description: e.target.value })}
              />
            </section>

            <p className="part-file-path" title={path ?? ""}>
              {rootKey ? `${rootKey}` : "not saved to a library yet"}
            </p>

            <LinkList
              title="Schematic symbols"
              hint="Link a symbol file (.sym.ehd) that draws this part."
              links={doc.symbols}
              disabled={!inTauri}
              onAdd={() => void addLink("symbols")}
              onRemove={(index) => removeLink("symbols", index)}
              onView={(link) => void viewLink(link)}
            />

            <LinkList
              title="Footprints"
              hint="Link a footprint file for the board layout."
              links={doc.footprints}
              disabled={!inTauri}
              onAdd={() => void addLink("footprints")}
              onRemove={(index) => removeLink("footprints", index)}
              onView={(link) => void viewLink(link)}
            />

            <section className="part-vendors">
              <div className="part-section-head">
                <span className="part-section-title">Preferred vendor parts</span>
                <button
                  className="btn"
                  onClick={() =>
                    applyDoc({
                      ...doc,
                      vendors: [...doc.vendors, { name: "", part: "", url: "", datasheet: "" }],
                    })
                  }
                >
                  Add vendor
                </button>
              </div>
              {doc.vendors.length === 0 ? (
                <p className="part-empty">
                  Vendor part numbers, product links and datasheets for this part.
                </p>
              ) : (
                <div className="part-vendor-grid">
                  <div className="part-vendor-head">
                    <span>Vendor</span>
                    <span>Part number</span>
                    <span>Link</span>
                    <span>Datasheet</span>
                    <span />
                  </div>
                  {doc.vendors.map((vendor, index) => (
                    <div className="part-vendor-row" key={index}>
                      <input
                        className="settings-input"
                        type="text"
                        spellCheck={false}
                        aria-label="Vendor"
                        placeholder="Digi-Key"
                        value={vendor.name}
                        onChange={(e) => patchVendor(index, { name: e.target.value })}
                      />
                      <input
                        className="settings-input"
                        type="text"
                        spellCheck={false}
                        aria-label="Vendor part number"
                        placeholder="IRF540NPBF-ND"
                        value={vendor.part}
                        onChange={(e) => patchVendor(index, { part: e.target.value })}
                      />
                      <span className="part-url-cell">
                        <input
                          className="settings-input"
                          type="text"
                          spellCheck={false}
                          aria-label="Product link"
                          placeholder="https://…"
                          value={vendor.url}
                          onChange={(e) => patchVendor(index, { url: e.target.value })}
                        />
                        <button
                          className="library-icon-btn"
                          title={vendor.url ? `Open ${vendor.url}` : "No link yet"}
                          aria-label="Open product link"
                          disabled={!inTauri || !vendor.url}
                          onClick={() => void openExternal(vendor.url)}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                            <path d="M6.5 3.5H3.5v9h9v-3" />
                            <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
                          </svg>
                        </button>
                      </span>
                      <span className="part-url-cell">
                        <input
                          className="settings-input"
                          type="text"
                          spellCheck={false}
                          aria-label="Datasheet link"
                          placeholder="https://…pdf"
                          value={vendor.datasheet}
                          onChange={(e) => patchVendor(index, { datasheet: e.target.value })}
                        />
                        <button
                          className="library-icon-btn"
                          title={vendor.datasheet ? `Open ${vendor.datasheet}` : "No datasheet yet"}
                          aria-label="Open datasheet"
                          disabled={!inTauri || !vendor.datasheet}
                          onClick={() => void openExternal(vendor.datasheet)}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                            <path d="M3.5 2.5h6l3 3v8h-9z" />
                            <path d="M9.5 2.5v3h3" />
                          </svg>
                        </button>
                      </span>
                      <button
                        className="library-icon-btn"
                        title="Remove this vendor"
                        aria-label="Remove vendor"
                        onClick={() =>
                          applyDoc({ ...doc, vendors: doc.vendors.filter((_, i) => i !== index) })
                        }
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {doc.extra.length > 0 && (
              <p className="part-note">
                {doc.extra.length} line{doc.extra.length === 1 ? "" : "s"} of this file are not part
                of the graphical fields — they are preserved on save.
              </p>
            )}
          </div>

          <aside className="part-preview">
            {preview ? (
              <>
                <div className="part-section-head">
                  <span className="part-section-title" title={preview.path}>
                    {preview.link}
                  </span>
                  <button className="btn" onClick={() => void openFsPath(preview.path)}>
                    Open in editor
                  </button>
                </div>
                <p className="part-preview-note">
                  Text preview. A graphical symbol / footprint preview arrives with the symbol
                  editor.
                </p>
                <pre className="part-preview-body">
                  {preview.error ? `Could not read the file:\n${preview.error}` : preview.text}
                </pre>
              </>
            ) : (
              <p className="part-empty">
                Choose <b>View</b> on a linked symbol or footprint to preview it here.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}