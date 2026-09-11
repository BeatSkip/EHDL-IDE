/**
 * Icons a sub-category folder can be given. The chosen icon is stored in the
 * library manifest (`<library_name>.ehdlib.json`) — see `libraryMeta.ts`.
 */

import type { ReactNode } from "react";

/** Icon used when a sub-category has no icon of its own. */
export const DEFAULT_ICON_ID = "folder";

export interface LibraryIcon {
  id: string;
  label: string;
  /** SVG children drawn in a 16×16 viewBox. */
  shape: ReactNode;
}

export const LIBRARY_ICONS: LibraryIcon[] = [
  { id: "folder", label: "Folder (default)", shape: <path d="M1.5 4.5h4.2l1.6 2h7.2v7H1.5z" /> },
  {
    id: "chip",
    label: "IC / chip",
    shape: (
      <>
        <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
        <path d="M6.5 2.5v2M9.5 2.5v2M6.5 11.5v2M9.5 11.5v2M2.5 6.5h2M2.5 9.5h2M11.5 6.5h2M11.5 9.5h2" />
      </>
    ),
  },
  { id: "resistor", label: "Resistor", shape: <path d="M1.5 8h2.2l1.1-2.6 1.5 5.2 1.5-5.2 1.5 5.2 1.1-2.6h2.1" /> },
  {
    id: "capacitor",
    label: "Capacitor",
    shape: <path d="M1.5 8h4.2M10.3 8h4.2M5.7 4.5v7M10.3 4.5v7" />,
  },
  {
    id: "diode",
    label: "Diode",
    shape: (
      <>
        <path d="M2 8h3M11 8h3" />
        <path d="M5 5.5v5l4-2.5z" />
        <path d="M11 5.5v5" />
      </>
    ),
  },
  {
    id: "led",
    label: "LED",
    shape: (
      <>
        <path d="M2 9.5h3M11 9.5h3" />
        <path d="M5 7v5l4-2.5z" />
        <path d="M11 7v5" />
        <path d="M6.5 5.5 8.5 3.5M9.5 6.5 11.5 4.5" />
      </>
    ),
  },
  {
    id: "connector",
    label: "Connector",
    shape: (
      <>
        <rect x="2.5" y="5.5" width="11" height="5" rx="1" />
        <path d="M5.5 10.5v2.5M8 10.5v2.5M10.5 10.5v2.5" />
      </>
    ),
  },
  {
    id: "crystal",
    label: "Crystal / oscillator",
    shape: (
      <>
        <rect x="6" y="4.5" width="4" height="7" />
        <path d="M2.5 8h3.5M10 8h3.5M2.5 5.5v5M13.5 5.5v5" />
      </>
    ),
  },
  {
    id: "board",
    label: "Board / module",
    shape: (
      <>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
        <circle cx="5.8" cy="5.8" r="1" />
        <circle cx="10.2" cy="10.2" r="1" />
        <path d="M5.8 6.8v3.4h3.4" />
      </>
    ),
  },
  { id: "power", label: "Power", shape: <path d="M3 6v4M6 4.5v7M9 6v4M12 4.5v7" /> },
  {
    id: "star",
    label: "Favourite",
    shape: <path d="M8 2.5l1.6 3.4 3.7.5-2.7 2.6.6 3.7L8 11l-3.2 1.7.6-3.7L2.7 6.4l3.7-.5z" />,
  },
  {
    id: "tag",
    label: "Tag",
    shape: (
      <>
        <path d="M8.5 2.5h5v5l-6 6-5-5z" />
        <circle cx="11" cy="5" r="0.9" />
      </>
    ),
  },
];

/** Draw one library icon by id (falls back to the default folder icon). */
export function LibraryIconGlyph({ id, size = 14 }: { id: string; size?: number }) {
  const icon = LIBRARY_ICONS.find((entry) => entry.id === id) ?? LIBRARY_ICONS[0];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      {icon.shape}
    </svg>
  );
}
