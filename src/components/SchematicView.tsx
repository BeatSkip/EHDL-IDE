import { useContext, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { AppContext } from "../appContext";
import { fileNameOf } from "../libraryFiles";
import {
  findDesignFiles,
  generateDesign,
  loadGeneratedDesign,
  outDirFor,
} from "../designGeneration";
import type { GeneratedDesign } from "../designGeneration";
import {
  schematicSvg,
  schematicNetlist,
  schematicBom,
  schematicSource,
} from "../generated/schematic";
import type { BomRow, Netlist } from "../elaborate";

type SideTab = "parts" | "nets" | "log";

/** Everything the pane needs to draw, from either source. */
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

/**
 * Schematic pane.
 *
 * The drawing comes from the backend: VHDL (component library + top-level
 * design) → elaboration → tscircuit → schematic SVG, run by
 * `scripts/generate-schematic.mjs` through the Rust `generate_schematic`
 * command. **Generate** runs it for the open project and writes
 * `<project>/generated/`; on start-up the last run is loaded from there. Until
 * a project has been generated the bundled example is shown instead.
 *
 * Interactive refinement (moving symbols, saving the layout) and the board
 * editor are the next stages; today the pane is selectable, pannable and
 * zoomable, with the elaborated parts, nets and BOM beside it.
 */
export function SchematicView({ file }: { file?: { name: string } }) {
  const { project } = useContext(AppContext);
  const projectRoot = project.kind === "folder" ? project.rootPath : null;

  const [generated, setGenerated] = useState<GeneratedDesign | null>(null);
  const [designs, setDesigns] = useState<string[]>([]);
  const [activeDesign, setActiveDesign] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("parts");

  const hostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const view: ViewData = generated ?? BUNDLED;

  // Load the project's design files and whatever was generated last time.
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
        if (loaded) setGenerated(loaded);
        else setStatus(`${outcome.output}\nNo artifacts were written to ${outcome.outDir}.`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Highlight whatever is selected in the drawing (tscircuit writes refdes and
  // net names as <text> nodes, so they can be matched by content).
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
  }, [selected, view.svg]);

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom((current) => Math.min(6, Math.max(0.2, current * (e.deltaY < 0 ? 1.12 : 0.89))));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const select = (name: string) => setSelected((current) => (current === name ? null : name));

  return (
    <div className="schematic-pane">
      <div className="schematic-toolbar">
        <span className="schematic-pane-label" title={generated ? "generated from this project" : "bundled example"}>
          Schematic — {file?.name ?? view.design} (tscircuit)
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
        <span className="schematic-zoom">{Math.round(zoom * 100)}%</span>
        <button className="btn" title="Reset pan and zoom" onClick={resetView}>
          Fit
        </button>
      </div>

      <div className="schematic-body">
        <div
          className="schematic-canvas"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="schematic-viewer-host"
            ref={hostRef}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: view.svg }}
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
              Parts ({view.netlist.components.length})
            </button>
            <button
              className={`schematic-side-tab ${sideTab === "nets" ? "active" : ""}`}
              role="tab"
              aria-selected={sideTab === "nets"}
              onClick={() => setSideTab("nets")}
            >
              Nets ({view.netlist.nets.length})
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
                <ul className="schematic-list">
                  {view.netlist.components.map((component) => (
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
                  {view.bom.map((row) => (
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
                {view.netlist.nets.map((net) => (
                  <li key={net.name}>
                    <button
                      className={`schematic-row ${selected === net.name ? "active" : ""}`}
                      onClick={() => select(net.name)}
                    >
                      <span className="schematic-row-name">{net.name}</span>
                      <span className="schematic-row-sub">
                        {net.connections
                          .map((connection) => `${connection.refdes}.${connection.pin} (${connection.port})`)
                          .join("  ·  ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {sideTab === "log" && (
              <div className="schematic-log">
                <div className="schematic-row-sub">design: {view.design}</div>
                <div className="schematic-row-mono" title={view.library}>
                  {view.library}
                </div>
                <div className="schematic-row-sub">generated: {view.generatedAt}</div>
                <div className="schematic-row-sub">
                  {generated ? `written to ${generated.outDir}` : "showing the bundled example"}
                </div>
                {status && <pre className="schematic-log-body">{status}</pre>}
                <pre className="schematic-log-body">{view.logs.join("\n")}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default SchematicView;