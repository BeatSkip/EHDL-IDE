# Building & releasing

How the Windows build works, locally and in CI.

## Local build

```bash
npm install
npm run tauri build
```

Produces, under `src-tauri/target/release/`:

- `ehdl-ide.exe` (and any adjacent `.dll` if present) — the portable binary
- `bundle/nsis/*-setup.exe` — the NSIS installer

The frontend is rebuilt first via `tauri.conf.json` → `beforeBuildCommand:
npm run build` and embedded into the binary.

## CI

`.github/workflows/build.yml` runs on Windows:

1. Checkout + Node 20 + Rust stable + Rust cache.
2. `npm ci` and `npm run tauri build`.
3. Packages the release `.exe` (plus any `.dll`) into
   `EHDL-IDE-portable-windows-x64.zip` using PowerShell.
4. Uploads the zip (and the NSIS installer) as a workflow artifact.

## GitHub Releases

Push a tag beginning with `v` (e.g. `v0.1.0`) and the workflow attaches the
portable zip and installer to a new GitHub Release automatically.

```bash
git tag v0.1.0
git push origin v0.1.0
```

You can also run the workflow manually from the **Actions** tab
(`workflow_dispatch`) to produce artifacts without a release.

## Version bump checklist

1. `package.json` → `version`
2. `src-tauri/tauri.conf.json` → `version`
3. `src-tauri/Cargo.toml` → `version`
4. Commit, tag `v<version>`, push.

## Notes

- The portable zip is the release `.exe` by itself (Tauri v2 embeds the frontend
  and the WebView2 loader). End users still need the **WebView2 Runtime**, which
  is preinstalled on Windows 10/11.
- Signing / auto-update keys are not configured yet; the installer is unsigned,
  so SmartScreen may warn until the app is signed.
