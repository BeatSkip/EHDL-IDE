# Roadmap — what is still missing

What stands between the current state (VHDL part library, elaboration to
netlist/BOM, a generated-then-viewable schematic, project file management) and a
package that can take a real board from idea to fabrication.

`✓` marks something partly present today, so the gap is visible at a glance.

## Where the project stands today

- VHDL component files (package / entity / architecture) with pin maps, package
  variants, `*_FP` footprints and metadata constants: parsed, checked, edited
  graphically or as text, **and test-covered**.
- Library folders with nested sub-categories, per-folder icons and notes, a
  `<library_name>.ehdlib.json` manifest, a create wizard and file import.
- Project explorer with create / copy / paste / remove, board files carrying a
  layer stack, board snippets.
- Elaboration → netlist (§6.1) and BOM (§6.2) ✓, with the §5.3 diagnostics.
- A tscircuit schematic **generated at build time** from a bundled example, shown
  in a pane with pan/zoom, part/net lists and BOM ✓ — but not yet editable, and
  not yet generated from *your* project.
- Tauri shell with file-system commands, Monaco editors, docking layout,
  welcome page, settings and service credentials ✓.

---

# First concept — the minimum for real work

The target: describe a design in VHDL, see it as a schematic, lay out a 2–4 layer
board, and hand the result to a fab house.

## 1. Backend generation actually wired up

1. **Generate from the open project on demand** — a Rust command that runs the
   generator against the project's `components/` and top-level `.vhd`, with the
   app reading the results back. Today the schematic is baked at build time from
   `examples/sample-project`.
2. **Ship the generator with the app.** Decide between requiring Node on the
   machine and bundling it as a Tauri sidecar (pkg / single-executable): a
   self-contained installer is the difference between "works on my machine" and
   "works on a colleague's".
3. **Regeneration UX** — regenerate on save, report progress, keep the previous
   drawing on failure, surface generator errors next to the source line.
4. **Layout persistence** — auto-layout is the starting point; the manual edits
   must live in a text file in the project (tscircuit `manual_edits_file`) so the
   refinement survives restarts and diffs in git.

## 2. The VHDL model, completed

5. **Hierarchy** — instances of entities in other files, recursive elaboration,
   multiple architectures, `component` declarations as well as direct entity
   instantiation.
6. **Generate statements** — `for … generate`, so arrays of channels/connectors
   are expressed once.
7. **Expressions and types** — `'0'`/`'1'`, concatenation, literals, constants,
   `std_logic_vector` with widths, arrays and records, and width checking between
   a port and the signal connected to it.
8. **Generics beyond `PACKAGE_VARIANT`** — parameterised parts (resistance, gain,
   address) that reach the BOM/schematic.
9. **Buses and net classes** — bus members, net aliases, power/ground classes,
   differential pairs (spec §12), and stable generated net names.
10. **Library resolution** — `use work.<pkg>`, shared packages for common pin
    maps, and multiple library roots mapped by logical name.
11. **Diagnostics everywhere** — every §5.3 condition, with severities, a
    project-wide problems panel, and clicking an error to jump to the line.
12. **Round-trip safety** — a graphical save currently rewrites the canonical
    file (comments are kept, nothing else is). Either make the rewrite lossless
    for hand-written constructs or make the loss explicit before saving.

## 3. Symbols and footprints — the visual layer

13. **Symbol format + symbol editor** — a symbol is a tscircuit program
    (`xxx.ts`): drawing primitives, pin placement, pin names/numbers, body
    styles, units per package (op-amps, gates); pins bound to entity port names,
    since port names are the join key. The Part editor already draws the linked
    symbol live (`docs/symbols.md`); what remains is a dedicated split
    source/drawing editor for symbol files themselves.
14. **Footprint format + footprint editor** — pads, drill, courtyard, silkscreen,
    reference/value text; manual editing plus generation from the IPC-7351 name
    already carried by `*_FP`.
15. **Three-way linking** — component (ports, variants, pin map) ↔ symbol ↔
    footprint, with a usage list per part ("where is this used"). The component ↔
    symbol half is done (the `SYMBOL` constant); footprint linking is not.
16. **Snippet application** — put a board snippet on a board, enforcing the
    layer-stack rule (a 2-layer snippet fits a 4-layer board, never the reverse).

## 4. Schematic editing

17. **Interactive editing** — place/move/rotate symbols, draw and drag wires,
    junctions, net labels, bus entries, multi-unit placement.
18. **Connectivity by construction** — editing wires re-derives the netlist;
    currently VHDL is the only source and the schematic is a rendering of it, so
    decide and implement one reconciliation direction (netlist → VHDL back
    annotation) or a two-way edit model.
19. **ERC** — unconnected pins, no-driver and multiple-driver nets, power pins
    without a source, conflicting outputs, missing footprints.
20. **Annotation** — refdes assignment and renumbering, back-annotation to the
    board, DNP/alternate variant marking.
21. **Cross-probe** — schematic ↔ board highlighting of parts and nets.
22. **Editing ergonomics** — undo/redo, grid and snapping, alignment, multi-select,
    copy/paste between sheets, zoom-to-fit, search by attribute.
23. **Multi-sheet schematics** — hierarchical sheets and ports, off-page
    connectors.

## 5. Board editor

24. **Board file format** — outline, layer stack, rules and placement expressed
    through tscircuit; a stack editor for 2/4/6/8 layers with layer roles.
25. **Import from the netlist** — footprint instantiation, pad↔net binding,
    courtyard-aware auto-placement, ratsnest, and a placement that is editable.
26. **Routing** — interactive manual routing plus the tscircuit autorouter,
    trace width per net class, vias, teardrops, copper pour with net assignment.
27. **DRC** — clearance, width, courtyard overlaps, unconnected nets, silkscreen
    over pads, drill rules — with a violations panel and jump-to-location.
28. **Snippets on a board** — geometry paste honouring the layer-stack
    compatibility rule and keep-outs.

## 6. Manufacturing output

29. **Gerbers + Excellon drill**, with a per-layer preview before export. ✓ (drawing)
30. **Pick-and-place / CPL** and assembly drawing, BOM with vendor part numbers
    (already in metadata) and quantities (✓ §6.2).
31. **KiCad netlist export** (spec §6.3) and IPC-D-356 for test.
32. **A release bundle** — one action producing gerbers, drill, BOM, CPL, stackup
    notes and a readme, zipped and versioned.

## 7. Project and workflow

33. **Project file** — default library, associated top-level design and board,
    recent projects, autosave and crash recovery.
34. **File watching** — detect external edits before overwriting the user's work.
35. **Search and navigation** — project-wide search, go-to-definition for parts,
    "find usages" for a component or net.
36. **Undo/redo across editors** and a consistent editing model for text vs.
    graphical views of the same file.
37. **Part sourcing from the services already configured** — Octopart/Digi-Key/
    Mouser/LCSC lookups filling in vendor part numbers, links and datasheets, plus
    SnapEDA/Ultra Librarian import of symbol+footprint.
38. **AI assistance** — generate a part, a schematic block or a board from a
    description using the configured keys (the Create tab already advertises it).

## 8. Reliability and delivery

39. **Tests** — the parser has a suite ✓; add golden tests for netlist, BOM,
    schematic output and every error condition, plus end-to-end tests through the
    Tauri layer.
40. **Performance** — elaboration, generation and rendering on a design with
    hundreds of parts and thousands of nets.
41. **Credential storage** — API keys are plain text in app storage today; move
    them to the OS keychain.
42. **Packaging** — signed installers, auto-update, crash reporting, and a
    headless CLI so a design can be built in CI.
43. **Cross-platform** — Windows is the only target today; macOS/Linux need the
    file-manager, dialog and path handling verified.

---

# Extended goals

The things that turn a working ECAD tool into a design *environment*.

## Simulation and verification

- Digital simulation of the VHDL, testbenches and a waveform viewer.
- Analog/mixed-signal simulation (SPICE) for the analog side of a board.
- Co-simulation of both, with the same netlist driving schematic and board.
- Equivalence checking between the VHDL description and the generated
  schematic/netlist.

## Into FPGA and silicon

- Synthesis and fitting for FPGAs, with a pinout that drives board nets.
- Constraint files (timing, pin assignment) generated from the design.
- The "ECAD using HDL" endgame: one VHDL description that yields schematic,
  board and bitstream, kept in sync.

## Electrical engineering depth

- Signal integrity: impedance targets per net class, stackup planning, length
  tuning, serpentine routing, via stitching.
- Power integrity: DC drop, current density, copper balancing, thermal checks.
- SI/PI and EMC rule checking with an IBIS model library.
- Safety/compliance checks (IPC class, creepage/clearance).

## Layout and mechanical

- Advanced stackups: HDI, microvias, blind/buried vias, flex and rigid-flex.
- Multi-board systems: harnesses, mating connectors, system-level netlist.
- Mechanical integration: enclosure design, STEP/3D import and export, fit checks.
- Panelisation and assembly: arrays, mouse bites, stencil generation.

## Supply chain and costing

- Live stock, pricing and lead times; cost rollup across BOM variants.
- Second-source alternates and lifecycle/obsolescence warnings.
- Multi-currency and purchasing lists.

## Collaboration and ecosystem

- Cloud projects, multi-user editing, comments and review workflows.
- A plugin/extension API (rules, exporters, part sources, editors) like VS Code's.
- Library packaging, versioning and sharing; reference designs and templates.
- A snippet/part marketplace with provenance and licensing metadata.

## Process and automation

- Headless CLI plus CI recipes: every commit rebuilds netlist, BOM, gerbers and
  DRC reports as artifacts.
- Automated design review: rule packs per domain (high-speed, power, RF).
- Bring-up support: test-point coverage, DFT checks, JTAG/boundary-scan plans.
- Lab integration: instrument hooks, measurement capture next to the design.

## Product polish

- Localisation, accessibility, high-DPI and theming.
- Licensing, entitlements and offline activation if it is ever sold.
- Update channels (stable/beta) and an in-app changelog.