import { startTransition, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createDir, generateSymbol, inTauri, joinPath, readFileText, writeFileText } from "../fs";
import { docIdForPath } from "../documents";
import { peekEditorText, subscribeEditorText } from "../editorState";
import { SYMBOL_PREVIEW_SOURCE, SYMBOL_PREVIEW_SVG, symbolPreviewDir } from "../symbolFile";

/**
 * How long to wait after a keystroke in the symbol program before redrawing.
 * Drawing means spawning Node with tscircuit, so this is deliberately long: the
 * pause after typing is what triggers a run, not each character.
 */
const REDRAW_DELAY_MS = 700;

export interface SymbolDrawing {
  svg: string | null;
  /** The generator's own one-line summary ("drew: 1 component, 8 port"). */
  summary: string | null;
  error: string | null;
  busy: boolean;
  redraw: () => void;
}

interface Drawing {
  svg: string | null;
  summary: string | null;
  error: string | null;
  busy: boolean;
}

const EMPTY: Drawing = { svg: null, summary: null, error: null, busy: false };

/**
 * One renderer per symbol program, shared by every view that shows it — the
 * editor pane and the Part editor's panel draw the same file, and this way that
 * costs one Node run, not two.
 *
 * Runs are serialised: while one is in flight a newer source only replaces the
 * pending one, so holding a key (or typing fast) cannot pile up Node processes
 * and slow the editor down. A source that has already been drawn is not drawn
 * again.
 */
class SymbolRenderer {
  private drawing: Drawing = { ...EMPTY };
  /** Source of the last drawn (or failed) run. */
  private rendered: string | null = null;
  /** A newer source waiting for the run in flight to finish. */
  private pending: string | null = null;
  private running = false;
  private listeners = new Set<() => void>();

  constructor(private readonly path: string) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between updates, as `useSyncExternalStore` requires. */
  snapshot = (): Drawing => this.drawing;

  /** Draw `source`, unless it is already on screen or a run is in flight. */
  request(source: string, force = false): void {
    if (this.running) {
      if (source !== this.rendered) this.pending = source;
      return;
    }
    if (!force && source === this.rendered) return;
    void this.run(source);
  }

  /** The source currently on screen (or null before the first run). */
  get drawnSource(): string | null {
    return this.rendered;
  }

  /** Show a problem without running the generator (e.g. the file is gone). */
  report(error: string): void {
    this.rendered = null;
    this.update({ svg: null, summary: null, error, busy: false });
  }

  private update(drawing: Drawing): void {
    this.drawing = drawing;
    // A big SVG swap is not urgent: keep typing responsive by committing it as a
    // low-priority update.
    startTransition(() => {
      for (const listener of this.listeners) listener();
    });
  }

  private async run(source: string): Promise<void> {
    this.running = true;
    this.rendered = source;
    this.update({ ...this.drawing, busy: true, error: null });
    try {
      const outDir = symbolPreviewDir(this.path);
      await createDir(outDir);
      const previewSource = joinPath(outDir, SYMBOL_PREVIEW_SOURCE);
      await writeFileText(previewSource, source);

      const result = await generateSymbol(previewSource, outDir);
      if (!result.ok) {
        this.update({
          svg: null,
          summary: null,
          error: result.output.trim() || "The symbol generator failed.",
          busy: false,
        });
      } else {
        const svg = await readFileText(joinPath(outDir, SYMBOL_PREVIEW_SVG));
        this.update({
          svg,
          summary: result.output.split("\n").find((line) => line.startsWith("drew:"))?.trim() ?? null,
          error: null,
          busy: false,
        });
      }
    } catch (err) {
      this.update({
        svg: null,
        summary: null,
        error: err instanceof Error ? err.message : String(err),
        busy: false,
      });
    } finally {
      this.running = false;
      const next = this.pending;
      this.pending = null;
      if (next !== null && next !== this.rendered) void this.run(next);
    }
  }
}

const renderers = new Map<string, SymbolRenderer>();

function rendererFor(path: string): SymbolRenderer {
  let renderer = renderers.get(path);
  if (!renderer) {
    renderer = new SymbolRenderer(path);
    renderers.set(path, renderer);
  }
  return renderer;
}

/**
 * Draw a symbol program with the backend (`generate-symbol.mjs`).
 *
 * The source handed to the generator is the text in the editor when the program
 * is open — so an unsaved symbol draws too — and the file on disk otherwise.
 * Edits redraw after a pause, which is what makes the symbol view follow the
 * source as you type without getting in the way of typing.
 */
export function useSymbolDrawing(symbolPath: string | null): SymbolDrawing {
  const renderer = symbolPath ? rendererFor(symbolPath) : null;
  const drawing = useSyncExternalStore(
    renderer ? renderer.subscribe : noopSubscribe,
    renderer ? renderer.snapshot : emptySnapshot,
  );

  /** Draws the program as it is right now (editor text, else the file). */
  const requestDraw = useCallback(
    async (force: boolean) => {
      if (!symbolPath || !inTauri) return;
      const target = rendererFor(symbolPath);
      const fromEditor = peekEditorText(docIdForPath(symbolPath));
      if (fromEditor !== undefined) {
        target.request(fromEditor, force);
        return;
      }
      try {
        target.request(await readFileText(symbolPath), force);
      } catch (err) {
        // The file is not there (yet) — say so instead of drawing nothing.
        target.report(
          `Could not read ${symbolPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [symbolPath],
  );

  // Draw on mount / when a different symbol is opened, and follow the editor.
  useEffect(() => {
    if (!symbolPath) return;
    const timer = window.setTimeout(() => void requestDraw(false), 0);
    let debounce: number | undefined;
    const unsubscribe = subscribeEditorText(docIdForPath(symbolPath), () => {
      if (debounce !== undefined) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void requestDraw(false), REDRAW_DELAY_MS);
    });
    return () => {
      window.clearTimeout(timer);
      if (debounce !== undefined) window.clearTimeout(debounce);
      unsubscribe();
    };
  }, [symbolPath, requestDraw]);

  return { ...drawing, redraw: () => void requestDraw(true) };
}

const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

// ---- panning and zooming ---------------------------------------------------

interface ViewTransform {
  x: number;
  y: number;
  /** Zoom factor (1 = the drawing at its own pixel size). */
  k: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;
/** Share of the box the drawing fills when fitted. */
const FIT_MARGIN = 0.92;

/**
 * The symbol's own extent inside the drawing, in drawing units. The renderer
 * emits a 1200×600 sheet with the symbol in the middle, so fitting the sheet
 * would leave the symbol small — the body, its pins and its labels are what the
 * view fits instead.
 */
function symbolBox(host: HTMLDivElement | null): Box | null {
  const svg = host?.querySelector("svg");
  if (!svg) return null;

  let box: Box | null = null;
  const include = (rect: DOMRect | SVGRect) => {
    const r = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (!(r.width > 0) || !(r.height > 0)) return;
    box = box
      ? {
          x: Math.min(box.x, r.x),
          y: Math.min(box.y, r.y),
          width: Math.max(box.x + box.width, r.x + r.width) - Math.min(box.x, r.x),
          height: Math.max(box.y + box.height, r.y + r.height) - Math.min(box.y, r.y),
        }
      : r;
  };

  for (const node of svg.querySelectorAll(
    "rect.sch-component-body, text, line, path, circle, rect.sch-component-overlay",
  )) {
    try {
      include((node as SVGGraphicsElement).getBBox());
    } catch {
      // getBBox throws while detached — skip that node
    }
  }
  if (box) return box;

  const width = Number(svg.getAttribute("width")) || 1200;
  const height = Number(svg.getAttribute("height")) || 600;
  return { x: 0, y: 0, width, height };
}

/**
 * Pan/zoom for a symbol drawing: drag to pan, wheel to zoom (about the pointer),
 * double-click to fit. One viewport transform scales the whole drawing, so the
 * vector stays sharp at any zoom.
 */
function useSymbolView(svg: string, wheelZoom: "always" | "withModifier") {
  const canvasRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const content = useRef<Box>({ x: 0, y: 0, width: 1200, height: 600 });
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  /** Whether the user has panned or zoomed away from the fitted view. */
  const adjusted = useRef(false);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  /** Pin the drawing to its natural size so the transform does the scaling. */
  const measure = useCallback(() => {
    const host = hostRef.current;
    const svg = host?.querySelector("svg");
    if (!svg) return;
    const width = Number(svg.getAttribute("width")) || 1200;
    const height = Number(svg.getAttribute("height")) || 600;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    // The renderer emits no viewBox; the sheet is the drawing's own coordinate
    // space, so width/height *are* the user units.
    content.current = symbolBox(host) ?? { x: 0, y: 0, width, height };
  }, []);

  /** Scale the symbol to fit the box and centre it. */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw < 2 || ch < 2) return;
    const box = content.current;
    const k = Math.min(cw / box.width, ch / box.height) * FIT_MARGIN;
    setView({ k, x: (cw - box.width * k) / 2 - box.x * k, y: (ch - box.height * k) / 2 - box.y * k });
    adjusted.current = false;
  }, []);

  // Fit each new drawing, and re-fit on resize until the user takes over.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      measure();
      fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [svg, measure, fit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!adjusted.current) fit();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
    // Attached once the drawing (and so the viewport) exists.
  }, [fit, svg]);

  /** Zoom about a point in canvas coordinates, keeping that point steady. */
  const zoomAt = (factor: number, px: number, py: number) => {
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
      const ratio = k / current.k;
      return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
    adjusted.current = true;
  };

  // Wheel needs a non-passive listener, otherwise preventDefault is ignored.
  // `svg` is a dependency because the viewport only exists once a drawing has
  // been rendered — the listener has to be attached after that.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      if (wheelZoom === "withModifier" && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelZoom, svg]);

  // Panning with the pointer.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    setView((current) => ({
      ...current,
      x: state.originX + (e.clientX - state.startX),
      y: state.originY + (e.clientY - state.startY),
    }));
    adjusted.current = true;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  return {
    canvasRef,
    hostRef,
    content,
    view,
    fit,
    zoomAt,
    /** Fit if the user has not moved the view; used by the pane's Fit button. */
    fitted: () => !adjusted.current,
    zoomPercent: Math.round(view.k * 100),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: () => fit(),
    },
  };
}

type SymbolView = ReturnType<typeof useSymbolView>;

/** The pannable/zoomable drawing host (class names come from the caller). */
function SymbolViewport({
  svg,
  className,
  view,
}: {
  svg: string;
  className: string;
  view: SymbolView;
}) {
  return (
    <div className={className} ref={view.canvasRef} title="Drag to pan · wheel (or Ctrl+wheel) to zoom · double-click to fit" {...view.handlers}>
      <div
        className="symbol-viewport-host"
        ref={view.hostRef}
        style={{ transform: `translate(${view.view.x}px, ${view.view.y}px) scale(${view.view.k})` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

/**
 * The symbol drawing itself (no chrome) — used by the Part editor's Symbol panel
 * and by the editor tab of a symbol file, so both show the same thing.
 *
 * The drawing is pannable (drag) and zoomable (wheel, or Ctrl+wheel inside the
 * small panel so ordinary scrolling still scrolls the form); double-click fits
 * the symbol to the box again. The same gestures as the schematic pane.
 */
export function SymbolCanvas({
  path,
  drawing,
  className = "part-symbol-canvas",
  wheelZoom = "withModifier",
}: {
  path: string | null;
  drawing: SymbolDrawing;
  /** Host class: the panel's fixed box, or the editor pane's fill. */
  className?: string;
  /** "always" zooms on any wheel event; "withModifier" needs Ctrl/Cmd. */
  wheelZoom?: "always" | "withModifier";
}) {
  const view = useSymbolView(drawing.svg ?? "", wheelZoom ?? "withModifier");
  if (!path) return null;
  if (drawing.error) return <p className="part-symbol-error">{drawing.error}</p>;
  if (!drawing.svg) {
    return (
      <p className="part-empty">
        {!inTauri
          ? "Symbols are drawn by the desktop app (Node + tscircuit)."
          : drawing.busy
            ? "Drawing…"
            : "No drawing yet."}
      </p>
    );
  }
  return <SymbolViewport svg={drawing.svg} className={className} view={view} />;
}

/**
 * The editor pane for a symbol program: the drawing of that one symbol — not the
 * design schematic, which is what every other document shows. Drag to pan, wheel
 * to zoom, double-click (or **Fit**) to frame the symbol again.
 */
export function SymbolPane({ path, name }: { path: string | null; name: string }) {
  const drawing = useSymbolDrawing(path);
  // The pane is the only thing in its tab, so the wheel can zoom directly.
  const view = useSymbolView(drawing.svg ?? "", "always");

  return (
    <div className="symbol-pane">
      <div className="schematic-toolbar">
        <span className="schematic-pane-label" title={path ?? ""}>
          Symbol — {name} (tscircuit)
        </span>
        <span className="schematic-spacer" />
        {drawing.summary && <span className="schematic-selection">{drawing.summary}</span>}
        {drawing.svg && (
          <span className="schematic-zoom" title="Wheel to zoom · drag to pan · double-click to fit">
            {view.zoomPercent}%
          </span>
        )}
        <button
          className="btn"
          disabled={!drawing.svg}
          title="Fit the symbol to the view"
          onClick={view.fit}
        >
          Fit
        </button>
        <button
          className="btn"
          disabled={!path || !inTauri || drawing.busy}
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
      <div className="symbol-pane-body">
        {drawing.error ? (
          <p className="part-symbol-error">{drawing.error}</p>
        ) : drawing.svg ? (
          <SymbolViewport svg={drawing.svg} className="symbol-pane-canvas" view={view} />
        ) : (
          <p className="part-empty">
            {!inTauri
              ? "Symbols are drawn by the desktop app (Node + tscircuit)."
              : drawing.busy
                ? "Drawing…"
                : "No drawing yet."}
          </p>
        )}
      </div>
    </div>
  );
}
