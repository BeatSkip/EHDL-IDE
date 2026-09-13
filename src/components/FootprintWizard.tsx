import { useState } from "react";
import { createDir, listDir, writeFileText, joinPath } from "../fs";
import { uniqueFileName } from "../libraryFiles";
import { PanelDialog } from "./PanelDialog";
import {
  DENSITY_LABEL,
  FAMILY_LABEL,
  FOOTPRINT_EXT,
  defaultParams,
  footprintToSvg,
  generateFootprint,
  serializeFootprint,
} from "../ipcFootprint";
import type { IpcDensity, IpcFamily, IpcParams } from "../ipcFootprint";

const FAMILIES: IpcFamily[] = ["chip", "dual", "sot", "quad", "no-lead", "tab", "dip", "bga"];
const DENSITIES: IpcDensity[] = ["least", "nominal", "most"];

/** Short option labels — the full description is kept as the hover title. */
const FAMILY_SHORT: Record<IpcFamily, string> = {
  chip: "Two-terminal chip",
  dual: "Dual row (SOIC/TSSOP)",
  sot: "SOT-23 / SC-70",
  quad: "Quad (QFP)",
  "no-lead": "No-lead (QFN/DFN)",
  tab: "Tab + leads (DPAK/D2PAK)",
  dip: "Through-hole (DIP)",
  bga: "Ball grid (BGA)",
};

const DENSITY_SHORT: Record<IpcDensity, string> = {
  least: "Least (A)",
  nominal: "Nominal (B)",
  most: "Most (C)",
};

/** A labelled number input (mm). */
function Field({
  label,
  value,
  onChange,
  step = 0.05,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="panel-dialog-field">
      <span>{label}</span>
      <input
        className="settings-input"
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * IPC footprint wizard.
 *
 * Collects the package parameters, computes the IPC-7351 style land pattern
 * (`src/ipcFootprint.ts`), previews it and writes `<name>.fpt.ehd` into the
 * library's footprints folder. The same pad list is what tscircuit turns into
 * the underlying footprint geometry (`npm run gen:footprint`, and the built-in
 * generator once the backend regeneration command exists).
 */
export function FootprintWizard({
  libraryPath,
  onClose,
  onCreated,
}: {
  libraryPath: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const [params, setParams] = useState<IpcParams>(() => defaultParams("dual", "nominal"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const footprint = generateFootprint(params);
  const svg = footprintToSvg(footprint, 240);
  const patch = (next: Partial<IpcParams>) => setParams((current) => ({ ...current, ...next }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const dir = joinPath(libraryPath, "footprints");
      await createDir(dir);
      const base = params.partName.trim() || footprint.name.toLowerCase();
      const file = uniqueFileName(base, FOOTPRINT_EXT, await listDir(dir));
      const path = joinPath(dir, file);
      await writeFileText(path, serializeFootprint(footprint));
      onCreated(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isChip = params.family === "chip";
  const isDip = params.family === "dip";
  const isNoLead = params.family === "no-lead";
  const isTab = params.family === "tab";
  const isBga = params.family === "bga";

  return (
    <PanelDialog
      wide
      className="panel-dialog-xwide"
      title="IPC footprint wizard"
      onClose={onClose}
      onConfirm={() => {
        if (!busy) void create();
      }}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn settings-primary-btn" disabled={busy} onClick={() => void create()}>
            Create footprint
          </button>
        </>
      }
    >
      {error && <p className="create-error">{error}</p>}

      <div className="fp-layout">
        <div className="fp-form">
          <label className="panel-dialog-field">
            <span>Package family</span>
            <select
              className="settings-select"
              value={params.family}
              onChange={(e) => setParams(defaultParams(e.target.value as IpcFamily, params.density))}
            >
              {FAMILIES.map((family) => (
                <option key={family} value={family} title={FAMILY_LABEL[family]}>
                  {FAMILY_SHORT[family]}
                </option>
              ))}
            </select>
          </label>

          <label className="panel-dialog-field">
            <span>Density level</span>
            <select
              className="settings-select"
              value={params.density}
              onChange={(e) => patch({ density: e.target.value as IpcDensity })}
            >
              {DENSITIES.map((density) => (
                <option key={density} value={density} title={DENSITY_LABEL[density]}>
                  {DENSITY_SHORT[density]}
                </option>
              ))}
            </select>
          </label>

          <label className="panel-dialog-field">
            <span>File name</span>
            <input
              className="settings-input"
              type="text"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              value={params.partName}
              onChange={(e) => patch({ partName: e.target.value })}
            />
          </label>

          <label className="panel-dialog-field">
            <span>IPC family prefix</span>
            <input
              className="settings-input"
              type="text"
              spellCheck={false}
              value={params.namePrefix}
              onChange={(e) => patch({ namePrefix: e.target.value })}
            />
          </label>

          {!isChip && (
            <Field
              label={isTab ? "Lead count (tab is pin n+1)" : "Pin count"}
              step={1}
              min={2}
              value={params.count}
              onChange={(count) => patch({ count: Math.max(2, Math.round(count)) })}
            />
          )}
          {!isChip && (
            <Field
              label={isBga ? "Ball pitch (mm)" : "Pitch (mm)"}
              value={params.pitch}
              onChange={(pitch) => patch({ pitch })}
            />
          )}
          {isChip && (
            <Field
              label="Terminal-to-terminal span (mm)"
              value={params.span}
              onChange={(span) => patch({ span })}
            />
          )}
          {(params.family === "chip" || params.family === "dual" || params.family === "sot") && !isChip && (
            <Field label="Lead-tip span (mm)" value={params.span} onChange={(span) => patch({ span })} />
          )}
          <Field
            label={isBga ? "Ball diameter (mm)" : "Lead width (mm)"}
            value={params.leadWidth}
            onChange={(leadWidth) => patch({ leadWidth })}
          />
          {(params.family === "dual" || params.family === "quad" || params.family === "sot" || isNoLead || isTab) && (
            <Field
              label="Lead length (mm)"
              value={params.leadLength}
              onChange={(leadLength) => patch({ leadLength })}
            />
          )}
          {(params.family === "quad" || isNoLead || isDip || isTab || isBga) && (
            <>
              <Field
                label="Body width (mm)"
                value={params.body.width}
                onChange={(width) => patch({ body: { ...params.body, width } })}
              />
              <Field
                label="Body length (mm)"
                value={params.body.height}
                onChange={(height) => patch({ body: { ...params.body, height } })}
              />
            </>
          )}
          <Field label="Package height (mm)" value={params.height} onChange={(height) => patch({ height })} />
          {isDip && (
            <>
              <Field
                label="Lead diameter (mm)"
                value={params.leadDiameter}
                onChange={(leadDiameter) => patch({ leadDiameter })}
              />
              <Field
                label="Row spacing (mm)"
                value={params.rowSpacing}
                onChange={(rowSpacing) => patch({ rowSpacing })}
              />
            </>
          )}
          {isTab && (
            <>
              <Field
                label="Tab width (0 = derived)"
                value={params.tab.width}
                onChange={(width) => patch({ tab: { ...params.tab, width } })}
              />
              <Field
                label="Tab length (0 = derived)"
                value={params.tab.height}
                onChange={(height) => patch({ tab: { ...params.tab, height } })}
              />
            </>
          )}
          {isNoLead && (
            <>
              <Field
                label="Thermal pad width (0 = none)"
                value={params.thermalPad.width}
                onChange={(width) => patch({ thermalPad: { ...params.thermalPad, width } })}
              />
              <Field
                label="Thermal pad length (0 = none)"
                value={params.thermalPad.height}
                onChange={(height) => patch({ thermalPad: { ...params.thermalPad, height } })}
              />
            </>
          )}
        </div>

        <div className="fp-preview">
          <div className="fp-name">{footprint.name}</div>
          <div className="fp-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="fp-meta">
            {footprint.pads.length} pads · courtyard {footprint.courtyard.width}×{footprint.courtyard.height} mm
          </div>
          <div className="fp-meta">Writes {params.partName.trim() || "footprint"}{FOOTPRINT_EXT}</div>
        </div>
      </div>

      <p className="panel-dialog-hint">
        The pads are computed from IPC-7351 style joint constants — check them against the part's
        datasheet before production. tscircuit builds the underlying footprint from the same pad list
        (<code>npm run gen:footprint</code>).
      </p>
    </PanelDialog>
  );
}