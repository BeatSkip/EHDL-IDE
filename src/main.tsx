import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "monaco-editor/min/vs/editor/editor.main.css";
import "./flexlayout-dark.css"; // vendored (no sourceMappingURL reference)
import "./styles.css";

// The desktop shell must never show the WebView's own context menu (Reload /
// Save as / Inspect / …): every right-click menu in EHDL is custom (menu bar,
// library item actions, Monaco's editor menu). Captured globally, so it also
// covers the title bar, the docks and any panel.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// Give React a moment to mount, then fade out the startup splash screen.
function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("splash-hide");
  window.setTimeout(() => splash.remove(), 450);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

window.setTimeout(hideSplash, 120);
