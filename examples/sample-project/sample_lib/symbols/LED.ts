// LED_RED — symbol generated from the component's ports and pins (LED0603).
// This is an ordinary tscircuit program: https://docs.tscircuit.com
import { Led, Chip, Circuit } from "tscircuit";

const pinLabels = {
  1: "K",
  2: "A",
} as const;

// The body, and which pin sits on which side of it (top to bottom).
//const width = 7.62;
//const height = 5.08;
const leftSide = ["K", "A"];
const rightSide = [];

/** `name` is the reference designator when the symbol is drawn in a design. */
type SymbolOptions = { name?: string; schX?: number; schY?: number };

export default (circuit: Circuit, options: SymbolOptions = {}) => {
  circuit.add(
    new Led({
      name: options.name ?? "LED_RED",
      pinLabels,
      schPinArrangement: { leftSide, rightSide },
      // No position on purpose: tscircuit lays the part out itself, which is what
      // a design needs. Pass schX/schY to pin it to a fixed spot.
      ...(options.schX === undefined ? {} : { schX: options.schX, schY: options.schY ?? 0 }),
    }),
  );

  // Extra drawing, in symbol coordinates (centre = 0,0), e.g.:
  // circuit.add(new SchematicLine({ x1: -3.8, y1: 0, x2: 3.8, y2: 0 }));
  // circuit.add(new SchematicText({ schX: 0, schY: -3.81, text: "LED_RED" }));
};
