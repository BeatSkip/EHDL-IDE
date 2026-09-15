# Symbols

A **symbol** is how a part is drawn in a schematic. In EHDL a symbol is a
[tscircuit](https://docs.tscircuit.com) **React** program — the same elements the
tscircuit documentation uses (`<chip>`, `<led>`, `<capacitor>`, `<resistor>`,
`<diode>`, …), so the tscircuit documentation applies as-is. Nothing about the
drawing is EHDL-specific.

```tsx
// A symbol module: a React component, given the instance's designator.
import type { ReactElement } from "react";

type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default ({ name }: SymbolOptions): ReactElement => (
  <chip name={name ?? "NE555"} pinLabels={{ 1: "GND", 2: "TRIG" }} />
);
```

tscircuit only runs in Node, never in the webview. The app therefore spawns the
generators in `scripts/` through the Rust commands `generate_symbol` and
`generate_schematic`, and consumes the SVG they write. `scripts/lib/symbol-module.mjs`
compiles the TSX and runs it against the React copy tscircuit itself uses.

## Where a part's symbol comes from

Asked in this order — the first that applies wins:

| | Source | Written as |
| --- | --- | --- |
| 1 | **In the component file** | a `--#symbol … --#/symbol` comment block (below) |
| 2 | **The part's kind** | `constant LED_RED_SYMBOL_KIND : string := "led";` |
| 3 | **A linked symbol module** | `constant LED_RED_SYMBOL : string := "..\symbols\LED.tsx";` |
| 4 | **The part's name** | nothing — a two-pin LED / capacitor / resistor / diode is drawn with the matching element |
| 5 | **Its ports** | nothing — a plain chip body with the ports and pin numbers |

The Part editor shows which one is in effect, draws it in the **Symbol** panel,
and offers all of them: *Write in file*, *Link a file…* and the **Element**
selector. A `SYMBOL` constant holding the name of an element (`"led"`) is read
as a kind, so the one-line form works without a second constant.

### A symbol inside the component

A part can carry its own symbol in a comment block, so the part *is* its symbol
and nothing else has to travel with it:

```vhdl
--#symbol
-- import type { ReactElement } from "react";
--
-- // tscircuit draws a led with the anode on pin 1, and this package puts the
-- // cathode there — so the labels come from the part's ports, not the numbers.
-- export default ({ name }: SymbolOptions): ReactElement => (
--   <led name={name ?? "LED_RED"} pinLabels={{ 1: "A", 2: "K" }} color="red" />
-- );
--#/symbol
```

The block is a VHDL comment, so every tool that reads the part ignores it; each
line between the delimiters loses one `--` and becomes a line of the React
module. The Part editor keeps the block when it rewrites the file from the
graphical view, and *Write in file* writes the symbol the part implies (ports,
pin numbers and side assignment filled in) as a starting point.

## The contract

- **`name`** is the instance's reference designator (`U1`, `R3`, …). A design's
  wires address the part by it (`U1.TRIG`), so a symbol that ignores it cannot be
  used inside a design — the generator logs this instead of drawing something
  wrong. Use `name={name ?? "NE555"}` so the symbol also draws on its own.
- **Pins.** `pinLabels` labels the pins of a chip or a diode/LED; the numbers are
  the part's package pin numbers, from the variant's `pin_map`:

  ```tsx
  <chip pinLabels={{ 1: "GND", 2: "TRIG" }} schPinArrangement={{ leftSide: ["GND"], rightSide: ["TRIG"] }} />
  ```

  tscircuit's `<led>`/`<diode>` have the anode on pin 1 and the cathode on pin 2.
  A package that puts the cathode on pin 1 (what chip LEDs do) is written the
  other way round — `pinLabels={{ 1: "A", 2: "K" }}` — so the drawn diode points
  the way the part conducts. `<resistor>` and `<capacitor>` have no port names of
  their own: their pins stay numbered, and the schematic reaches them by the
  part's pin numbers.
- **The design's wires** use a port name when the symbol exposes one and the pin
  number when it does not, so both `U1.TRIG` and `C1.1` connect. A port the
  symbol does not draw at all is reported in the build log.
- **Values** for `<resistor>`/`<capacitor>` come from the part's `VALUE` constant
  (`?` when it has none), and an LED's `color` from `COLOR`.
- **`schPinArrangement`** uses `leftSide` / `rightSide` / `topSide` / `bottomSide`
  (pin numbers or labels), and **`schWidth`/`schHeight`** set the body. The
  generated template leaves the size to tscircuit — its `width`/`height`
  constants and the matching `schWidth`/`schHeight` lines are commented out, so
  the body is drawn to fit the pins; uncomment all four to pin it.
- Leave `schX`/`schY` unset to let tscircuit place the part (a design needs
  that); set them to pin a drawing to a fixed spot.
- Anything else tscircuit offers can be added: `<schematicline>`,
  `<schematictext>`, `<schematicrect>`, `<schematicpath>`, `<schematiccircle>`,
  `<schematicarc>`, …

The template the app writes for a new symbol fills all of this in — ports, pin
numbers, sides, and the element its name or kind implies.

## Linking a symbol module to a component

The link lives in the component file as a metadata string constant, relative to
the component file, so it survives moves between machines and is visible in the
VHDL source:

```vhdl
constant NE555_SYMBOL : string := "..\symbols\ne555.tsx";
```

In the Part editor, the **Schematic symbol** section links (or unlinks) it with a
native file picker. The path is resolved with `resolveSymbolPath`
(`src/symbolFile.ts`), which handles the Windows-style separators a link may
contain on any platform.

A component without a `SYMBOL` constant still draws — with the element its kind
names, or a plain body built from the elaborated pins.

## Where symbols are drawn

| Where | How |
| --- | --- |
| **Symbol module open in the editor** | the drawing half of the tab shows *that symbol* (not the design schematic), following the source as you type; symbol files open in the split view by default. Drag to pan, wheel to zoom, double-click or **Fit** to frame the symbol again |
| **Part editor → Symbol panel** | the part's symbol is drawn — the block it carries, the element its kind names, or the module it links — and redraws (debounced) as the part is edited. Pannable too |
| **Schematic pane** | `generate-schematic.mjs` runs each component's symbol inside the design's circuit, so the design draws the symbol the part is linked to |
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
(`<library>/symbols/generated/<name>/symbol.svg` and `source.tsx` for the preview,
`<project>/generated/` for a design) and are ignored by git — they are always
reproducible from the sources.
