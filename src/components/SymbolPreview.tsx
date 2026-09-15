import { inTauri } from "../fs";
import { fileNameOf } from "../libraryFiles";
import { SymbolCanvas, useSymbolDrawing } from "./SymbolCanvas";

/**
 * The Symbol panel of the Part editor — the drawing of the symbol a part uses.
 *
 * A part is drawn by a symbol it carries inline, by the element its kind names,
 * or by a symbol program it links; the panel draws whichever of those is in
 * effect, following the part as it is edited. It is the same drawing the
 * schematic generator draws this part with in a design.
 */
export function SymbolPreview({
  symbolPath,
  source,
  origin,
  onOpen,
}: {
  /** Absolute path of the linked symbol program, or null when none is linked. */
  symbolPath: string | null;
  /** Module of a symbol the part carries itself (inline, or from its kind). */
  source?: string | null;
  /** Where the symbol comes from, shown in the heading. */
  origin?: string;
  /** Open the symbol program in the editor (linked symbols only). */
  onOpen?: () => void;
}) {
  // An inline symbol has no file to follow: the part is what is drawn, and the
  // drawing is written next to it.
  const drawing = useSymbolDrawing(symbolPath, source ?? null);
  const heading = source != null ? origin ?? "written in this file" : symbolPath ? fileNameOf(symbolPath) : "";

  return (
    <section className="part-symbol">
      <div className="part-section-head">
        <span className="part-section-title" title={symbolPath ?? heading}>
          Symbol{symbolPath || heading ? ` — ${heading}` : ""}
        </span>
        {symbolPath && source == null && onOpen && (
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
          No symbol to draw. Write one in this file, name the part's kind, or link a symbol program — the
          drawing appears here, and is the same one the schematic generator uses.
        </p>
      ) : (
        <>
          <SymbolCanvas path={symbolPath} drawing={drawing} />
          {drawing.svg && (
            <p className="part-symbol-status">
              {drawing.summary ?? "Drawn."} — follows the part as you edit it; drag to pan,
              Ctrl+wheel to zoom.
            </p>
          )}
        </>
      )}
    </section>
  );
}
