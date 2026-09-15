import type { VhdlFile } from "../documents";

/** Placeholder properties panel. */
export function PropertiesPanel({ file }: { file: VhdlFile }) {
  return (
    <div className="panel properties">
      <div className="panel-title">PROPERTIES</div>
      <div className="panel-body">
        <div className="prop-row">
          <span className="prop-key">File</span>
          <span className="prop-value">{file.name}</span>
        </div>
        <p className="hint">Selection properties will appear here (planned).</p>
      </div>
    </div>
  );
}
