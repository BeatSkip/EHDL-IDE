# Symbols

A **symbol** is how a part is drawn in a schematic. In EHDL a symbol is a
[tscircuit](https://docs.tscircuit.com) program — an ordinary TypeScript module
in the library's `symbols` folder (`<name>.ts`), so the whole tscircuit element
API is available and the tscircuit documentation applies as-is. Nothing about the
drawing is EHDL-specific.

tscircuit only runs in Node, never in the webview. The app therefore spawns the
generators in `scripts/` through the Rust commands `generate_symbol` and
`generate_schematic`, and consumes the SVG they write.

## The contract

A symbol module default-exports a function that adds the part to the circuit it
is handed:

```ts
import { Chip, Circuit } from "tscircuit";

const pinLabels = { 1: "GND", 2: "TRIG", /* … */ } as const;

/** `name` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default (circuit: Circuit, options: SymbolOptions = {}) => {
  circuit.add(
    new Chip({
      name: options.name ?? "NE555",
      pinLabels,
      schWidth: 7.62,
      schHeight: 15.24,
      schPinArrangement: { leftSide: ["GND", "TRIG"], rightSide: ["OUT", "DISCH"] },
    }),
  );
};
```

- **`options.name`** is the instance's reference designator (`U1`, `R3`, …). A
  design's wires address the part by it (`U1.TRIG`), so a symbol that hard-codes
  its own name cannot be used inside a design — the generator logs this instead
  of drawing something wrong.
- **`schPinArrangement`** uses `leftSide` / `rightSide` / `topSide` / `bottomSide`
  (pin numbers or labels), and **`schWidth`/`schHeight`** set the body. These are
  `Chip` props: it is the chip itself that gets the arranged pins.
- **Pin labels** (`pinLabels`) are the numbers → port names from the component's
  package variant, so the drawn pins are the ports the VHDL declares and the
  schematic's wires connect to the same pins the netlist uses.
- Leave `schX`/`schY` unset to let tscircuit place the part (a design needs
  that); set them to pin a drawing to a fixed spot.

The template `symbolFile.ts` writes for a new symbol already does all of this,
with the ports, pin numbers and side assignment filled in — tune it from there.
Anything else tscircuit offers can be added: `SchematicLine`, `SchematicText`,
`SchematicRect`, `SchematicPath`, `SchematicCircle`, `SchematicArc`, …

## Linking a symbol to a component

The link lives in the component file as a metadata string constant, relative to
the component file, so it survives moves between machines and is visible in the
VHDL source:

```vhdl
constant NE555_SYMBOL : string := "..\symbols\ne555.ts";
```

In the Part editor, the **Schematic symbol** section links (or unlinks) it with a
native file picker. The path is resolved with `resolveSymbolPath`
(`src/symbolFile.ts`), which handles the Windows-style separators a link may
contain on any platform.

A component without a `SYMBOL` constant still draws — the generator falls back to
a plain tscircuit body built from the elaborated pins.

## Where symbols are drawn

| Where | How |
| --- | --- |
| **Symbol program open in the editor** | the drawing half of the tab shows *that symbol* (not the design schematic), following the source as you type; symbol files open in the split view by default. Drag to pan, wheel to zoom, double-click or **Fit** to frame the symbol again |
| **Part editor → Symbol panel** | `generate-symbol.mjs` renders the linked symbol; the panel shows the SVG and redraws (debounced) while you edit the program, unsaved edits included. Pannable too — drag to move, Ctrl+wheel to zoom (plain wheel still scrolls the form) |
| **Schematic pane** | `generate-schematic.mjs` runs each component's linked symbol inside the design's circuit, so the design draws the symbol the part is linked to |
| **Build / dev** | the same design run, once, to ship `src/generated/` |

The drawing is rendered on a 1200×600 sheet with the symbol in the middle, so the
view fits the symbol's own extent (body, pins and labels) rather than the sheet —
that is why a symbol opens framed instead of tiny. One transform scales the whole
vector drawing, so it stays sharp at any zoom.

Drawing costs a Node run, so the preview is careful about when it runs: a source
that has already been drawn is not drawn again, a pause in typing (700 ms) is what
triggers a run, and runs are serialised per symbol file — while one is in flight a
newer source only replaces the pending one, so holding a key cannot pile up
processes and slow the editor. Every view of the same program (the editor pane and
the Part editor's panel) shares one renderer, so that costs one run, not two, and
the resulting SVG is committed as a low-priority update to keep typing responsive.

Generated files land in `generated/` folders next to their sources
(`<library>/symbols/generated/<name>/symbol.svg` and `source.ts` for the preview,
`<project>/generated/` for a design) and are ignored by git — they are always
reproducible from the sources.
