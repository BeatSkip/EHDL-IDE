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
| `settings.ts` | LocalStorage-backed stores: editor settings, library registry, service accounts (library contents are read from disk) |
| `libraryMeta.ts` | Reads/writes the per-library manifest (`<library_name>.ehdlib.json`) |
| `libraryFiles.ts` | Part file naming, per-category extensions and the plain-text part template |
| `vhdlPart.ts` | The VHDL component format: parser, canonical writer and checks |
| `componentLibrary.ts` | Component database: walks a library and reports spec problems |
| `libraryIcons.tsx` | Icon set available to sub-categories |
| `fs.ts` | Thin typed wrappers over the Tauri `invoke` commands |
| `documents.ts`, `editorState.ts`, `editors.ts` | Open-document registry, per-file text store, live Monaco instance registry |
| `monacoSetup.ts` | Monaco worker + VHDL Monarch tokenizer/language config |
| `popupPosition.ts` | Measured, auto-flipping positioning for popup menus |
| `components/` | UI pieces: `MenuBar`, `ActivityBar`, `WindowControls`, `LibraryView`, `SettingsModal`, `CodeEditor`, `SchematicView`, trees/panels |

### Library manager

Libraries are top folders (path + logical VHDL name) registered under
Settings → Library. Each library exposes five sections — **components**,
**symbols**, **footprints**, **board snippets**, **templates** — which are
**real subfolders**
inside the library folder (created automatically if missing). The items listed
under each section are **plain-text part files** in that folder, read straight
from disk; a component, symbol, footprint or snippet is a separate file type
(they will be linked to one another later). Known part extensions
(`.prt.ehd`, `.sym.ehd`, `.txt`) are hidden in the tree — the category folder
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
written with `write_file`. Components are `xxx.prt.ehd`, symbols `xxx.sym.ehd`;
the other categories keep the `.txt` placeholder (`SECTION_EXT` in
`libraryFiles.ts`) and their formats are still to be decided.

### Part editor

Component parts are `xxx.prt.ehd` files (`isPartFile`); opening one — from the
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
  paths are previewed. The right-hand **Check** panel lists the spec's errors
  and warnings for the file, including the required wording of §10 Test 3.
- **VHDL** — the raw source in Monaco.

Comments are kept (re-emitted at the top of the file) and the architecture body
is preserved verbatim, so a graphical save doesn't throw hand-written text away.
Symbol files (`.sym.ehd`) still open in the normal text editor — the symbol
editor is not written yet.

The library's components folder can be validated as a whole (the ✓ button in the
library toolbar): `src/componentLibrary.ts` walks it recursively, parses every
component and reports the problems from §5.3, including
`Duplicate entity 'X' in files a and b`.

The elaboration, netlist and BOM stages (Phases 3–5 of the spec) are not
implemented yet.

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
