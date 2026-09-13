/**
 * Small centered dialog used by the sidebar panels (sub-category details,
 * library details, delete confirmation). Portaled to <body> so a narrow panel
 * can't clip it; clicking the backdrop dismisses it.
 */

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function PanelDialog({
  title,
  children,
  actions,
  onClose,
  onConfirm,
  wide,
  className,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  /**
   * When given, Enter activates the dialog's primary action (Esc still
   * cancels). Left out for destructive dialogs, where Enter shouldn't confirm.
   */
  onConfirm?: () => void;
  /** A little wider — used for the icon grid. */
  wide?: boolean;
  /** Extra class for a specific dialog (e.g. an extra-wide layout). */
  className?: string;
}) {
  /**
   * Only a press that *starts* on the backdrop dismisses the dialog. A click
   * whose button went down inside — dragging to select text in a field, for
   * instance — must not close it, even when the mouse is released outside.
   */
  const startedOnBackdrop = useRef(false);

  // Esc cancels the dialog; Enter confirms it when it has a primary action.
  // (Enter is ignored inside a text area, where it means "new line".)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Enter" || !onConfirm) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onConfirm]);

  return createPortal(
    <div
      className="panel-dialog-overlay"
      onMouseDown={(e) => {
        startedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (startedOnBackdrop.current && e.target === e.currentTarget) onClose();
        startedOnBackdrop.current = false;
      }}
    >
      <div
        className={`panel-dialog ${wide ? "panel-dialog-wide" : ""} ${className ?? ""}`}
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
