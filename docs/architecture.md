# Architecture

High-level view of how EHDL-IDE is put together.

## Process model

```
┌─────────────────────────────── Windows ───────────────────────────────┐
│  src-tauri (Rust)                          src (React/TypeScript)     │
│  ┌────────────────────┐      invoke()      ┌────────────────────────┐ │
│  │ commands:          │ ◄──────────────►  │ App / components       │ │
│  │  open_folder_dialog│                   │  - dock layout         │ │
│  │  read_dir          │   WebView2 (IPC)  │  - Monaco editor       │ │
│  │  read_file         │                   │  - library manager     │ │
│  │  write_file        │                   │  - settings modal      │ │
│  │  open_in_file_mgr  │                   └────────────────────────┘ │
│  └────────────────────┘                        ▲ embedded via        │
│                                               │ frontendDist (dist/) │
└───────────────────────────────────────────────────────────────────────┘
```

The frontend is a normal Vite app. Tauri serves the built `dist/` inside the
native window; from the frontend, filesystem access goes through `invoke()`
into the Rust commands (see `src/fs.ts` and `src-tauri/src/lib.rs`).

## Frontend layout (`src/`)

| Path | Responsibility |
| --- | --- |
| `App.tsx` | Root layout: title bar, menu bar, dock (flexlayout), status bar; window-drag handling, editor split/move actions |
| `main.tsx` | Entry point: Monaco/flexlayout/global CSS, splash fade-out, disabled native context menu |
| `recentFiles.ts` | LocalStorage list of recently opened files (Welcome view) |
| `settings.ts` | LocalStorage-backed stores: editor settings, library registry, service accounts (library contents are read from disk) |
| `designStore.ts` | The design the schematic pane draws and the Parts tab lists (plus the shared selection), so both panels show the same run |
| `libraryMeta.ts` | Reads/writes the per-library manifest (`<library_name>.ehdlib.json`) |
| `libraryFiles.ts` | Part file naming, per-category extensions and the plain-text part template |
| `symbolFile.ts` | Symbol programs: the template written for a new symbol, the `--#symbol` block a part carries, kind and link/path helpers, and the preview location |
| `vhdlPart.ts` | The VHDL component format: parser, canonical writer and checks |
| `componentLibrary.ts` | Component database: walks a library and reports spec problems |
| `libraryIcons.tsx` | Icon set available to sub-categories |
| `fs.ts` | Thin typed wrappers over the Tauri `invoke` commands |
| `documents.ts`, `editorState.ts`, `editors.ts` | Open-document registry, per-file text store, live Monaco instance registry |
| `monacoSetup.ts` | Monaco worker + VHDL Monarch tokenizer/language config |
| `popupPosition.ts` | Measured, auto-flipping positioning for popup menus |
| `components/` | UI pieces: `MenuBar`, `ActivityBar`, `WindowControls`, `LibraryView`, `SettingsModal`, `CodeEditor`, `SchematicView`, `DesignTabs`, `SymbolCanvas`, trees/panels |

### Dock layout

Three groups: the sidebar (explorer / Library Manager / Create), the editor, and
the **properties group**, which carries four tabs:

| Tab | Shows |
| --- | --- |
| **Properties** | the selection's fields (placeholder) |
| **Parts** | the parts list and BOM of the design |
| **Nets** | the elaborated nets and what is connected to them |
| **Build** | which artifacts are being drawn, the last generation run's output and the generator's log |

All three design tabs read `designStore.ts`, so they show the same run the
schematic pane draws and they work even if that pane was never opened; clicking a
part or net highlights it in the drawing. Keeping them out of the schematic pane
leaves that pane as the drawing alone, and keeps the lists readable while the
editor shows something else.

### Library manager

Libraries are top folders (path + logical VHDL name) registered under
Settings → Library. Each library exposes five sections — **components**,
**symbols**, **footprints**, **board snippets**, **templates** — which are
**real subfolders**
inside the library folder (created automatically if missing). The items listed
under each section are **plain-text part files** in that folder, read straight
from disk; a component, symbol, footprint or snippet is a separate file type
(components link their symbol with a `SYMBOL` constant — see
[symbols.md](symbols.md)). Known part extensions
(`.vhd`, `.tsx`, `.ts`, `.fpt`, `.txt`) are hidden in the tree — the category folder
already states the type — and re-applied when the row is renamed; a file with
any other extension keeps it. Categories can also hold **sub-category folders** (right-click a category *or*
a sub-category → *New sub-category*), so sub-categories nest to any depth;
parts and folders may be mixed at each level, and the tree is loaded lazily as
folders expand (search walks it, bounded to 8 levels).

Details that don't belong in a part file live in the **library manifest**,
`<library_name>.ehdlib.json`, in the library's top folder — see `libraryMeta.ts`.
It stores the library's description/notes and, per sub-category, its icon,
description and notes (keyed by the path inside the library). Deleting a
sub-category shows a warning when it still contains part files.

Add / Rename / Copy / Paste / Duplicate / Delete act on the file system through
the Rust commands (`rename_entry`, `copy_entry`, `delete_entry`); a new part is
written with `write_file`. Components are `xxx.vhd`, symbols are tscircuit React
programs `xxx.tsx`, and footprints are `xxx.fpt` (the IPC-7351 name is the file
name); the remaining categories keep the `.txt` placeholder (`SECTION_EXT` in
`libraryFiles.ts`) and their formats are still to be decided.

### Part editor

Component parts are `xxx.vhd` files (`isPartFile`); opening one — from the
library tree *or* the Create tab — mounts the **Part editor** dock tab instead
of the text/schematic editor (`openFile` picks the tab component from the path).

The file **is** the part definition and follows `vhdl-implementation.md`: a
package (`<partname>_pkg`) with the pin enum, one `pin_map` constant per package
variant plus its `*_FP` footprint constant and any extra metadata constants, an
entity whose port names match the enum literals exactly, and an `rtl`
architecture. `src/vhdlPart.ts` parses only that VHDL subset (never full VHDL)
and writes the canonical form back.

- **Graphical** — part name, ports (name + direction), package variants (name,
  IPC-7351 footprint and a pin number per port) and metadata constants such as
  `MFR`/`PARTNUM`; values that are URLs open in the browser (`open_external`),
  paths are previewed. The **Schematic symbol** section links the part to a
  symbol program and the right-hand **Symbol** panel draws it (tscircuit, run by
  the backend — see [symbols.md](symbols.md)), following edits as you type. The
  **Check** panel lists the spec's errors and warnings for the file, including
  the required wording of §10 Test 3.
- **VHDL** — the raw source in Monaco.

Comments are kept (re-emitted at the top of the file) and the architecture body
is preserved verbatim, so a graphical save doesn't throw hand-written text away.

### Editor panes

An editor document can be shown as source only, drawing only, or both side by
side (the three toolbar buttons, remembered per file). The drawing half is the
**design schematic** — except for symbol programs (`symbols/xxx.tsx`): those draw
**their own symbol** through `SymbolPane`/`SymbolCanvas` (`SymbolCanvas.tsx`),
which is the same drawing the Part editor's Symbol panel shows. A symbol view
fits the symbol's own extent (not the renderer's 1200×600 sheet) and is pannable
and zoomable: drag to pan, wheel to zoom about the pointer, double-click or
**Fit** to frame it again — the same gestures as the schematic pane. The source
is highlighted as VHDL, TypeScript or JSON according to the file name.

The library's components folder can be validated as a whole (the ✓ button in the
library toolbar): `src/componentLibrary.ts` walks it recursively, parses every
component and reports the problems from §5.3, including
`Duplicate entity 'X' in files a and b`.

Elaboration, netlist and BOM are implemented in `src/elaborate.ts` and run by the
design generator — see *Schematic pipeline* below.

### Create panel

**Create** is a dock tab in the same tabset as the Library Manager tab
(`create-tab` beside `project-tab`), added by App while the library view is
active so it reads "Library Manager | Create". It builds a part with a small
wizard — type/location, name/description, pins, review — and writes it into the
chosen category or sub-category folder. The second mode imports an existing
file (native picker via `open_file_dialog`) by copying it into the library. AI
part generation is planned and will reuse the API keys from Settings → Services.

### Settings modal

A VS Code-style dialog with a category rail (General / Library / Keyboard
Shortcuts / Services). The Library table uses `InlineGrid<T>` (selection +
inline edit + Add/Edit/Delete); the Services table is read-only and edits via
an Add-menu of service types plus an add/edit dialog.

## Rust shell (`src-tauri/`)

- `src/lib.rs` — Tauri command implementations (native folder dialog via `rfd`,
  directory listing, file read/write, reveal-in-file-manager). The file-manager
  command uses `std::process` only (no extra crates).
- `capabilities/default.json` — Tauri v2 ACL permissions (window controls used
  by the custom title bar).
- `tauri.conf.json` — product name, window settings (`decorations: false`),
  build hooks (`beforeBuildCommand` → `npm run build`), NSIS bundling.

## Schematic pipeline

`scripts/generate-schematic.mjs` → `src/generated/schematic.ts` → imported by
`SchematicView.tsx`. tscircuit runs only in Node at build time; the app ships a
static SVG string.

The generator runs the whole chain in one pass: parse the library's components
and the design (`vhdlPart.ts`, `vhdlDesign.ts`), elaborate them into a netlist,
BOM and issues (`elaborate.ts`), then draw the circuit with tscircuit and render
it with `circuit-to-svg`. Every instantiated part is drawn with the **symbol
program its component links** ([symbols.md](symbols.md)); a part without a linked
symbol is drawn from its ports alone. The variant's IPC-7351 footprint name is
*not* handed to tscircuit — that string is a footprint name, and tscircuit would
read its digits (e.g. the `762` of `DIP762W60P254L940H508Q8N`) as a pin count.
Footprints belong to the board stage, which will build them from the library's
`.fpt` files.

The same programs are run on their own for the Part editor's symbol panel:
`generate-symbol.mjs` renders one symbol file. Both scripts are spawned by the
Rust commands `generate_schematic` and `generate_symbol` (`run_generator` in
`src-tauri/src/lib.rs`), because the webview cannot run tscircuit.
