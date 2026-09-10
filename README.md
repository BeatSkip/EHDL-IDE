# EHDL-IDE

**EHDL — ECAD using HDL.** An open-source electronics CAD IDE built around
describing a design in **VHDL** and flowing it through to schematic and, later,
PCB. This repository is the native desktop application: a **Tauri 2** shell
(a thin Rust host that opens **WebView2** in a normal Windows window) wrapping a
**Vite + React + TypeScript** frontend, styled like **Visual Studio Code**.

> Status: active early skeleton. The UI, file explorer, VHDL editor, library
> manager and settings are in place; HDL parsing and schematic/PCB generation
> are the next milestones.

## Features (current)

- **VS Code-style UI** — docking layout (flexlayout-react), title bar with menu
  bar (File / Edit / View / Help), activity bar, status bar, custom window
  controls.
- **VHDL editor** — Monaco (the editor behind VS Code) with a VHDL Monarch
  tokenizer; editor groups can be split left/right and documents moved between
  groups.
- **File explorer** — opens a real folder through a native dialog and reads/
  writes files on disk (Tauri commands). Falls back to a bundled sample project
  in a plain browser.
- **Inline schematic pane** — a build-time-generated tscircuit schematic (the
  tscircuit/WebView2 runtime issue is sidestepped by rendering a static SVG).
- **Library manager** — register library folders (path + logical name), then
  organize **components / symbols / footprints / board snippets** per library
  with search (comma-separated OR terms), copy/paste/duplicate/rename/delete.
- **Settings** — General (theme, editor font size, word wrap), Library registry,
  **Keyboard Shortcuts** reference, and **Services** (accounts + API keys).

## Tech stack

| Layer | Technology |
| --- | --- |
| Shell | [Tauri 2](https://tauri.app) (Rust) → WebView2 on Windows |
| Frontend | Vite + React 18 + TypeScript |
| Editor | [Monaco](https://microsoft.github.io/monaco-editor/) |
| Docking | [flexlayout-react](https://github.com/caplin-io-ag/flexlayout-react) |
| Schematic | [tscircuit](https://tscircuit.com) + `circuit-to-svg` (build-time) |

## Getting started

See **[docs/development.md](docs/development.md)** for a full local setup guide.

```bash
# prerequisites: Node 18+, and Rust/cargo for the native shell
npm install
npm run tauri dev      # native window (frontend served by Vite)
```

```bash
npm run dev            # browser-only preview (sample project, no filesystem)
npm run build          # type-check + bundle the frontend
```

## Building a release

```bash
npm run tauri build    # NSIS installer + portable exe under src-tauri/target/release
```

See **[docs/releasing.md](docs/releasing.md)** for CI and GitHub Releases.

## Repository layout

```
EHDL-IDE/
├─ src/                 React frontend (App, components, settings store, fs bridge)
├─ src-tauri/           Rust shell (commands, capabilities, icons, config)
├─ scripts/             build-time schematic generation (tscircuit)
├─ public/              static assets (splash logo, …)
├─ docs/                development, architecture, releasing
└─ .github/workflows/   CI that builds a portable zip + installer
```

## Documentation

- [docs/development.md](docs/development.md) — local setup, scripts, troubleshooting
- [docs/architecture.md](docs/architecture.md) — how the pieces fit together
- [docs/releasing.md](docs/releasing.md) — versioning, CI, GitHub Releases

## License

[MIT](LICENSE) © EHDL contributors
