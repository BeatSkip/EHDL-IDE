import { useContext, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppContext } from "../appContext";
import { CodeEditor } from "./CodeEditor";
import { getEditorText, setEditorText } from "../editorState";
import { docName, docPath } from "../documents";
import { dirNameOf } from "../libraryFiles";
import { resolveSymbolPath } from "../symbolFile";
import { SymbolPreview } from "./SymbolPreview";
import { inTauri, readFileText, openExternal, openFile } from "../fs";
import { parseComponentVhdl, serializeComponent, packageNameFor, pinTypeNameFor } from "../vhdlPart";
import type { ComponentIssue, ComponentModel, ComponentPort, PortDirection } from "../vhdlPart";

type Mode = "graphical" | "vhdl";

const DIRECTIONS: PortDirection[] = ["in", "out", "inout"];

/** Values that look like a URL are opened in the browser; paths are previewed. */
const isUrl = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());

/**
 * Part editor — the document editor for component part files (`xxx.vhd`).
 *
 * The file is a VHDL component (package + entity + architecture) exactly as
 * specified in `docs/vhdl-implementation.md`, so it is the single source of
 * truth for ports, package variants, pin maps, footprint names and metadata.
 * The two modes edit that one file: **Graphical** for the structured fields,
 * **VHDL** for the source itself. Saving writes canonical VHDL.
 */
export function PartEditor({ fileId }: { fileId: string }) {
  const { saveFile, openFsPath } = useContext(AppContext);

  // The part's VHDL lives in the shared editor store (set when the file was read).
  const text = () => getEditorText(fileId, "");
  const path = docPath(fileId);

  const [mode, setMode] = useState<Mode>("graphical");
  const [parsed, setParsed] = useState(() => parseComponentVhdl(text(), docName(fileId)));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ label: string; text: string | null; error: string | null } | null>(
    null,
  );

  const model = parsed.model;
  const errors = parsed.issues.filter((issue) => issue.severity === "error");
  const warnings = parsed.issues.filter((issue) => issue.severity === "warning");

  /** `..`-style path from a folder to a file (absolute on another drive). */
  function relativeTo(fromDir: string, target: string): string {
    const sep = fromDir.includes("\\") ? "\\" : "/";
    const from = fromDir.split(/[\\/]/);
    const to = target.split(/[\\/]/);
    if ((from[0] ?? "").toLowerCase() !== (to[0] ?? "").toLowerCase()) return target;
    let common = 0;
    while (common < from.length && common < to.length && from[common].toLowerCase() === to[common].toLowerCase()) {
      common += 1;
    }
    return [...Array(from.length - common).fill(".."), ...to.slice(common)].join(sep);
  }

  /** The schematic symbol linked to this part (`SYMBOL` constant in the package). */
  const symbolLink =
    model.metadata.find((entry) => entry.key.toUpperCase() === "SYMBOL")?.value ?? "";

  /** Where that link points, so the drawing and the generator agree. */
  const symbolPath = path && symbolLink ? resolveSymbolPath(path, symbolLink) : null;

  /**
   * Link a schematic symbol to this part — stored as a `SYMBOL` string constant
   * in the package, relative to the part file, so it survives on other machines
   * and shows up in the VHDL view as well.
   */
  const setSymbolLink = (value: string) => {
    const rest = model.metadata.filter((entry) => entry.key.toUpperCase() !== "SYMBOL");
    applyModel({ ...model, metadata: value ? [...rest, { key: "SYMBOL", value }] : rest });
  };

  const linkSymbol = async () => {
    const picked = await openFile();
    if (!picked) return;
    const partPath = docPath(fileId);
    setSymbolLink(partPath ? relativeTo(dirNameOf(partPath), picked) : picked);
  };

  /** Graphical edits go straight into the shared document text. */
  const applyModel = (next: ComponentModel) => {
    const issues = parseComponentVhdl(serializeComponent(next), docName(fileId)).issues;
    setParsed({ model: next, issues });
    setEditorText(fileId, serializeComponent(next));
    setDirty(true);
  };

  const switchMode = (next: Mode) => {
    // Coming back from the source view, re-read whatever was typed there.
    if (next === "graphical") setParsed(parseComponentVhdl(text(), docName(fileId)));
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

  // --- ports ---------------------------------------------------------------

  const patchPort = (index: number, patch: Partial<ComponentPort>) =>
    applyModel({
      ...model,
      ports: model.ports.map((port, i) => (i === index ? { ...port, ...patch } : port)),
    });

  const addPort = () =>
    applyModel({ ...model, ports: [...model.ports, { name: `P${model.ports.length + 1}`, direction: "in" }] });

  /** Ports are the join key: renaming one keeps both the enum and pin maps in step. */
  const renamePort = (index: number, name: string) => {
    const previous = model.ports[index].name;
    applyModel({
      ...model,
      ports: model.ports.map((port, i) => (i === index ? { ...port, name } : port)),
      variants: model.variants.map((variant) => {
        if (!(previous in variant.pins)) return variant;
        const pins = { ...variant.pins };
        pins[name] = pins[previous];
        delete pins[previous];
        return { ...variant, pins };
      }),
    });
  };

  const removePort = (index: number) => {
    const name = model.ports[index].name;
    applyModel({
      ...model,
      ports: model.ports.filter((_, i) => i !== index),
      variants: model.variants.map((variant) => {
        const pins = { ...variant.pins };
        delete pins[name];
        return { ...variant, pins };
      }),
    });
  };

  // --- variants ------------------------------------------------------------

  const patchVariant = (index: number, patch: Partial<ComponentModel["variants"][number]>) =>
    applyModel({
      ...model,
      variants: model.variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)),
    });

  const setPin = (variantIndex: number, port: string, value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    const variant = model.variants[variantIndex];
    const pins = { ...variant.pins };
    if (digits === "") delete pins[port];
    else pins[port] = Number(digits);
    patchVariant(variantIndex, { pins });
  };

  const addVariant = () =>
    applyModel({
      ...model,
      variants: [
        ...model.variants,
        { name: `VARIANT${model.variants.length + 1}`, footprint: "", pins: {} },
      ],
    });

  // --- metadata ------------------------------------------------------------

  const parseValue = async (label: string, value: string) => {
    if (isUrl(value)) {
      await openExternal(value.trim());
      return;
    }
    setPreview({ label, text: null, error: null });
    const resolved = value.trim();
    try {
      const content = await readFileText(resolved);
      setPreview({ label, text: content, error: null });
    } catch (err) {
      setPreview({
        label,
        text: null,
        error: `Could not read '${resolved}': ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const issueList = (items: ComponentIssue[], className: string) => (
    <ul className={`part-issues ${className}`}>
      {items.map((issue, index) => (
        <li key={`${issue.message}-${index}`}>{issue.message}</li>
      ))}
    </ul>
  );

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
            title="Edit the structured fields (written back as VHDL)"
            onClick={() => switchMode("graphical")}
          >
            Graphical
          </button>
          <button
            className={`part-mode-tab ${mode === "vhdl" ? "active" : ""}`}
            role="tab"
            aria-selected={mode === "vhdl"}
            title="Edit the VHDL source directly"
            onClick={() => switchMode("vhdl")}
          >
            VHDL
          </button>
        </div>
        <span className="part-editor-spacer" />
        <span className="part-editor-meta">
          {model.variants.length} variant{model.variants.length === 1 ? "" : "s"} ·{" "}
          {model.ports.length} port{model.ports.length === 1 ? "" : "s"}
        </span>
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
          <CodeEditor file={{ id: fileId, name: docName(fileId), content: text() }} onSave={save} />
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
                value={model.name}
                onChange={(e) => applyModel({ ...model, name: e.target.value })}
              />
              <p className="part-sub">
                package {packageNameFor(model.name)} · entity {model.name} · pin enum{" "}
                {pinTypeNameFor(model.name)}
              </p>
            </section>

            <section className="part-section">
              <div className="part-section-head">
                <span className="part-section-title">Ports</span>
                <button className="btn" onClick={addPort}>
                  Add port
                </button>
              </div>
              {model.ports.length === 0 ? (
                <p className="part-empty">
                  Port names are the join key — they must match the pin enum literals exactly.
                </p>
              ) : (
                <div className="part-port-grid">
                  {model.ports.map((port, index) => (
                    <div className="part-port-row" key={index}>
                      <input
                        className="settings-input"
                        type="text"
                        spellCheck={false}
                        aria-label={`Port ${index + 1} name`}
                        value={port.name}
                        onChange={(e) => renamePort(index, e.target.value)}
                      />
                      <select
                        className="settings-select"
                        aria-label={`Port ${index + 1} direction`}
                        value={port.direction}
                        onChange={(e) =>
                          patchPort(index, { direction: e.target.value as PortDirection })
                        }
                      >
                        {(DIRECTIONS.includes(port.direction) ? DIRECTIONS : [port.direction, ...DIRECTIONS]).map(
                          (direction) => (
                            <option key={direction} value={direction}>
                              {direction}
                            </option>
                          ),
                        )}
                      </select>
                      <button
                        className="library-icon-btn"
                        title="Remove this port"
                        aria-label={`Remove port ${port.name}`}
                        onClick={() => removePort(index)}
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

            <section className="part-section">
              <div className="part-section-head">
                <span className="part-section-title">Schematic symbol</span>
                <button
                  className="btn"
                  title="Choose the symbol file drawn for this part"
                  disabled={!inTauri}
                  onClick={() => void linkSymbol()}
                >
                  {symbolLink ? "Change…" : "Link…"}
                </button>
                {symbolLink && (
                  <button
                    className="library-icon-btn"
                    title="Unlink this symbol"
                    aria-label="Unlink symbol"
                    onClick={() => setSymbolLink("")}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    </svg>
                  </button>
                )}
              </div>
              {symbolLink ? (
                <>
                  <div className="part-link-path" title={symbolLink}>
                    {symbolLink}
                  </div>
                  <p className="part-sub">Drawn in the Symbol panel — it is the symbol designs use.</p>
                </>
              ) : (
                <p className="part-empty">
                  No symbol linked — pick a symbol program from the library's <code>symbols</code>{" "}
                  folder. The link is written as a <code>SYMBOL</code> constant in this file, so the
                  VHDL view shows it too.
                </p>
              )}
            </section>

            <section className="part-section">
              <div className="part-section-head">
                <span className="part-section-title">Package variants</span>
                <button className="btn" onClick={addVariant}>
                  Add variant
                </button>
              </div>
              {model.variants.map((variant, variantIndex) => (
                <div className="part-variant" key={variantIndex}>
                  <div className="part-variant-head">
                    <input
                      className="settings-input"
                      type="text"
                      spellCheck={false}
                      aria-label={`Variant ${variantIndex + 1} name`}
                      title="Variant name — selected by the PACKAGE_VARIANT generic"
                      value={variant.name}
                      onChange={(e) => patchVariant(variantIndex, { name: e.target.value })}
                    />
                    <button
                      className={`part-default ${model.defaultVariant.toLowerCase() === variant.name.toLowerCase() ? "active" : ""}`}
                      title="Use this variant as the entity's PACKAGE_VARIANT default"
                      onClick={() => applyModel({ ...model, defaultVariant: variant.name })}
                    >
                      {model.defaultVariant.toLowerCase() === variant.name.toLowerCase()
                        ? "default"
                        : "make default"}
                    </button>
                    <button
                      className="library-icon-btn"
                      title="Remove this variant"
                      aria-label={`Remove variant ${variant.name}`}
                      onClick={() =>
                        applyModel({
                          ...model,
                          variants: model.variants.filter((_, i) => i !== variantIndex),
                        })
                      }
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                      </svg>
                    </button>
                  </div>
                  <label className="part-sub-label" htmlFor={`fp-${variantIndex}`}>
                    Footprint (IPC-7351 name)
                  </label>
                  <input
                    id={`fp-${variantIndex}`}
                    className="settings-input"
                    type="text"
                    spellCheck={false}
                    placeholder="SOIC127P600X175-8N"
                    value={variant.footprint}
                    onChange={(e) => patchVariant(variantIndex, { footprint: e.target.value })}
                  />
                  <div className="part-pin-grid">
                    {model.ports.length === 0 ? (
                      <p className="part-empty">Add ports to fill in the pin map.</p>
                    ) : (
                      model.ports.map((port) => (
                        <label className="part-pin" key={port.name}>
                          <span>{port.name}</span>
                          <input
                            className="settings-input"
                            type="text"
                            inputMode="numeric"
                            spellCheck={false}
                            aria-label={`Pin number for ${port.name} in ${variant.name}`}
                            placeholder="—"
                            value={variant.pins[port.name] ?? ""}
                            onChange={(e) => setPin(variantIndex, port.name, e.target.value)}
                          />
                        </label>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section className="part-section">
              <div className="part-section-head">
                <span className="part-section-title">Metadata constants</span>
                <button
                  className="btn"
                  onClick={() =>
                    applyModel({ ...model, metadata: [...model.metadata, { key: "MFR", value: "" }] })
                  }
                >
                  Add constant
                </button>
              </div>
              <p className="part-empty">
                Extra string constants such as MFR, PARTNUM or datasheet links. Values that are URLs
                open in the browser; file paths are previewed.
              </p>
              {model.metadata.map((entry, index) => (
                <div className="part-meta-row" key={index}>
                  <input
                    className="settings-input"
                    type="text"
                    spellCheck={false}
                    aria-label={`Metadata ${index + 1} name`}
                    placeholder="MFR"
                    value={entry.key}
                    onChange={(e) =>
                      applyModel({
                        ...model,
                        metadata: model.metadata.map((item, i) =>
                          i === index ? { ...item, key: e.target.value } : item,
                        ),
                      })
                    }
                  />
                  <input
                    className="settings-input"
                    type="text"
                    spellCheck={false}
                    aria-label={`Metadata ${index + 1} value`}
                    placeholder="Texas Instruments"
                    value={entry.value}
                    onChange={(e) =>
                      applyModel({
                        ...model,
                        metadata: model.metadata.map((item, i) =>
                          i === index ? { ...item, value: e.target.value } : item,
                        ),
                      })
                    }
                  />
                  <button
                    className="library-icon-btn"
                    title={isUrl(entry.value) ? "Open this link" : "Preview this file"}
                    aria-label={`Open ${entry.key}`}
                    disabled={!inTauri || !entry.value}
                    onClick={() => void parseValue(`${model.name}_${entry.key}`, entry.value)}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                      <path d="M6.5 3.5H3.5v9h9v-3" />
                      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
                    </svg>
                  </button>
                  <button
                    className="library-icon-btn"
                    title="Remove this constant"
                    aria-label="Remove constant"
                    onClick={() =>
                      applyModel({ ...model, metadata: model.metadata.filter((_, i) => i !== index) })
                    }
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    </svg>
                  </button>
                </div>
              ))}
            </section>

            {model.comments.length > 0 && (
              <p className="part-note">
                {model.comments.length} comment line{model.comments.length === 1 ? "" : "s"} kept and
                written back at the top of the file.
              </p>
            )}
          </div>

          <aside className="part-preview">
            <SymbolPreview
              symbolPath={symbolPath}
              onOpen={symbolPath ? () => void openFsPath(symbolPath) : undefined}
            />

            <div className="part-section-head">
              <span className="part-section-title">Check</span>
            </div>
            {parsed.issues.length === 0 ? (
              <p className="part-ok">No problems found. The file matches the component spec.</p>
            ) : (
              <>
                {errors.length > 0 && issueList(errors, "part-issues-error")}
                {warnings.length > 0 && issueList(warnings, "part-issues-warning")}
              </>
            )}

            {preview && (
              <div className="part-preview-file">
                <div className="part-section-head">
                  <span className="part-section-title" title={preview.label}>
                    {preview.label}
                  </span>
                </div>
                <pre className="part-preview-body">
                  {preview.error ? preview.error : preview.text}
                </pre>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
