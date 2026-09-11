# VHDL-Centric PCB Design Tool — Implementation Specification

## 1. Goal

Build a minimal command-line tool that turns a set of VHDL files describing
electronic components and a top-level design into:

- A netlist (component instances + nets + pin numbers)
- A bill of materials (BOM)
- A schematic symbol + footprint reference per instance

The tool is **VHDL-first**: all component data, pin mappings, and design
connectivity live in VHDL. No JSON, YAML, CSV, or proprietary formats are used
as the source of truth. Any auxiliary format is a one-way export.

## 2. Core Principles

1. **One file per component.** A component file contains a package (pin maps
   and metadata), an entity (logical ports), and an architecture (usually empty).
2. **Port names are the join key.** The entity's port names must match the
   literals of the component's pin enum in the package. No other linking
   mechanism exists.
3. **Pin numbers live only in pin maps**, never in the entity.
4. **Package variants are selected by a string generic** on the entity.
5. **The tool is a parser + elaborator + netlist emitter.** It does not
   simulate or synthesize.
6. **No resolution functions, no custom electrical types** in v1. Plain
   `std_logic` ports are sufficient. Electrical richness is a future extension.

## 3. Component File Format

Every component lives in a single `.vhd` file. The file MUST contain, in this
order:

1. A package named `<partname>_pkg`
2. An entity named `<PARTNAME>` (case-insensitive match to the package name
   without `_pkg`)
3. An architecture named `rtl` (may be empty)

### 3.1 Package contents

The package MUST declare:

- An enum type `<partname>_pin` whose literals are the **exact** port names
  of the entity.
- A `pin_map` array type: `array (<partname>_pin) of natural`.
- One constant of type `pin_map` per supported package variant, named
  `<PARTNAME>_<VARIANT>` (e.g. `LM358_SOIC8`).
- One constant of type `string` per variant, named
  `<PARTNAME>_<VARIANT>_FP`, holding the IPC-7351 footprint name.

The package MAY declare additional string constants for manufacturer, part
number, etc. These are collected into the BOM.

### 3.2 Entity contents

- A generic named `PACKAGE_VARIANT : string` with a default value equal to one
  of the supported variant names.
- A port clause whose port names match the enum literals exactly.

### 3.3 Architecture contents

May be empty. The tool ignores architecture bodies except to confirm the
entity is complete.

### 3.4 Reference component file

```vhdl
-- lm358.vhd
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
```

## 4. Top-Level Design File Format

The top-level design is a VHDL entity with an architecture that instantiates
components. Each instantiation MAY override `PACKAGE_VARIANT`.

```vhdl
-- board.vhd
library ieee;
use ieee.std_logic_1164.all;

entity board is
  port (
    VCC : in std_logic;
    GND : in std_logic;
    A   : in std_logic;
    B   : in std_logic;
    Y   : out std_logic
  );
end entity;

architecture rtl of board is
  signal n1 : std_logic;
begin
  U1 : entity work.LM358
    generic map (PACKAGE_VARIANT => "SOIC8")
    port map (
      IN_P => A,
      IN_N => B,
      OUT  => n1,
      VCC  => VCC,
      GND  => GND
    );

  U2 : entity work.LM358
    generic map (PACKAGE_VARIANT => "DIP8")
    port map (
      IN_P => n1,
      IN_N => B,
      OUT  => Y,
      VCC  => VCC,
      GND  => GND
    );
end architecture;
```

Rules:

- Instance labels (e.g. `U1`) become the reference designators in the netlist.
- Signals (e.g. `n1`, `VCC`, `GND`) become nets.
- Ports of the top-level entity (e.g. `A`, `B`, `Y`, `VCC`, `GND`) become
  external nets; they can be marked as off-board (connector pins) or left
  implicit.

## 5. Tool Behavior

### 5.1 Inputs

- A library directory containing component `.vhd` files.
- A top-level design `.vhd` file.

### 5.2 Pipeline

1. **Parse** every `.vhd` file in the library directory. Extract:
   - Package name, pin enum type, `pin_map` constants, `*_FP` constants,
     metadata constants.
   - Entity name, generic `PACKAGE_VARIANT`, port list.
2. **Build component database** keyed by entity name. Each entry contains:
   - `ports`: ordered list of port names.
   - `variants`: map from variant name → `{ pin_map: {port_name → pin_number},
     footprint: string }`.
   - `metadata`: map of extra string constants.
3. **Parse the top-level design.** Extract every component instantiation:
   - Instance label.
   - Entity name.
   - `PACKAGE_VARIANT` generic value (or default from the entity).
   - `port map` associations: port name → signal name.
4. **Elaborate.** For each instance:
   - Look up the component by entity name.
   - Select the variant by `PACKAGE_VARIANT`.
   - For each port in the `port map`, look up its pin number in the variant's
     `pin_map`. If a port name is missing from the pin map, emit an error.
   - Record `(refdes, signal, pin_number)` tuples.
5. **Emit outputs.**

### 5.3 Error conditions (must be reported clearly)

- Port name in entity not present in the pin enum → error.
- Variant name in the instantiation not present in the package → error.
- Duplicate entity names across library files → error.
- Instantiation of an entity not found in the library → error.
- Port in the instantiation that does not exist on the entity → error.
- Port on the entity with no `port map` association → warning (floating).

## 6. Output Formats

### 6.1 Netlist (JSON or plain text)

```json
{
  "components": [
    {
      "refdes": "U1",
      "entity": "LM358",
      "variant": "SOIC8",
      "footprint": "SOIC127P600X175-8N",
      "pins": { "IN_P": 3, "IN_N": 2, "OUT": 1, "VCC": 8, "GND": 4 }
    }
  ],
  "nets": [
    { "name": "A",   "connections": [ { "refdes": "U1", "pin": 3 } ] },
    { "name": "B",   "connections": [ { "refdes": "U1", "pin": 2 },
                                      { "refdes": "U2", "pin": 2 } ] },
    { "name": "n1",  "connections": [ { "refdes": "U1", "pin": 1 },
                                      { "refdes": "U2", "pin": 3 } ] },
    { "name": "Y",   "connections": [ { "refdes": "U2", "pin": 1 } ] },
    { "name": "VCC", "connections": [ { "refdes": "U1", "pin": 8 },
                                      { "refdes": "U2", "pin": 8 } ] },
    { "name": "GND", "connections": [ { "refdes": "U1", "pin": 4 },
                                      { "refdes": "U2", "pin": 4 } ] }
  ]
}
```

### 6.2 BOM (CSV)

Columns: `refdes, entity, variant, manufacturer, part_number, footprint, qty`.

Grouped by `(entity, variant, manufacturer, part_number)`.

### 6.3 Optional: KiCad netlist export

A one-way exporter to KiCad's `.net` format is acceptable as an add-on. It
must not become part of the internal data model.

## 7. CLI Interface

```
vhdlpcb --lib <library_dir> --top <top.vhd> --netlist out.net.json --bom out.csv
```

Flags:

- `--lib <dir>`: directory of component `.vhd` files. Repeatable.
- `--top <file>`: top-level design file.
- `--netlist <file>`: write netlist JSON.
- `--bom <file>`: write BOM CSV.
- `--kicad <file>`: optional KiCad netlist export.
- `--verbose`: print elaboration steps.
- `--strict`: treat warnings as errors.

Exit codes: `0` success, `1` parse error, `2` elaboration error, `3` I/O error.

## 8. Suggested Implementation Language and Libraries

Any language is acceptable. Recommended:

- **Python 3.10+** with a hand-written VHDL subset parser (do NOT try to
  implement full VHDL — only the subset defined in sections 3 and 4).
- Alternatively **Rust** or **Go** for a single static binary.

The parser only needs to handle:

- `package ... is ... end package;`
- `type ... is (...);`
- `type ... is array (...) of ...;`
- `constant NAME : TYPE := VALUE;`
- `entity ... is generic (...); port (...); end entity;`
- `architecture ... of ... is begin ... end architecture;`
- `LABEL : entity work.NAME generic map (...) port map (...);`
- `signal NAME : std_logic;`

Ignore everything else (comments, whitespace, `library`/`use` clauses,
`begin`/`end` inside architectures).

## 9. Implementation Phases

### Phase 1 — Parser and data model

- Parse a single component file into a `Component` struct.
- Unit test with the LM358 example.

### Phase 2 — Library loader

- Walk the library directory, parse every `.vhd`, build the component
  database.
- Detect duplicate entity names.

### Phase 3 — Top-level parser and elaborator

- Parse the top-level entity and architecture.
- Extract instantiations and `port map` associations.
- Zip ports to pins via the variant's pin map.

### Phase 4 — Output emitters

- Netlist JSON.
- BOM CSV.
- Optional KiCad netlist.

### Phase 5 — CLI and error handling

- Wire up arguments, exit codes, verbose logging.

### Phase 6 — Test suite

- A worked example: two LM358 instances in different packages, a few nets,
  expected netlist and BOM.
- Negative tests: unknown variant, missing port, duplicate entity.

## 10. Test Cases

### Test 1 — Simple elaboration

Input: the LM358 component file and the `board.vhd` example from section 4.

Expected netlist: exactly the JSON shown in section 6.1.

### Test 2 — Unknown variant

Instantiate LM358 with `PACKAGE_VARIANT => "QFN16"`. Expect exit code 2 and
the message: `Unknown variant 'QFN16' for entity LM358`.

### Test 3 — Port name mismatch

Rename the enum literal `IN_P` to `INPOS` in the package but leave the entity
port as `IN_P`. Expect exit code 2 and the message:
`Port 'IN_P' has no pin mapping in variant 'SOIC8'`.

### Test 4 — Duplicate entity

Two files both declare `entity LM358`. Expect exit code 1 and the message:
`Duplicate entity 'LM358' in files a.vhd and b.vhd`.

### Test 5 — BOM grouping

Instantiate three LM358s, two in SOIC8 and one in DIP8. Expect BOM with two
rows: one for `(LM358, SOIC8, ..., qty=2)` and one for
`(LM358, DIP8, ..., qty=1)`.

## 11. Non-Goals (v1)

- Simulation or synthesis.
- Custom electrical types (voltage, drive strength, impedance).
- Differential pair handling.
- Automatic footprint generation from IPC-7351 formulas.
- Schematic rendering.
- Hierarchical designs beyond one top level.

## 12. Extension Points (Future)

Design these so they can be added without breaking the v1 format:

- **Electrical attributes** as additional string constants in the package,
  read by the BOM emitter.
- **Differential pairs** as a `diff_pair : string` constant per port.
- **Hierarchical designs** by allowing instances of entities defined in other
  top-level files, elaborated recursively.
- **Footprint generation** by treating the `*_FP` constant as an IPC-7351
  descriptor and emitting a footprint file from it.

## 13. Acceptance Criteria

The implementation is complete when:

1. `vhdlpcb` parses the reference LM358 file and the `board.vhd` example.
2. It emits the netlist JSON shown in section 6.1.
3. It emits a BOM CSV grouped by entity and variant.
4. All five test cases in section 10 pass.
5. No source of truth exists outside VHDL files.
```

---

This spec is deliberately tight. It fixes the file format, the linking rule (port name = enum literal), the CLI, and the outputs, while leaving language and library choices to the implementer. Hand it to another LLM with "implement this" and you should get a working Phase 1–5 tool in one pass, with tests to verify.