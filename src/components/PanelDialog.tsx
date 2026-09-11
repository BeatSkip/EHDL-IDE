/**
 * Small centered dialog used by the sidebar panels (sub-category details,
 * library details, delete confirmation). Portaled to <body> so a narrow panel
 * can't clip it; clicking the backdrop dismisses it.
 */

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function PanelDialog({
  title,
  children,
  actions,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  /** A little wider — used for the icon grid. */
  wide?: boolean;
}) {
  return createPortal(
    <div className="panel-dialog-overlay" onClick={onClose}>
      <div
        className={`panel-dialog ${wide ? "panel-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-dialog-title">{title}</div>
        <div className="panel-dialog-body">{children}</div>
        <div className="panel-dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
