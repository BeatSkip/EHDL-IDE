import { useContext, useEffect, useState } from "react";
import { AppContext } from "../appContext";
import { loadLibraries, subscribeLibraries, LIBRARY_SECTIONS } from "../settings";
import type { LibraryEntry, LibrarySectionId } from "../settings";
import { inTauri, listDir, createDir, copyEntry, writeFileText, openFile, joinPath } from "../fs";
import {
  ITEM_EXT,
  SECTION_LABELS,
  PART_KIND,
  DEFAULT_ITEM_NAMES,
  PIN_DIRECTIONS,
  buildPartContent,
  fileNameOf,
  splitName,
  uniqueFileName,
} from "../libraryFiles";
import type { PartPin, PinDirection } from "../libraryFiles";

type WizardStep = "basics" | "pins" | "review";

const STEP_LABELS: Record<WizardStep, string> = {
  basics: "Basics",
  pins: "Pins",
  review: "Review",
};

/** One pin row in the wizard. */
function PinEditor({
  pins,
  onChange,
}: {
  pins: PartPin[];
  onChange: (pins: PartPin[]) => void;
}) {
  const patch = (index: number, next: Partial<PartPin>) =>
    onChange(pins.map((pin, i) => (i === index ? { ...pin, ...next } : pin)));

  return (
    <div className="create-pins">
      <div className="create-pin-head">
        <span>#</span>
        <span>Name</span>
        <span>Dir</span>
        <span />
      </div>
      {pins.map((pin, index) => (
        <div className="create-pin-row" key={index}>
          <input
            className="settings-input"
            type="text"
            spellCheck={false}
            aria-label={`Pin ${index + 1} number`}
            value={pin.number}
            onChange={(e) => patch(index, { number: e.target.value })}
          />
          <input
            className="settings-input"
            type="text"
            spellCheck={false}
            placeholder="e.g. VCC"
            aria-label={`Pin ${index + 1} name`}
            value={pin.name}
            onChange={(e) => patch(index, { name: e.target.value })}
          />
          <select
            className="settings-select"
            aria-label={`Pin ${index + 1} direction`}
            value={pin.direction}
            onChange={(e) => patch(index, { direction: e.target.value as PinDirection })}
          >
            {PIN_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {direction}
              </option>
            ))}
          </select>
          <button
            className="library-icon-btn"
            title="Remove this pin"
            aria-label={`Remove pin ${index + 1}`}
            onClick={() => onChange(pins.filter((_, i) => i !== index))}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
            </svg>
          </button>
        </div>
      ))}
      <button
        className="btn"
        onClick={() => onChange([...pins, { number: String(pins.length + 1), name: "", direction: "passive" }])}
      >
        Add pin
      </button>
    </div>
  );
}

/**
 * The "Create" panel: build a new part with a small wizard, or import an
 * existing file into a library. Both write into the chosen category (or
 * sub-category) folder of the selected library.
 *
 * AI part generation is planned — it will use the API keys configured under
 * Settings → Services.
 */
export function CreateView() {
  const { openFsPath } = useContext(AppContext);

  const [libraries, setLibraries] = useState<LibraryEntry[]>(() => loadLibraries());
  const [libraryId, setLibraryId] = useState("");
  const [mode, setMode] = useState<"wizard" | "import">("wizard");
  const [category, setCategory] = useState<LibrarySectionId>("components");
  const [subCategory, setSubCategory] = useState("");
  const [subCategories, setSubCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard
  const [step, setStep] = useState<WizardStep>("basics");
  const [name, setName] = useState(DEFAULT_ITEM_NAMES.components);
  const [description, setDescription] = useState("");
  const [pins, setPins] = useState<PartPin[]>([{ number: "1", name: "", direction: "passive" }]);
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  // Import
  const [importSource, setImportSource] = useState("");
  const [importName, setImportName] = useState("");
  const [importedPath, setImportedPath] = useState<string | null>(null);

  useEffect(() => subscribeLibraries(setLibraries), []);

  // Keep a valid library selected.
  useEffect(() => {
    setLibraryId((current) =>
      current && libraries.some((lib) => lib.id === current) ? current : (libraries[0]?.id ?? ""),
    );
  }, [libraries]);

  const library = libraries.find((lib) => lib.id === libraryId) ?? null;

  // List the sub-category folders of the chosen category (creating the category
  // folder itself if it does not exist yet).
  useEffect(() => {
    if (!library?.path || !inTauri) {
      setSubCategories([]);
      return;
    }
    let cancelled = false;
    const path = library.path;
    (async () => {
      try {
        const categoryPath = joinPath(path, category);
        await createDir(categoryPath);
        const entries = await listDir(categoryPath);
        if (!cancelled) setSubCategories(entries.filter((entry) => entry.isDir).map((entry) => entry.name));
      } catch {
        if (!cancelled) setSubCategories([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library?.path, category]);

  // Drop a sub-category choice that no longer exists.
  useEffect(() => {
    setSubCategory((current) => (current && subCategories.includes(current) ? current : ""));
  }, [subCategories]);

  const chooseCategory = (id: LibrarySectionId) => {
    setCategory(id);
    setStep("basics"); // the Pins step only exists for components/symbols
    setName(DEFAULT_ITEM_NAMES[id]);
    setCreatedPath(null);
  };

  const targetFolder = library?.path
    ? subCategory
      ? joinPath(joinPath(library.path, category), subCategory)
      : joinPath(library.path, category)
    : null;

  const showPins = category === "components" || category === "symbols";
  const sequence: WizardStep[] = showPins ? ["basics", "pins", "review"] : ["basics", "review"];
  const stepIndex = Math.max(0, sequence.indexOf(step));
  const partName = name.trim();

  const previewContent = buildPartContent({
    kind: PART_KIND[category],
    name: partName || DEFAULT_ITEM_NAMES[category],
    description: description.trim(),
    library: library?.name ?? "",
    pins: showPins ? pins.filter((pin) => pin.name.trim() || pin.number.trim()) : [],
  });

  const createPart = async () => {
    if (!targetFolder) return;
    if (!partName) {
      setError("Enter a part name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createDir(targetFolder);
      const existing = await listDir(targetFolder);
      const path = joinPath(targetFolder, uniqueFileName(partName, ITEM_EXT, existing));
      await writeFileText(path, previewContent);
      setCreatedPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resetWizard = () => {
    setCreatedPath(null);
    setStep("basics");
    setName(DEFAULT_ITEM_NAMES[category]);
    setDescription("");
    setPins([{ number: "1", name: "", direction: "passive" }]);
  };

  const chooseImportFile = async () => {
    const path = await openFile();
    if (!path) return;
    setImportSource(path);
    setImportName(splitName(fileNameOf(path)).base);
  };

  const runImport = async () => {
    if (!targetFolder || !importSource) return;
    setBusy(true);
    setError(null);
    try {
      await createDir(targetFolder);
      const source = fileNameOf(importSource);
      const { base, ext } = splitName(source);
      const existing = await listDir(targetFolder);
      const path = joinPath(targetFolder, uniqueFileName(importName.trim() || base, ext, existing));
      await copyEntry(importSource, path);
      setImportedPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const renderSuccess = (path: string, onAgain: () => void) => (
    <div className="create-success">
      <div className="create-success-title">Part created</div>
      <div className="create-success-path" title={path}>
        {fileNameOf(path)}
      </div>
      <div className="create-nav">
        <button className="btn" onClick={() => void openFsPath(path)}>
          Open in editor
        </button>
        <button className="btn" onClick={onAgain}>
          New part
        </button>
      </div>
    </div>
  );

  const renderWizard = () => {
    if (createdPath) return renderSuccess(createdPath, resetWizard);
    return (
      <>
        <div className="create-steps">
          {sequence.map((id, i) => (
            <span
              key={id}
              className={`create-step ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
            >
              {i + 1}. {STEP_LABELS[id]}
            </span>
          ))}
        </div>

        {step === "basics" && (
          <>
            <div className="create-field">
              <label htmlFor="create-name">Name</label>
              <input
                id="create-name"
                className="settings-input"
                type="text"
                spellCheck={false}
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="create-field">
              <label htmlFor="create-desc">Description</label>
              <input
                id="create-desc"
                className="settings-input"
                type="text"
                spellCheck={false}
                placeholder="optional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </>
        )}

        {step === "pins" && <PinEditor pins={pins} onChange={setPins} />}

        {step === "review" && (
          <>
            <div className="create-field">
              <label>File</label>
              <div className="create-success-path" title={targetFolder ?? ""}>
                {targetFolder ? `${fileNameOf(targetFolder)}/${partName || "…"}${ITEM_EXT}` : "—"}
              </div>
            </div>
            <pre className="create-preview">{previewContent}</pre>
          </>
        )}

        <div className="create-nav">
          <button className="btn" disabled={stepIndex === 0} onClick={() => setStep(sequence[stepIndex - 1])}>
            Back
          </button>
          {step === "review" ? (
            <button
              className="btn settings-primary-btn"
              disabled={busy || !partName || !targetFolder}
              onClick={() => void createPart()}
            >
              Create
            </button>
          ) : (
            <button className="btn" onClick={() => setStep(sequence[stepIndex + 1])}>
              Next
            </button>
          )}
        </div>
      </>
    );
  };

  const renderImport = () => {
    if (importedPath) {
      return renderSuccess(importedPath, () => {
        setImportedPath(null);
        setImportSource("");
        setImportName("");
      });
    }
    return (
      <>
        <div className="create-field">
          <label>Source file</label>
          <div className="create-file-row">
            <input
              className="settings-input"
              type="text"
              readOnly
              placeholder="No file chosen"
              title={importSource}
              value={importSource ? fileNameOf(importSource) : ""}
            />
            <button className="btn" onClick={() => void chooseImportFile()}>
              Choose…
            </button>
          </div>
        </div>
        <div className="create-field">
          <label htmlFor="import-name">Import as</label>
          <input
            id="import-name"
            className="settings-input"
            type="text"
            spellCheck={false}
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
          />
        </div>
        <div className="create-nav">
          <button
            className="btn settings-primary-btn"
            disabled={busy || !importSource || !targetFolder}
            onClick={() => void runImport()}
          >
            Import
          </button>
        </div>
        <p className="create-hint">The file is copied into the chosen folder, keeping its own format.</p>
      </>
    );
  };

  if (!inTauri) {
    return (
      <div className="panel">
        <div className="panel-body create-panel-body">
          <p className="hint">
            Creating and importing parts needs the desktop app — run <code>npm run tauri dev</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-body create-panel-body">
        {libraries.length === 0 ? (
          <p className="hint">
            No libraries configured yet. Add the top folder of each HDL library under Settings →
            Library.
          </p>
        ) : (
          <>
            <div className="create-tabs" role="tablist" aria-label="Create mode">
              <button
                className={`create-tab ${mode === "wizard" ? "active" : ""}`}
                role="tab"
                aria-selected={mode === "wizard"}
                onClick={() => setMode("wizard")}
              >
                Wizard
              </button>
              <button
                className={`create-tab ${mode === "import" ? "active" : ""}`}
                role="tab"
                aria-selected={mode === "import"}
                onClick={() => setMode("import")}
              >
                Import
              </button>
            </div>

            <div className="create-field">
              <label htmlFor="create-library">Library</label>
              <select
                id="create-library"
                className="settings-select"
                value={libraryId}
                onChange={(e) => setLibraryId(e.target.value)}
              >
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name || "(unnamed)"}
                  </option>
                ))}
              </select>
            </div>

            <div className="create-field">
              <label htmlFor="create-category">Category</label>
              <select
                id="create-category"
                className="settings-select"
                value={category}
                onChange={(e) => chooseCategory(e.target.value as LibrarySectionId)}
              >
                {LIBRARY_SECTIONS.map((id) => (
                  <option key={id} value={id}>
                    {SECTION_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>

            <div className="create-field">
              <label htmlFor="create-subcategory">Sub-category</label>
              <select
                id="create-subcategory"
                className="settings-select"
                value={subCategory}
                onChange={(e) => setSubCategory(e.target.value)}
              >
                <option value="">(category root)</option>
                {subCategories.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="create-error">{error}</p>}

            {mode === "wizard" ? renderWizard() : renderImport()}

            <p className="create-hint">
              AI part generation is planned — it will use the API keys from Settings → Services.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
