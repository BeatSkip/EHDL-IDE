import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import {
  schematicSvg,
  schematicNetlist,
  schematicBom,
  schematicSource,
} from "../generated/schematic";

type SideTab = "parts" | "nets" | "log";

/**
 * Schematic editor pane.
 *
 * The drawing is produced by the backend generator: VHDL (component library +
 * top-level design) → elaboration → tscircuit → schematic SVG
 * (`scripts/generate-schematic.mjs`). Nothing from tscircuit runs in the app,
 * so the webview only ever sees the finished SVG.
 *
 * The pane is interactive: pan/zoom, selection synced with the component and
 * net lists, and — because the generator also emits the elaborated netlist —
 * the schematic can be inspected pin by pin. Symbol dragging (layout
 * refinement, kept as tscircuit manual-edit events) and the board editor are
 * the next stages.
 */
export function SchematicView({ file }: { file?: { name: string } }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("parts");

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const design = schematicSource.design;

  // Highlight whatever is selected in the drawing (tscircuit writes the refdes
  // and net names as <text> nodes, so they can be matched by content).
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
  }, [selected]);

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
        <span className="schematic-pane-label" title={`generated from ${design}`}>
          Schematic — {file?.name ?? design} (tscircuit)
        </span>
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
          ref={canvasRef}
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
            dangerouslySetInnerHTML={{ __html: schematicSvg }}
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
              Parts ({schematicNetlist.components.length})
            </button>
            <button
              className={`schematic-side-tab ${sideTab === "nets" ? "active" : ""}`}
              role="tab"
              aria-selected={sideTab === "nets"}
              onClick={() => setSideTab("nets")}
            >
              Nets ({schematicNetlist.nets.length})
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
                  {schematicNetlist.components.map((component) => (
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
                  {schematicBom.map((row) => (
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
                {schematicNetlist.nets.map((net) => (
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
                <div className="schematic-row-sub">design: {design}</div>
                <div className="schematic-row-mono">{schematicSource.library}</div>
                <div className="schematic-row-sub">generated: {schematicSource.generatedAt}</div>
                <pre className="schematic-log-body">{schematicSource.logs.join("\n")}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default SchematicView;