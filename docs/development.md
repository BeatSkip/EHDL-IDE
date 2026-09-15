# Development

Local setup, scripts and troubleshooting for working on EHDL-IDE.

## Prerequisites

- **Node.js 18+** and **npm**
- **Rust toolchain** (stable) for the Tauri shell — see
  <https://tauri.app/v1/guides/getting-started/prerequisites/> (v1 page, but the
  Windows prerequisites are the same for v2: Rust + MSVC Build Tools + WebView2).
- **Microsoft WebView2 Runtime** — preinstalled on Windows 10/11.

## Install

```bash
npm install
```

The frontend dependencies include Monaco and flexlayout-react; the Tauri CLI
(`@tauri-apps/cli`) is installed as a devDependency so `npm run tauri …` works
without a global install.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server (browser-only, no filesystem; the IDE opens with nothing loaded) |
| `npm run tauri dev` | Start Vite and open the native Tauri window |
| `npm run build` | Regenerate the schematic, type-check (`tsc`) and bundle the frontend into `dist/` |
| `npm run gen:schematic` | Run the build-time schematic generator only |
| `npm run tauri build` | Build the frontend then compile the Rust shell and NSIS installer |
| `npm run preview` | Serve the built `dist/` locally |

## Day-to-day

```bash
npm run tauri dev
```

The frontend is served by Vite at `http://localhost:5173` and opened in a native
window. Most edits hot-reload; changes to `src-tauri/` (Rust, capabilities,
`tauri.conf.json`) require restarting `tauri dev` so Cargo rebuilds.

## A note on the schematic

`@tscircuit/*` and `circuit-to-svg` evaluate incorrectly inside WebView2 at
runtime, so the schematic is rendered at **build time in Node** and embedded as
a string:

- `scripts/generate-schematic.mjs` builds a demo circuit and writes
  `src/generated/schematic.ts`.
- `npm run build` runs it automatically; `npm run dev` does **not**, so the
  generated file is committed to keep dev working on a fresh clone.
- Keep tscircuit out of the runtime bundle — it must stay a devDependency.

## Troubleshooting

- **`failed to run 'cargo metadata'`** — Rust isn't on `PATH`. Install Rust and
  reopen the terminal, or add `$env:Path += ";$env:USERPROFILE\.cargo\bin"`.
- **Linker errors** — install Visual Studio Build Tools → *Desktop development
  with C++*.
- **`tauri build` complains about icons** — regenerate from a 1024×1024 PNG with
  `npm run tauri icon path/to/icon.png`.
- **npm install fails writing its cache** — set `npm_config_cache` to a writable
  location (a local `.npm-cache/` is already gitignored).
