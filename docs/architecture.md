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
| `settings.ts` | LocalStorage-backed stores: editor settings, library registry + contents, service accounts |
| `fs.ts` | Thin typed wrappers over the Tauri `invoke` commands |
| `documents.ts`, `editorState.ts`, `editors.ts` | Open-document registry, per-file text store, live Monaco instance registry |
| `monacoSetup.ts` | Monaco worker + VHDL Monarch tokenizer/language config |
| `popupPosition.ts` | Measured, auto-flipping positioning for popup menus |
| `components/` | UI pieces: `MenuBar`, `ActivityBar`, `WindowControls`, `LibraryView`, `SettingsModal`, `CodeEditor`, `SchematicView`, trees/panels |

### Library manager

Libraries are top folders (path + logical VHDL name) registered under
Settings → Library. Each library exposes four sections — **components**,
**symbols**, **footprints**, **board snippets** — whose entries are stored per
library in `localStorage` (`ehdl.libraries`, `ehdl.libraryItems`). Item
add/rename/copy/paste/duplicate/delete all operate on this in-app registry;
folder scanning is a planned follow-up.

### Settings modal

A VS Code-style dialog with a category rail (General / Library / Keyboard
Shortcuts / Services). The Library and Services tables share the generic
`InlineGrid<T>` component (selection + inline edit + Add/Edit/Delete).

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
