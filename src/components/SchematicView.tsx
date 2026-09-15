import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AppContext } from "../appContext";
import { fileNameOf } from "../libraryFiles";
import {
  findDesignFiles,
  generateDesign,
  loadGeneratedDesign,
  outDirFor,
} from "../designGeneration";
import type { GeneratedDesign } from "../designGeneration";
import { schematicSvg, schematicNetlist, schematicBom, schematicSource } from "../generated/schematic";
import type { BomRow, Netlist } from "../elaborate";

type SideTab = "parts" | "nets" | "log";

/** Viewport transform: translate then scale, origin at the top left. */
interface ViewTransform {
  x: number;
  y: number;
  /** Zoom factor (1 = drawing at its natural size). */
  k: number;
}

interface ViewData {
  svg: string;
  netlist: Netlist;
  bom: BomRow[];
  design: string;
  library: string;
  generatedAt: string;
  logs: string[];
}

/** The schematic generated at build time — shown until a project has been generated. */
const BUNDLED: ViewData = {
  svg: schematicSvg,
  netlist: schematicNetlist as unknown as Netlist,
  bom: schematicBom as unknown as BomRow[],
  design: schematicSource.design,
  library: schematicSource.library,
  generatedAt: schematicSource.generatedAt,
  logs: schematicSource.logs as unknown as string[],
};

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;
const FIT_MARGIN = 0.96;

/** The group a component is drawn in: the first ancestor group that is clearly
 *  larger than a piece of text. */
function symbolGroupFor(node: Element, host: HTMLElement): SVGGElement | null {
  let current: Element | null = node;
  while (current && current !== host) {
    if (current.tagName.toLowerCase() === "g") {
      try {
        const box = (current as SVGGElement).getBBox();
        if (box.width > 12 && box.height > 12) return current as SVGGElement;
      } catch {
        // getBBox can throw while detached — keep walking up
      }
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Schematic pane — the interactive view of the generated schematic.
 *
 * The drawing comes from the backend (VHDL → elaboration → tscircuit), run by
 * `scripts/generate-schematic.mjs` through the Rust `generate_schematic`
 * command; **Generate** writes `<project>/generated/`. Until a project has been
 * generated the bundled example is shown.
 *
 * Viewing: the drawing is fitted to the pane on open and on resize, zoom is
 * anchored at the pointer (also for trackpads), dragging pans, and a
 * double-click fits again. Everything is one viewport transform, so the vector
 * drawing stays sharp at any zoom.
 *
 * Editing: click a part to select it and drag it to move it. Those moves live
 * in this session — writing them back as tscircuit manual-edit events (so a
 * regenerate keeps the layout) is the next step, along with wire editing.
 */
export function SchematicView({ file }: { file?: { name: string } }) {
  const { project } = useContext(AppContext);
  const projectRoot = project.kind === "folder" ? project.rootPath : null;

  const [generated, setGenerated] = useState<GeneratedDesign | null>(null);
  const [designs, setDesigns] = useState<string[]>([]);
  const [activeDesign, setActiveDesign] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [movedCount, setMovedCount] = useState(0);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [sideTab, setSideTab] = useState<SideTab>("parts");

  const canvasRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  /** Natural size of the drawing, read from the SVG. */
  const drawingSize = useRef({ width: 1000, height: 700 });
  /** Manual moves, per component (this session only). */
  const offsets = useRef(new Map<string, { dx: number; dy: number }>());
  const userZoomed = useRef(false);
  const drag = useRef<
    | { mode: "pan"; startX: number; startY: number; originX: number; originY: number }
    | {
        mode: "move";
        name: string;
        group: SVGGElement;
        startX: number;
        startY: number;
        dx: number;
        dy: number;
      }
    | null
  >(null);

  const data: ViewData = generated ?? BUNDLED;

  // --- loading -------------------------------------------------------------

  useEffect(() => {
    if (!projectRoot) {
      setDesigns([]);
      setActiveDesign("");
      setGenerated(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const files = await findDesignFiles(projectRoot);
      const lastRun = await loadGeneratedDesign(outDirFor(projectRoot));
      if (cancelled) return;
      setDesigns(files);
      setActiveDesign((current) => (current && files.includes(current) ? current : (files[0] ?? "")));
      setGenerated(lastRun);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  const generate = async () => {
    if (!projectRoot || !activeDesign || busy) return;
    setBusy(true);
    setStatus(`Generating from ${fileNameOf(activeDesign)}…`);
    try {
      const outcome = await generateDesign(projectRoot, activeDesign);
      setStatus(outcome.output.trim() || (outcome.ok ? "Done." : "The generator reported a problem."));
      if (outcome.ok) {
        const loaded = await loadGeneratedDesign(outcome.outDir);
        if (loaded) {
          offsets.current.clear();
          setMovedCount(0);
          setLayoutEpoch((epoch) => epoch + 1);
          setGenerated(loaded);
        } else {
          setStatus(`${outcome.output}\nNo artifacts written to ${outcome.outDir}.`);
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // --- viewport ------------------------------------------------------------

  /** Read the drawing's natural size so it can be scaled to the canvas. */
  const measureDrawing = useCallback(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (!svg) return;
    const box = (svg as SVGSVGElement).viewBox?.baseVal;
    const width = box && box.width ? box.width : Number(svg.getAttribute("width")) || 1000;
    const height = box && box.height ? box.height : Number(svg.getAttribute("height")) || 700;
    drawingSize.current = { width, height };
    // Pin the layout size to the viewBox: the transform then does the scaling,
    // which keeps the vector sharp (a size-less SVG would be stretched instead).
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }, []);

  /** Scale the drawing to fit the pane and centre it. */
  const fitToView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw < 2 || ch < 2) return;
    const { width, height } = drawingSize.current;
    const k = Math.min(cw / width, ch / height) * FIT_MARGIN;
    setView({ k, x: (cw - width * k) / 2, y: (ch - height * k) / 2 });
    userZoomed.current = false;
  }, []);

  // Measure and fit whenever a different drawing appears (or the layout resets).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      measureDrawing();
      fitToView();
    });
    return () => cancelAnimationFrame(frame);
  }, [data.svg, layoutEpoch, measureDrawing, fitToView]);

  // Stay fitted while the pane is resized, unless the user has zoomed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!userZoomed.current) fitToView();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitToView]);

  /** Zoom about a point in canvas coordinates, keeping that point steady. */
  const zoomAt = (factor: number, px: number, py: number) => {
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
      const ratio = k / current.k;
      return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
    userZoomed.current = true;
  };

  // Wheel needs a non-passive listener, otherwise preventDefault is ignored and
  // the pane scrolls instead of zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Exponential response: smooth for both wheels and trackpads.
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  // --- picking and moving parts -------------------------------------------

  /** The component under a screen point, when it is inside a symbol. */
  const componentAt = (clientX: number, clientY: number): { name: string; group: SVGGElement } | null => {
    const host = hostRef.current;
    if (!host) return null;
    const element = document.elementFromPoint(clientX, clientY);
    if (!element || !host.contains(element)) return null;
    const group = symbolGroupFor(element, host);
    if (!group) return null;
    const names = new Set(data.netlist.components.map((component) => component.refdes));
    for (const text of group.querySelectorAll("text")) {
      const name = (text.textContent ?? "").trim();
      if (names.has(name)) return { name, group };
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("grabbing");

    const hit = componentAt(e.clientX, e.clientY);
    if (hit) {
      setSelected(hit.name);
      const offset = offsets.current.get(hit.name) ?? { dx: 0, dy: 0 };
      drag.current = {
        mode: "move",
        name: hit.name,
        group: hit.group,
        startX: e.clientX,
        startY: e.clientY,
        dx: offset.dx,
        dy: offset.dy,
      };
      return;
    }

    setSelected(null);
    drag.current = { mode: "pan", startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    if (state.mode === "pan") {
      setView((current) => ({
        ...current,
        x: state.originX + (e.clientX - state.startX),
        y: state.originY + (e.clientY - state.startY),
      }));
      return;
    }
    // Moves are stored in drawing units so they stay put at any zoom.
    const dx = state.dx + (e.clientX - state.startX) / view.k;
    const dy = state.dy + (e.clientY - state.startY) / view.k;
    state.group.setAttribute("transform", `translate(${dx} ${dy})`);
    offsets.current.set(state.name, { dx, dy });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    canvasRef.current?.classList.remove("grabbing");
    if (state?.mode === "move") setMovedCount(offsets.current.size);
  };

  const onDoubleClick = () => fitToView();

  /** Discard this session's moves by re-creating the drawing from the SVG. */
  const resetLayout = () => {
    offsets.current.clear();
    setMovedCount(0);
    setLayoutEpoch((epoch) => epoch + 1);
  };

  // --- selection highlight -------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll(".schematic-hit").forEach((el) => el.classList.remove("schematic-hit"));
    if (!selected) return;
    const needle = selected.trim().toLowerCase();
    host.querySelectorAll("text").forEach((node) => {
      if ((node.textContent ?? "").trim().toLowerCase() === needle) {
        (node.parentElement ?? node).classList.add("schematic-hit");
      }
    });
  }, [selected, data.svg, layoutEpoch, movedCount]);

  const select = (name: string) => setSelected((current) => (current === name ? null : name));

  return (
    <div className="schematic-pane">
      <div className="schematic-toolbar">
        <span
          className="schematic-pane-label"
          title={generated ? "generated from this project" : "bundled example"}
        >
          Schematic — {file?.name ?? data.design} (tscircuit)
        </span>
        {designs.length > 1 && (
          <select
            className="settings-select schematic-design-select"
            aria-label="Design file"
            value={activeDesign}
            onChange={(e) => setActiveDesign(e.target.value)}
          >
            {designs.map((design) => (
              <option key={design} value={design}>
                {fileNameOf(design)}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn"
          disabled={!projectRoot || !activeDesign || busy}
          title={
            projectRoot
              ? "Elaborate the VHDL and rebuild the schematic with tscircuit"
              : "Open a project folder first (File → Open Folder)"
          }
          onClick={() => void generate()}
        >
          {busy ? "Generating…" : "Generate"}
        </button>
        <span className="schematic-spacer" />
        {selected && <span className="schematic-selection">{selected}</span>}
        <span className="schematic-zoom" title="Wheel to zoom · drag to pan · double-click to fit">
          {Math.round(view.k * 100)}%
        </span>
        {movedCount > 0 && (
          <button className="btn" title="Undo the part moves made in this session" onClick={resetLayout}>
            Reset layout
          </button>
        )}
        <button className="btn" title="Fit the drawing to the view" onClick={fitToView}>
          Fit
        </button>
      </div>

      <div className="schematic-body">
        <div
          className="schematic-canvas"
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="schematic-viewer-host"
            key={layoutEpoch}
            ref={hostRef}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
            dangerouslySetInnerHTML={{ __html: data.svg }}
          />
        </div>

        <aside className="schematic-side">
          <div className="schematic-side-tabs" role="tablist" aria-label="Schematic details">
            <button
              className={`schematic-side-tab ${sideTab === "parts" ? "active" : ""}`}
              role="tab"
              aria-selected={sideTab === "parts"}
              onClick={() => setSideTab("parts")}
            >
              Parts ({data.netlist.components.length})
            </button>
            <button
              className={`schematic-side-tab ${sideTab === "nets" ? "active" : ""}`}
              role="tab"
              aria-selected={sideTab === "nets"}
              onClick={() => setSideTab("nets")}
            >
              Nets ({data.netlist.nets.length})
            </button>
            <button
              className={`schematic-side-tab ${sideTab === "log" ? "active" : ""}`}
              role="tab"
              aria-selected={sideTab === "log"}
              onClick={() => setSideTab("log")}
            >
              Build
            </button>
          </div>

          <div className="schematic-side-body">
            {sideTab === "parts" && (
              <>
                <p className="schematic-hint">
                  Click a part to select it, drag it to move it. Moves are kept for this session only.
                </p>
                <ul className="schematic-list">
                  {data.netlist.components.map((component) => (
                    <li key={component.refdes}>
                      <button
                        className={`schematic-row ${selected === component.refdes ? "active" : ""}`}
                        onClick={() => select(component.refdes)}
                      >
                        <span className="schematic-row-name">{component.refdes}</span>
                        <span className="schematic-row-sub">
                          {component.entity} · {component.variant}
                        </span>
                        <span className="schematic-row-sub">
                          {Object.entries(component.pins)
                            .map(([port, pin]) => `${port}=${pin}`)
                            .join(" ")}
                        </span>
                        {component.footprint && (
                          <span className="schematic-row-mono">{component.footprint}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="schematic-side-title">BOM</div>
                <ul className="schematic-list">
                  {data.bom.map((row) => (
                    <li key={`${row.entity}-${row.variant}`} className="schematic-bom-row">
                      <span className="schematic-row-name">
                        {row.qty}× {row.entity} {row.variant}
                      </span>
                      <span className="schematic-row-sub">
                        {row.manufacturer} {row.part_number}
                      </span>
                      <span className="schematic-row-sub">{row.refdes}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {sideTab === "nets" && (
              <ul className="schematic-list">
                {data.netlist.nets.map((net) => (
                  <li key={net.name}>
                    <button
                      className={`schematic-row ${selected === net.name ? "active" : ""}`}
                      onClick={() => select(net.name)}
                    >
                      <span className="schematic-row-name">{net.name}</span>
                      <span className="schematic-row-sub">
                        {net.connections
                          .map(
                            (connection) => `${connection.refdes}.${connection.pin} (${connection.port})`,
                          )
                          .join("  ·  ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {sideTab === "log" && (
              <div className="schematic-log">
                <div className="schematic-row-sub">design: {data.design}</div>
                <div className="schematic-row-mono" title={data.library}>
                  {data.library}
                </div>
                <div className="schematic-row-sub">generated: {data.generatedAt}</div>
                <div className="schematic-row-sub">
                  {generated ? `written to ${generated.outDir}` : "showing the bundled example"}
                </div>
                {status && <pre className="schematic-log-body">{status}</pre>}
                <pre className="schematic-log-body">{data.logs.join("\n")}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default SchematicView;