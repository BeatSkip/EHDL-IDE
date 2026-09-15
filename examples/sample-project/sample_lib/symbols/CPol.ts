// CAPACITOR_10U — symbol generated from the component's ports and pins (C1206).
// This is an ordinary tscircuit program: https://docs.tscircuit.com
import { Capacitor, Chip, Circuit } from "tscircuit";

const pinLabels = {
  1: "Pos",
  2: "Neg",
} as const;

// Which pin sits on which side of the body (top to bottom).
// The body size is left to tscircuit by default — uncomment these two constants
// (and the matching schWidth/schHeight below) to pin it to the size the ports
// imply. The values are on the usual 2.54 mm grid.
// const width = 7.62;
// const height = 5.08;
const leftSide = ["Pos", "Neg"];
const rightSide = [];

/** `name` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default (circuit: Circuit, options: SymbolOptions = {}) => {
  circuit.add(
    new Capacitor({
      name: options.name ?? "CAPACITOR_10U",
      pinLabels,
      capacitance: '10u',
      polarized: true,
      // schWidth: width,
      // schHeight: height,
      schPinArrangement: { leftSide, rightSide },
      // No position on purpose: tscircuit lays the part out itself, which is what
      // a design needs. Pass schX/schY to pin it to a fixed spot.
      ...(options.schX === undefined ? {} : { schX: options.schX, schY: options.schY ?? 0 }),
    }),
  );

  // Extra drawing, in symbol coordinates (centre = 0,0), e.g.:
  // circuit.add(new SchematicLine({ x1: -3.8, y1: 0, x2: 3.8, y2: 0 }));
  // circuit.add(new SchematicText({ schX: 0, schY: -3.81, text: "CAPACITOR_10U" }));
};
