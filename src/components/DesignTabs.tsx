import type { ReactNode } from "react";
import { setSelectedPart, useProjectDesign, useSelectedPart } from "../designStore";
import type { DesignView } from "../designStore";

/**
 * The design panels of the properties group — **Parts**, **Nets** and **Build**.
 *
 * They show the design the schematic pane draws (or, with no project open, the
 * example that ships with the build), read through `designStore.ts`. Keeping
 * them out of the schematic pane means they stay readable while the editor shows
 * something else, and they still work when the pane was never opened.
 */

/** Shared frame: the panel chrome every design tab uses. */
function DesignPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel properties">
      <div className="panel-title">{title}</div>
      <div className="panel-body design-body">{children}</div>
    </div>
  );
}

/** Shown while the open project has no generated design of its own. */
function NotGenerated({ what }: { what: string }) {
  return (
    <DesignPanel title={what}>
      <p className="hint">
        Nothing generated for this project yet, so there are no {what.toLowerCase()} to show. Open
        the schematic pane (View → Toggle Schematic Pane) and press <b>Generate</b>.
      </p>
    </DesignPanel>
  );
}

/** Which design the panels are showing. */
function DesignSource({ view }: { view: DesignView }) {
  if (!view.projectRoot) {
    return (
      <p className="schematic-hint">
        Bundled example — open a project and generate it to see its own {view.design}.
      </p>
    );
  }
  const when = view.generatedAt
    ? new Date(view.generatedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
    : "unknown";
  return (
    <p className="schematic-hint">
      {view.design} · generated {when}
    </p>
  );
}

/** Parts and BOM of the design. */
export function PartsTab() {
  const { view, projectRoot, hasProjectDesign } = useProjectDesign();
  const selected = useSelectedPart();

  if (projectRoot && hasProjectDesign === false) return <NotGenerated what="Parts" />;

  const toggle = (name: string) => setSelectedPart(selected === name ? null : name);

  return (
    <DesignPanel title="PARTS">
      <DesignSource view={view} />
      <ul className="schematic-list">
        {view.netlist.components.map((component) => (
          <li key={component.refdes}>
            <button
              className={`schematic-row ${selected === component.refdes ? "active" : ""}`}
              title="Highlight this part in the schematic drawing"
              onClick={() => toggle(component.refdes)}
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

      {view.bom.length > 0 && (
        <>
          <div className="design-section-title">BOM</div>
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
    </DesignPanel>
  );
}

/** The elaborated nets and what is connected to them. */
export function NetsTab() {
  const { view, projectRoot, hasProjectDesign } = useProjectDesign();
  const selected = useSelectedPart();

  if (projectRoot && hasProjectDesign === false) return <NotGenerated what="Nets" />;

  const toggle = (name: string) => setSelectedPart(selected === name ? null : name);

  return (
    <DesignPanel title="NETS">
      <DesignSource view={view} />
      <ul className="schematic-list">
        {view.netlist.nets.map((net) => (
          <li key={net.name}>
            <button
              className={`schematic-row ${selected === net.name ? "active" : ""}`}
              title="Highlight this net in the schematic drawing"
              onClick={() => toggle(net.name)}
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
    </DesignPanel>
  );
}

/** Where the drawing came from and what the last generation run said. */
export function BuildTab() {
  const { view, projectRoot, hasProjectDesign, status } = useProjectDesign();

  return (
    <DesignPanel title="BUILD">
      <div className="schematic-log">
        <div className="schematic-row-sub">design: {view.design}</div>
        <div className="schematic-row-mono" title={view.library}>
          {view.library}
        </div>
        <div className="schematic-row-sub">generated: {view.generatedAt || "—"}</div>
        <div className="schematic-row-sub">
          {view.outDir ? `written to ${view.outDir}` : "showing the bundled example"}
        </div>
        {projectRoot && hasProjectDesign === false && (
          <p className="hint">
            This project has not been generated yet — open the schematic pane (View → Toggle
            Schematic Pane) and press <b>Generate</b>.
          </p>
        )}
        {status && (
          <>
            <div className="design-section-title">Last run</div>
            <pre className="schematic-log-body">{status}</pre>
          </>
        )}
        <div className="design-section-title">Log</div>
        <pre className="schematic-log-body">{view.logs.join("\n")}</pre>
      </div>
    </DesignPanel>
  );
}
