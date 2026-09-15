import { inTauri } from "../fs";
import { fileNameOf } from "../libraryFiles";
import { SymbolCanvas, useSymbolDrawing } from "./SymbolCanvas";

/**
 * The Symbol panel of the Part editor — the drawing of the symbol a part links.
 *
 * The drawing comes from the backend (see `SymbolCanvas`), follows the symbol
 * program as it is edited, and is the same drawing the schematic generator uses
 * for this part in a design.
 */
export function SymbolPreview({
  symbolPath,
  onOpen,
}: {
  /** Absolute path of the linked symbol program, or null when none is linked. */
  symbolPath: string | null;
  /** Open the symbol program in the editor. */
  onOpen?: () => void;
}) {
  const drawing = useSymbolDrawing(symbolPath);

  return (
    <section className="part-symbol">
      <div className="part-section-head">
        <span className="part-section-title" title={symbolPath ?? ""}>
          Symbol{symbolPath ? ` — ${fileNameOf(symbolPath)}` : ""}
        </span>
        {symbolPath && onOpen && (
          <button className="btn" title="Open the symbol program in the editor" onClick={onOpen}>
            Open
          </button>
        )}
        <button
          className="btn"
          disabled={!symbolPath || !inTauri || drawing.busy}
          title={
            inTauri
              ? "Draw the symbol again with tscircuit"
              : "Drawing the symbol needs the desktop app (Node + tscircuit)"
          }
          onClick={drawing.redraw}
        >
          {drawing.busy ? "Drawing…" : "Redraw"}
        </button>
      </div>

      {!symbolPath ? (
        <p className="part-empty">
          No symbol linked. Link a symbol program and its drawing appears here — the same program the
          schematic generator draws this part with.
        </p>
      ) : (
        <>
          <SymbolCanvas path={symbolPath} drawing={drawing} />
          {drawing.svg && (
            <p className="part-symbol-status">
              {drawing.summary ?? "Drawn."} — follows the program as you edit it; drag to pan,
              Ctrl+wheel to zoom.
            </p>
          )}
        </>
      )}
    </section>
  );
}
