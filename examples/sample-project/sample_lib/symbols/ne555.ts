// NE555 — symbol generated from the component's ports and pins (DIP8).
// This is an ordinary tscircuit program: https://docs.tscircuit.com
import { Chip, Circuit } from "tscircuit";

const pinLabels = {
  1: "GND",
  2: "TRIG",
  3: "OUT",
  4: "RESET",
  5: "CTRL",
  6: "THRESH",
  7: "DISCH",
  8: "VCC",
} as const;

// The body, and which pin sits on which side of it (top to bottom).
const width = 1.25;
const height = 1.75;
const leftSide = ["GND", "TRIG", "RESET", "CTRL", "THRESH", "VCC"];
const rightSide = ["OUT", "DISCH"];

/** `name` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default (circuit: Circuit, options: SymbolOptions = {}) => {
  circuit.add(
    new Chip({
      name: options.name ?? "NE555",
      pinLabels,
      schWidth: width,
      schHeight: height,
      schPinArrangement: { leftSide, rightSide },
      // No position on purpose: tscircuit lays the part out itself, which is what
      // a design needs. Pass schX/schY to pin it to a fixed spot.
      ...(options.schX === undefined ? {} : { schX: options.schX, schY: options.schY ?? 0 }),
    }),
  );

  // Extra drawing, in symbol coordinates (centre = 0,0), e.g.:
  // circuit.add(new SchematicLine({ x1: -3.8, y1: 0, x2: 3.8, y2: 0 }));
  // circuit.add(new SchematicText({ schX: 0, schY: -8.89, text: "NE555" }));
};
