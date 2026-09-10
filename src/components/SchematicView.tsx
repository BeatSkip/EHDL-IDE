import { schematicSvg } from "../generated/schematic";
import type { VhdlFile } from "../data";

/**
 * Static schematic pane. The tscircuit schematic is generated at build time
 * (scripts/generate-schematic.mjs) — nothing from tscircuit runs in the app,
 * so it cannot break loading.
 */
export function SchematicView({ file }: { file: VhdlFile }) {
  return (
    <div className="schematic-pane">
      <div className="schematic-pane-label">Schematic — {file.name} (tscircuit)</div>
      <div className="schematic-viewer-host" dangerouslySetInnerHTML={{ __html: schematicSvg }} />
    </div>
  );
}

export default SchematicView;
