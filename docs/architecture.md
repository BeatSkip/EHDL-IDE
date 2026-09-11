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
| `libraryFiles.ts` | Part file naming and the provisional plain-text part format |
| `libraryIcons.tsx` | Icon set available to sub-categories |
| `fs.ts` | Thin typed wrappers over the Tauri `invoke` commands |
| `documents.ts`, `editorState.ts`, `editors.ts` | Open-document registry, per-file text store, live Monaco instance registry |
| `monacoSetup.ts` | Monaco worker + VHDL Monarch tokenizer/language config |
| `popupPosition.ts` | Measured, auto-flipping positioning for popup menus |
| `components/` | UI pieces: `MenuBar`, `ActivityBar`, `WindowControls`, `LibraryView`, `SettingsModal`, `CodeEditor`, `SchematicView`, trees/panels |

### Library manager

Libraries are top folders (path + logical VHDL name) registered under
Settings → Library. Each library exposes four sections — **components**,
**symbols**, **footprints**, **board snippets** — which are **real subfolders**
inside the library folder (created automatically if missing). The items listed
under each section are **plain-text part files** in that folder, read straight
from disk; a component, symbol, footprint or snippet is a separate file type
(they will be linked to one another later). Categories can also hold
**sub-category folders** (right-click a category → *New sub-category*); parts
and sub-categories may nest, and the tree is loaded lazily as folders expand.

Details that don't belong in a part file live in the **library manifest**,
`<library_name>.ehdlib.json`, in the library's top folder — see `libraryMeta.ts`.
It stores the library's description/notes and, per sub-category, its icon,
description and notes (keyed by the path inside the library). Deleting a
sub-category shows a warning when it still contains part files.

Add / Rename / Copy / Paste / Duplicate / Delete act on the file system through
the Rust commands (`rename_entry`, `copy_entry`, `delete_entry`); a new part is
written with `write_file`. The part file format/extension is still a
placeholder (`buildPartContent` in `libraryFiles.ts`).

### Create panel

The **Create** activity-bar tab (next to the Library Manager) builds a part
with a small wizard — type/location, name/description, pins, review — and
writes it into the chosen category or sub-category folder. The second mode
imports an existing file (native picker via `open_file_dialog`) by copying it
into the library. AI part generation is planned and will reuse the API keys
from Settings → Services.

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
