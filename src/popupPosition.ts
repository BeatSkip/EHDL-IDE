import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Positioning for popup menus.
 *
 * The popup is measured and kept inside the window: it opens below the anchor
 * and flips above it when there is no room underneath, and it opens on the
 * preferred side of the anchor, flipping left/right when that side is too
 * narrow (a slim sidebar, or the pointer close to a window edge).
 */

/** Which popup edge is aligned with the anchor point. */
export type PopupAlign = "left" | "right";

export interface PopupAnchor {
  /** Anchor x in viewport coordinates (pointer x, or an element's edge). */
  x: number;
  /** Anchor y in viewport coordinates (pointer y, or an element's bottom). */
  y: number;
  /** Height of the anchoring element (0 for a bare pointer position). */
  h?: number;
  /**
   * Preferred alignment: "left" opens to the right of the anchor (popup's left
   * edge on it), "right" opens to the left (popup's right edge on it).
   */
  align?: PopupAlign;
}

export interface PopupPosition {
  left: number;
  top: number;
}

/** Gap kept between a popup and the window edges. */
const MARGIN = 6;
/** Gap between the anchor and the popup. */
const GAP = 4;

/**
 * Compute the viewport position for an open popup. Pass `open`, the anchor
 * (null while closed) and a ref to the popup element; apply the result with
 * `position: fixed`. While the returned value is null (first layout pass) keep
 * the popup invisible to avoid a flash at the wrong spot.
 */
export function usePopupPosition(
  open: boolean,
  anchor: PopupAnchor | null,
  ref: RefObject<HTMLElement | null>,
): PopupPosition | null {
  const [position, setPosition] = useState<PopupPosition | null>(null);

  // Depend on primitives only — `anchor` is a fresh object on every render.
  const ax = anchor?.x ?? 0;
  const ay = anchor?.y ?? 0;
  const ah = anchor?.h ?? 0;
  const align = anchor?.align ?? "left";

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPosition(null);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();

    // Horizontal: preferred side first, flip to the other one when it overflows.
    const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
    let left = align === "right" ? ax - width : ax;
    if (left < MARGIN || left > maxLeft) {
      left = align === "right" ? ax : ax - width;
    }
    left = Math.min(Math.max(left, MARGIN), maxLeft);

    // Vertical: below the anchor, flipped above when there is no room.
    const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);
    let top = ay + GAP;
    if (top + height > window.innerHeight - MARGIN) {
      top = ay - ah - height - GAP;
    }
    top = Math.min(Math.max(top, MARGIN), maxTop);

    setPosition({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ax, ay, ah, align, ref]);

  return position;
}
