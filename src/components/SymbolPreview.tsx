import { useCallback, useEffect, useRef, useState } from "react";
import { createDir, generateSymbol, inTauri, joinPath, readFileText, writeFileText } from "../fs";
import { docIdForPath } from "../documents";
import { peekEditorText, subscribeEditorText } from "../editorState";
import { SYMBOL_PREVIEW_SOURCE, SYMBOL_PREVIEW_SVG, symbolPreviewDir } from "../symbolFile";
import { fileNameOf } from "../libraryFiles";

/** How long to wait after a keystroke in the symbol program before redrawing. */
const REDRAW_DELAY_MS = 500;

/**
 * The symbol drawing for a part — the visual half of the Part editor.
 *
 * The drawing comes from the backend (`generate-symbol.mjs`): the symbol program
 * is run with tscircuit and the result is shown as an SVG. The source handed to
 * the generator is the text in the editor when the program is open (so an
 * unsaved symbol draws too) and the file on disk otherwise, which means this is
 * exactly what a design will draw for the part.
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
  const [svg, setSvg] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Guards against an older run overwriting a newer one. */
  const runId = useRef(0);

  const draw = useCallback(async () => {
    if (!symbolPath || !inTauri) return;
    const id = (runId.current += 1);
    setBusy(true);
    setError(null);
    try {
      const outDir = symbolPreviewDir(symbolPath);
      // Unsaved edits win: the preview follows the symbol editor as you type.
      const fromEditor = peekEditorText(docIdForPath(symbolPath));
      const source = fromEditor ?? (await readFileText(symbolPath));

      await createDir(outDir);
      const previewSource = joinPath(outDir, SYMBOL_PREVIEW_SOURCE);
      await writeFileText(previewSource, source);

      const result = await generateSymbol(previewSource, outDir);
      if (id !== runId.current) return;
      if (!result.ok) {
        setSvg(null);
        setSummary(null);
        setError(result.output.trim() || "The symbol generator failed.");
        return;
      }

      const drawing = await readFileText(joinPath(outDir, SYMBOL_PREVIEW_SVG));
      if (id !== runId.current) return;
      setSvg(drawing);
      setSummary(result.output.split("\n").find((line) => line.startsWith("drew:"))?.trim() ?? null);
    } catch (err) {
      if (id !== runId.current) return;
      setSvg(null);
      setSummary(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }, [symbolPath]);

  // Draw on mount and whenever a different symbol is linked.
  useEffect(() => {
    if (!symbolPath) {
      setSvg(null);
      setSummary(null);
      setError(null);
      return;
    }
    void draw();
  }, [symbolPath, draw]);

  // Redraw (debounced) while the symbol program is edited.
  useEffect(() => {
    if (!symbolPath) return;
    let timer: number | undefined;
    const unsubscribe = subscribeEditorText(docIdForPath(symbolPath), () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), REDRAW_DELAY_MS);
    });
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [symbolPath, draw]);

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
          disabled={!symbolPath || !inTauri || busy}
          title={
            inTauri
              ? "Draw the symbol again with tscircuit"
              : "Drawing the symbol needs the desktop app (Node + tscircuit)"
          }
          onClick={() => void draw()}
        >
          {busy ? "Drawing…" : "Redraw"}
        </button>
      </div>

      {!symbolPath ? (
        <p className="part-empty">
          No symbol linked. Link a symbol program and its drawing appears here — the same program the
          schematic generator draws this part with.
        </p>
      ) : error ? (
        <p className="part-symbol-error">{error}</p>
      ) : svg ? (
        <>
          <div className="part-symbol-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="part-symbol-status">
            {summary ?? "Drawn."} — follows the symbol program as you edit it.
          </p>
        </>
      ) : (
        <p className="part-empty">
          {!inTauri
            ? "The symbol is drawn by the desktop app (Node + tscircuit)."
            : busy
              ? "Drawing…"
              : "No drawing yet."}
        </p>
      )}
    </section>
  );
}
