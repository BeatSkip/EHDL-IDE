/**
 * The design the schematic pane and the Parts tab show.
 *
 * The artifacts are produced outside the webview (`scripts/generate-schematic.mjs`
 * through the `generate_schematic` command); this module holds the last loaded
 * run so more than one panel can use it: the schematic pane draws it, the Parts
 * tab lists it. Loading stays in `designGeneration.ts` — `SchematicView` and the
 * Parts tab both call `showProjectDesign`, which publishes what it finds (or the
 * bundled example when a project has not been generated yet).
 */

import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { AppContext } from "./appContext";
import { inTauri } from "./fs";
import { loadGeneratedDesign, outDirFor } from "./designGeneration";
import { schematicBom, schematicNetlist, schematicSvg, schematicSource } from "./generated/schematic";
import type { BomRow, Netlist } from "./elaborate";

export interface DesignView {
  svg: string;
  netlist: Netlist;
  bom: BomRow[];
  /** Design file the artifacts came from. */
  design: string;
  library: string;
  generatedAt: string;
  logs: string[];
  /** Folder the artifacts were read from, or null for the bundled example. */
  outDir: string | null;
  /** Project the drawing belongs to (null for the bundled example). */
  projectRoot: string | null;
}

/** The schematic generated at build time — shown until a project is generated. */
export const BUNDLED: DesignView = {
  svg: schematicSvg,
  netlist: schematicNetlist as unknown as Netlist,
  bom: schematicBom as unknown as BomRow[],
  design: schematicSource.design,
  library: schematicSource.library,
  generatedAt: schematicSource.generatedAt,
  logs: schematicSource.logs as unknown as string[],
  outDir: null,
  projectRoot: null,
};

interface DesignState {
  view: DesignView;
  /** Refdes or net name highlighted in the drawing (shared by the panels). */
  selected: string | null;
  /** Output of the last generation run, shown by the Build tab. */
  status: string | null;
}

let state: DesignState = { view: BUNDLED, selected: null, status: null };

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): DesignState {
  return state;
}

function emit(next: DesignState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Show a design (the schematic pane publishes what it loaded or generated). */
export function publishDesign(view: DesignView): void {
  emit({ ...state, view });
}

/** The highlighted part or net, or null when nothing is selected. */
export function setSelectedPart(name: string | null): void {
  if (state.selected === name) return;
  emit({ ...state, selected: name });
}

/** The last generation output (or progress line) for the Build tab. */
export function publishStatus(status: string | null): void {
  if (state.status === status) return;
  emit({ ...state, status });
}

/**
 * Publish the artifacts generated for a project (its `<project>/generated`
 * folder), or the bundled example when there are none yet. Returns true when a
 * project design was found.
 */
export async function showProjectDesign(projectRoot: string | null): Promise<boolean> {
  if (!projectRoot) {
    publishDesign(BUNDLED);
    return false;
  }
  const loaded = await loadGeneratedDesign(outDirFor(projectRoot));
  publishDesign(loaded ? { ...loaded, projectRoot } : BUNDLED);
  return loaded !== null;
}

/** The design to draw and list. */
export function useDesignView(): DesignView {
  return useSyncExternalStore(subscribe, getState).view;
}

/** The shared selection (a refdes from the parts list, or a net name). */
export function useSelectedPart(): string | null {
  return useSyncExternalStore(subscribe, getState).selected;
}

/** The last generation output. */
export function useDesignStatus(): string | null {
  return useSyncExternalStore(subscribe, getState).status;
}

export interface ProjectDesign {
  view: DesignView;
  /** The open project's root, or null when no folder is open. */
  projectRoot: string | null;
  /**
   * Whether the panels have a design to show: true when the store is showing a
   * project's own artifacts, false when the project was scanned and has none,
   * null while that scan is still running. Derived from the live view, so a
   * **Generate** in the schematic pane flips it immediately.
   */
  hasProjectDesign: boolean | null;
  status: string | null;
}

/**
 * What the design panels (Parts / Nets / Build) show: the published design plus
 * — when a project is open — its own `<project>/generated` artifacts, loaded on
 * mount so the panels work even if the schematic pane was never opened.
 */
export function useProjectDesign(): ProjectDesign {
  const { project } = useContext(AppContext);
  const state = useSyncExternalStore(subscribe, getState);
  const projectRoot = project.kind === "folder" ? project.rootPath : null;
  /** Whether the current project has been scanned for generated artifacts. */
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    setScanned(false);
    void (async () => {
      await showProjectDesign(projectRoot);
      if (!cancelled) setScanned(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  const hasProjectDesign = state.view.projectRoot !== null ? true : scanned ? false : null;
  return { view: state.view, projectRoot, hasProjectDesign, status: state.status };
}
