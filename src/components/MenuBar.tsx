import { useEffect, useRef, useState } from "react";
import { usePopupPosition } from "../popupPosition";
import type { PopupAnchor } from "../popupPosition";

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

/**
 * A simple VS Code-style menu bar (File / Edit / View / ...). Clicking a root
 * opens its dropdown; hovering switches menus while one is open; Esc or a click
 * outside closes it.
 *
 * The dropdown measures itself and is kept inside the window: it normally
 * hangs below its root button, flipping above it near the bottom edge and
 * left/right when the title bar button sits close to a window edge.
 */
export function MenuBar({ menus, onSelect }: { menus: Menu[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const position = usePopupPosition(open !== null, anchor, popupRef);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    const close = () => setOpen(null);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  /** Anchor a dropdown to the root button it belongs to. */
  const anchorTo = (button: HTMLButtonElement): PopupAnchor => {
    const rect = button.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom, h: rect.height, align: "left" };
  };

  return (
    <nav className="menubar" ref={ref}>
      {menus.map((menu) => (
        <div key={menu.label} className="menubar-root">
          <button
            className={`menubar-item ${open === menu.label ? "open" : ""}`}
            onClick={(e) => {
              if (open === menu.label) {
                setOpen(null);
                return;
              }
              setAnchor(anchorTo(e.currentTarget));
              setOpen(menu.label);
            }}
            onPointerEnter={(e) => {
              if (!open) return;
              setAnchor(anchorTo(e.currentTarget));
              setOpen(menu.label);
            }}
          >
            {menu.label}
          </button>

          {open === menu.label && (
            <div
              className="menu-popup"
              ref={popupRef}
              style={{
                left: position?.left ?? anchor?.x ?? 0,
                top: position?.top ?? anchor?.y ?? 0,
                visibility: position ? "visible" : "hidden",
              }}
            >
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={`sep-${i}`} className="menu-sep" />
                ) : (
                  <button
                    key={item.id}
                    className="menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
                      if (!item.disabled) onSelect(item.id);
                    }}
                  >
                    <span className="menu-label">{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
