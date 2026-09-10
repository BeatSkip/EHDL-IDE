import { getCurrentWindow } from "@tauri-apps/api/window";

function run(action: (window: ReturnType<typeof getCurrentWindow>) => void) {
  try {
    action(getCurrentWindow());
  } catch (error) {
    console.error("window control failed", error);
  }
}

/** Windows-style caption buttons: minimize / maximize / close. */
export function WindowControls() {
  return (
    <div className="window-controls">
      <button
        className="wc-btn"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => run((w) => void w.minimize())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      <button
        className="wc-btn"
        aria-label="Maximize"
        title="Maximize"
        onClick={() => run((w) => void w.toggleMaximize())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
        </svg>
      </button>

      <button
        className="wc-btn wc-close"
        aria-label="Close"
        title="Close"
        onClick={() => run((w) => void w.close())}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
