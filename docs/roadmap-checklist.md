# Roadmap checklist

A single checklist view of [roadmap.md](roadmap.md). `[x]` means it works today
in the app; items marked **(partial)** exist but are incomplete — the note says
what is missing. `[ ]` is still to do.

**Legend:** `[x]` done · `[x] (partial)` started · `[ ]` not started

Rough status: the VHDL part library, elaboration, netlist/BOM and the file
management layers are functional; the *editing* of schematics and boards is the
work that remains.

---

## 1. Backend generation

- [ ] Generate the schematic from the **open project** on demand (today: build
      time, from `examples/sample-project`)
- [x] (partial) VHDL → elaborate → **tscircuit** → circuit JSON + schematic SVG —
      the pipeline runs and is verified, but only over a bundled example
- [ ] Ship the generator with the app (bundled Node sidecar vs. requiring Node)
- [ ] Regeneration UX: on save, progress, keep the last good drawing on failure
- [ ] Layout persistence for manual refinement (tscircuit `manual_edits_file`)

## 2. The VHDL model

- [x] Component files: package (pin enum, `pin_map` variants, `*_FP`, metadata),
      entity, `rtl` architecture — parsed and canonically written (`vhdlPart.ts`)
- [x] Port names are the join key; pin numbers live only in pin maps
- [x] Package variants selected by the `PACKAGE_VARIANT` generic
- [x] Top-level design: entity ports, `signal`s, instantiations, `generic map`,
      `port map` (`vhdlDesign.ts`)
- [x] Elaboration: refdes, variant, pin numbers, nets, floating ports
      (`elaborate.ts`)
- [x] Netlist §6.1 and BOM §6.2 (+ CSV), checked against the spec's own example
- [x] Diagnostics: missing package/entity/architecture/enum/variants; port not in
      the pin enum; `Port 'X' has no pin mapping in variant 'Y'` (spec §10 Test 3
      wording); unknown entity; unknown variant; unknown port; floating port;
      duplicate entity; variant without a footprint
- [ ] Hierarchy: entities in other files, recursive elaboration, multiple
      architectures, `component` declarations
- [ ] `for … generate` statements
- [ ] Expressions and types: `'0'`/`'1'`, concatenation, constants,
      `std_logic_vector` widths, arrays, records, width checking
- [ ] Generics beyond `PACKAGE_VARIANT` (parameterised parts)
- [ ] Buses, net aliases, power/ground net classes, differential pairs
- [ ] Library resolution: `use work.<pkg>`, shared pin-map packages, library
      mapping by logical name
- [ ] Project-wide problems panel with jump-to-line
- [x] (partial) Round-trip safety: comments are preserved and re-emitted on a
      graphical save — hand-written *constructs* are still normalised

## 3. Symbols and footprints

- [x] (partial) Symbol format: a symbol **is** a tscircuit program (`xxx.ts`),
      with pins/body from the component's ports and pin map (see `docs/symbols.md`)
- [x] (partial) Symbol editor: the Part editor draws the linked symbol and follows
      edits live — a dedicated symbol editor (split source/drawing tab) is not
      written yet, and symbols are still edited in the normal text tab
- [ ] Footprint format + footprint editor (pads, drill, courtyard, silkscreen)
- [x] (partial) Footprint names come from `*_FP` and reach the netlist; `.fpt`
      files are written by the IPC wizard but are not drawn or used for boards yet
- [x] (partial) Component ↔ symbol linking: the `SYMBOL` constant, honoured by the
      schematic generator; footprint linking and "where is this used" are missing
- [x] (partial) Board snippets can be created and the layer-stack rule is
      implemented as a helper (`canHostBoard`) — applying a snippet to a board is
      not possible yet

## 4. Schematic editing

- [x] (partial) Schematic pane: pan, zoom, fit, part/net/BOM lists, build log,
      click-to-highlight, generated from the elaborated design
- [ ] Interactive editing: place/move/rotate symbols, draw and drag wires,
      junctions, labels, bus entries, multi-unit placement
- [ ] Connectivity by construction (back annotation to VHDL, or two-way editing)
- [ ] ERC: unconnected pins, no-driver/multi-driver nets, power pins, conflicting
      outputs, missing footprints
- [ ] Refdes annotation and renumbering, back annotation, DNP/alternate variants
- [ ] Cross-probe between schematic and board
- [ ] Editing ergonomics: undo/redo, grid/snapping, alignment, multi-select,
      cross-sheet copy/paste, zoom-to-fit, attribute search
- [ ] Multi-sheet schematics with hierarchical sheets and ports

## 5. Board editor

- [x] (partial) Board **files**: `.bhd` with `layers`, `stack`, description;
      created from the explorer with a layer-stack choice
- [ ] Board editor: outline, layer stack editor, rules, placement via tscircuit
- [ ] Import from the netlist: footprint instantiation, pad↔net binding,
      courtyard-aware auto-placement, ratsnest
- [ ] Routing: interactive + tscircuit autorouter, net-class widths, vias,
      teardrops, copper pour
- [ ] DRC with a violations panel
- [ ] Snippets applied to a board, honouring layer compatibility and keep-outs
- [ ] Layer stack / stackup editor with layer roles

## 6. Manufacturing output

- [ ] Gerbers + Excellon drill with per-layer preview
- [x] (partial) BOM CSV with manufacturer, part number, footprint and quantity,
      grouped per the spec
- [ ] Pick-and-place / CPL and assembly drawings
- [ ] KiCad netlist export (spec §6.3) and IPC-D-356
- [ ] One-action release bundle (gerbers, drill, BOM, CPL, stackup notes)
- [ ] Export the netlist/circuit JSON as a documented artifact (written to
      `src/generated/` today for the app, not as a user-facing export)

## 7. Project and workflow

- [x] Project handling: open a folder, create a new project, recent files,
      welcome overview
- [x] Project explorer: create (schematic file, library folder, board file, plus
      library items), copy, paste, remove
- [x] Library folders inside a project are detected and offered as
      "current project - <name>" in the Library Manager, and listed at the bottom
      of the tree with a books icon
- [x] Hidden clutter: `.ehdlib.json` manifests are hidden but editable from the
      context menu; folders with nothing in them are hidden
- [ ] Project file: default library, associated top-level design and board,
      autosave, crash recovery
- [ ] File watching: detect external edits before overwriting
- [ ] Project-wide search, go-to-definition for parts, find-usages for parts/nets
- [x] (partial) Monaco text editing with save (Ctrl+S), VHDL highlighting, and a
      graphical alternative for parts
- [ ] Undo/redo spanning editors and a consistent text-vs-graphical editing model
- [ ] Vendor sourcing through the configured services (Octopart, Digi-Key, Mouser,
      LCSC, SnapEDA, Ultra Librarian)
- [ ] AI assistance: generate a part / schematic block / board from a description

## 8. Reliability and delivery

- [x] Parser/component test suite (`npm run test:vhdl`, 19 checks incl. a
      round-trip and the spec's Test 3 message)
- [ ] Golden tests for elaboration, netlist, BOM and schematic output; end-to-end
      tests through the Tauri layer
- [ ] Performance work for hundreds of parts / thousands of nets
- [ ] Credentials in the OS keychain (API keys are plain text today)
- [x] (partial) CI on GitHub Actions: Windows build, portable zip, NSIS installer,
      release on `v*` tags
- [ ] Signed installers, auto-update, crash reporting
- [ ] Headless CLI so a design can be built in CI
- [ ] macOS and Linux support (Windows only today)

---

## Extended goals

### Simulation and verification
- [ ] Digital VHDL simulation, testbenches, waveform viewer
- [ ] Analog / mixed-signal SPICE simulation
- [ ] Co-simulation driving schematic and board from one netlist
- [ ] Equivalence checking between VHDL and the generated netlist

### Into FPGA and silicon
- [ ] Synthesis and fitting, with a pinout that drives board nets
- [ ] Timing and pin constraint file generation
- [ ] One VHDL description yielding schematic + board + bitstream, kept in sync

### Electrical engineering depth
- [ ] Impedance targets, stackup planning, length tuning, serpentines, via stitching
- [ ] DC drop, current density, copper balancing, thermal checks
- [ ] SI/PI and EMC rule checking with an IBIS model library
- [ ] Compliance checks (IPC class, creepage/clearance)

### Layout and mechanical
- [ ] HDI, microvias, blind/buried vias, flex and rigid-flex
- [ ] Multi-board systems: harnesses, mating connectors, system netlist
- [ ] Enclosure design, STEP/3D import and export, fit checks
- [ ] Panelisation, mouse bites, stencil generation

### Supply chain and costing
- [ ] Live stock, pricing and lead times
- [ ] Cost rollup across BOM variants, multi-currency
- [ ] Second-source alternates and obsolescence warnings
- [ ] Purchasing lists

### Collaboration and ecosystem
- [ ] Cloud projects and multi-user editing
- [ ] Comments and review workflows
- [ ] Plugin/extension API (rules, exporters, part sources, editors)
- [ ] Library packaging, versioning and sharing
- [ ] Reference designs, template projects, snippet/part marketplace

### Process and automation
- [ ] Headless CI recipes rebuilding netlist, BOM, gerbers and DRC reports
- [ ] Automated design review rule packs (high-speed, power, RF)
- [ ] Test-point coverage, DFT checks, JTAG/boundary-scan plans
- [ ] Lab instrument integration and bring-up checklists

### Product polish
- [ ] Localisation, accessibility, high-DPI, theming
- [ ] Licensing, entitlements, offline activation
- [ ] Update channels and in-app changelog