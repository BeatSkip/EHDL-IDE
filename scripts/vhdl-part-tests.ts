/**
 * Tests for the VHDL component parser — the cases in section 10 of
 * `docs/vhdl-implementation.md` that concern a single component file.
 *
 * Run with: npm run test:vhdl
 * (compiled with tsc and executed by node — no test framework needed)
 */

import { parseComponentVhdl, serializeComponent } from "../src/vhdlPart";
import type { ComponentModel } from "../src/vhdlPart";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `expected ${b}, got ${a}`);
}

/** Section 3.4 — the reference component file. */
const LM358 = `-- lm358.vhd
library ieee;
use ieee.std_logic_1164.all;

package lm358_pkg is
  type lm358_pin is (IN_P, IN_N, OUT, VCC, GND);
  type pin_map is array (lm358_pin) of natural;

  constant LM358_SOIC8 : pin_map := (IN_P => 3, IN_N => 2, OUT => 1, VCC => 8, GND => 4);
  constant LM358_DIP8  : pin_map := (IN_P => 3, IN_N => 2, OUT => 1, VCC => 8, GND => 4);

  constant LM358_SOIC8_FP : string := "SOIC127P600X175-8N";
  constant LM358_DIP8_FP  : string := "DIP762W60P254L940H508Q8N";

  constant LM358_MFR        : string := "Texas Instruments";
  constant LM358_PARTNUM    : string := "LM358DR";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity LM358 is
  generic (
    PACKAGE_VARIANT : string := "SOIC8"
  );
  port (
    IN_P : in  std_logic;
    IN_N : in  std_logic;
    OUT  : out std_logic;
    VCC  : in  std_logic;
    GND  : in  std_logic
  );
end entity;

architecture rtl of LM358 is
begin
end architecture;
`;

console.log("Test 1 — simple parse of the reference component");
{
  const { model, issues } = parseComponentVhdl(LM358, "lm358");
  equal("entity name", model.name, "LM358");
  equal(
    "ports",
    model.ports.map((port) => port.name),
    ["IN_P", "IN_N", "OUT", "VCC", "GND"],
  );
  equal(
    "port directions",
    model.ports.map((port) => port.direction),
    ["in", "in", "out", "in", "in"],
  );
  equal("default variant", model.defaultVariant, "SOIC8");
  equal(
    "variants",
    model.variants.map((variant) => variant.name),
    ["SOIC8", "DIP8"],
  );
  equal("SOIC8 pin map", model.variants[0].pins, { IN_P: 3, IN_N: 2, OUT: 1, VCC: 8, GND: 4 });
  equal("DIP8 pin map", model.variants[1].pins, { IN_P: 3, IN_N: 2, OUT: 1, VCC: 8, GND: 4 });
  equal("SOIC8 footprint", model.variants[0].footprint, "SOIC127P600X175-8N");
  equal("DIP8 footprint", model.variants[1].footprint, "DIP762W60P254L940H508Q8N");
  equal("metadata", model.metadata, [
    { key: "MFR", value: "Texas Instruments" },
    { key: "PARTNUM", value: "LM358DR" },
  ]);
  equal("comments kept", model.comments, ["-- lm358.vhd"]);
  equal(
    "no errors",
    issues.filter((issue) => issue.severity === "error"),
    [],
  );
}

console.log("Round trip — graphical edits serialize back to parseable VHDL");
{
  const first = parseComponentVhdl(LM358, "lm358").model;
  const again = parseComponentVhdl(serializeComponent(first), "lm358").model;
  const shape = (model: ComponentModel) => ({
    name: model.name,
    ports: model.ports,
    variants: model.variants,
    defaultVariant: model.defaultVariant,
    metadata: model.metadata,
  });
  equal("model survives a save", shape(again), shape(first));
  equal(
    "no errors after a save",
    parseComponentVhdl(serializeComponent(first), "lm358").issues.filter(
      (issue) => issue.severity === "error",
    ),
    [],
  );
}

console.log("Test 3 — port name mismatch (enum literal renamed)");
{
  const broken = LM358.replace("type lm358_pin is (IN_P,", "type lm358_pin is (INPOS,");
  const { issues } = parseComponentVhdl(broken, "lm358");
  const messages = issues.map((issue) => issue.message);
  check(
    "reports the missing pin mapping",
    messages.includes("Port 'IN_P' has no pin mapping in variant 'SOIC8'"),
    messages.join(" | "),
  );
}

console.log("Missing pieces are reported");
{
  const { issues } = parseComponentVhdl("-- nothing here\n", "empty");
  const messages = issues.map((issue) => issue.message);
  check("no package", messages.includes("No package found in the file."));
  check("no entity", messages.includes("No entity found in the file."));
  check("no architecture", messages.includes("No architecture found in the file."));
}

console.log("Unknown variant in the generic is a warning");
{
  const broken = LM358.replace('string := "SOIC8"', 'string := "QFN16"');
  const { issues } = parseComponentVhdl(broken, "lm358");
  check(
    "warns about the default variant",
    issues.some((issue) => issue.message === "Default variant 'QFN16' is not defined in the package."),
  );
}

console.log("");
console.log(
  `${checks - failures}/${checks} checks passed${failures > 0 ? ` — ${failures} FAILED` : ""}`,
);
console.log(
  "Pending (not part of component management yet): Test 2 unknown variant at elaboration, Test 4 duplicate entity via the library loader, Test 5 BOM grouping.",
);

if (failures > 0) process.exitCode = 1;
