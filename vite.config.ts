import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Monaco's package "exports" map does not expose its CSS, so alias the import
// to the actual file. (Vite resolves aliases before Node package exports.)
const monacoEditorMainCss = fileURLToPath(
  new URL("./node_modules/monaco-editor/min/vs/editor/editor.main.css", import.meta.url),
);

// Vite config. The Tauri Rust shell loads the built assets (see src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react()],
  // Tauri expects a relative base so the built assets load from the file:// origin.
  base: "./",
  clearScreen: false,
  resolve: {
    alias: {
      "monaco-editor/min/vs/editor/editor.main.css": monacoEditorMainCss,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // avoid the Tauri src watching the frontend build
      ignored: ["**/src-tauri/**"],
    },
  },
});
