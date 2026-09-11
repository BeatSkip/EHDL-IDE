/**
 * The provisional EHDL part file format — components only (`xxx.prt.ehd`).
 *
 * The definition language and backend are not chosen yet, so this is a simple,
 * human-readable plain-text format that the Part editor can round-trip:
 *
 *     # EHDL component — provisional plain-text format.
 *     kind        = component
 *     name        = IRF540N
 *     library     = power_lib
 *     description = N-channel MOSFET
 *
 *     symbols:
 *       power/mosfet_n.sym.ehd
 *
 *     footprints:
 *       TO-220.txt
 *
 *     vendors:            # vendor | part number | link | datasheet
 *       Digi-Key | IRF540NPBF-ND | https://… | https://…pdf
 *
 * Anything the parser does not recognise (comments, a `pins:` block, future
 * keys) is kept in `extra` and written back out, so hand-written text survives
 * a save from the graphical editor.
 */

export interface PartVendor {
  /** Distributor / vendor name, e.g. "Digi-Key". */
  name: string;
  /** Vendor part number. */
  part: string;
  /** Product page URL. */
  url: string;
  /** Datasheet URL. */
  datasheet: string;
}

export interface PartDoc {
  /** "component" for `.prt.ehd` files. */
  kind: string;
  name: string;
  library: string;
  description: string;
  /** Links to symbol files (library-relative or absolute). */
  symbols: string[];
  /** Links to footprint files. */
  footprints: string[];
  /** Preferred vendor parts, links and datasheets. */
  vendors: PartVendor[];
  /** Unrecognised lines, preserved verbatim on save. */
  extra: string[];
}

export function emptyPartDoc(kind = "component"): PartDoc {
  return {
    kind,
    name: "",
    library: "",
    description: "",
    symbols: [],
    footprints: [],
    vendors: [],
    extra: [],
  };
}

type Section = "symbols" | "footprints" | "vendors" | null;

/** Section headers we own — `vendors:   # legend` is a header too. */
const HEADER = /^(symbols|footprints|vendors)\s*:\s*(#.*)?$/i;
/** `key = value` lines. */
const KEY_VALUE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/;

/** Comments this module generates — dropped on parse so they aren't duplicated. */
function isGeneratedComment(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith("# --- preserved lines ---") ||
    lower.startsWith("# the definition language") ||
    lower.startsWith("# provisional plain-text") ||
    (lower.startsWith("# ehdl ") && lower.includes("provisional plain-text"))
  );
}

function parseVendor(line: string): PartVendor {
  const [name = "", part = "", url = "", datasheet = ""] = line.split("|").map((field) => field.trim());
  return { name, part, url, datasheet };
}

/** Read a part file into its editable fields. */
export function parsePart(text: string): PartDoc {
  const doc = emptyPartDoc();
  let section: Section = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      if (!isGeneratedComment(line)) doc.extra.push(raw);
      continue;
    }

    const header = HEADER.exec(line);
    if (header) {
      section = header[1].toLowerCase() as Section;
      continue;
    }

    const keyValue = KEY_VALUE.exec(line);
    if (keyValue) {
      const key = keyValue[1].toLowerCase();
      const value = keyValue[2].trim().replace(/^"(.*)"$/, "$1");
      if (key === "kind") doc.kind = value;
      else if (key === "name") doc.name = value;
      else if (key === "library") doc.library = value;
      else if (key === "description") doc.description = value;
      else doc.extra.push(raw);
      section = null;
      continue;
    }

    if (section === "symbols") doc.symbols.push(line.replace(/^"(.*)"$/, "$1"));
    else if (section === "footprints") doc.footprints.push(line.replace(/^"(.*)"$/, "$1"));
    else if (section === "vendors") doc.vendors.push(parseVendor(line));
    else doc.extra.push(raw);
  }

  if (!doc.kind) doc.kind = "component";
  return doc;
}

/** Render a part file from its editable fields. */
export function serializePart(doc: PartDoc): string {
  const kind = doc.kind || "component";
  const lines: string[] = [
    `# EHDL ${kind} — provisional plain-text format.`,
    "# The definition language/backend is not chosen yet; this file is plain text.",
    "",
    `kind        = ${kind}`,
    `name        = ${doc.name}`,
  ];
  if (doc.library) lines.push(`library     = ${doc.library}`);
  if (doc.description) lines.push(`description = ${doc.description}`);

  if (doc.symbols.length > 0) {
    lines.push("", "symbols:");
    for (const symbol of doc.symbols) lines.push(`  ${symbol}`);
  }
  if (doc.footprints.length > 0) {
    lines.push("", "footprints:");
    for (const footprint of doc.footprints) lines.push(`  ${footprint}`);
  }
  if (doc.vendors.length > 0) {
    lines.push("", "vendors:            # vendor | part number | link | datasheet");
    for (const vendor of doc.vendors) {
      lines.push(`  ${[vendor.name, vendor.part, vendor.url, vendor.datasheet].join(" | ")}`);
    }
  }
  if (doc.extra.length > 0) {
    lines.push("", "# --- preserved lines ---", ...doc.extra);
  }
  lines.push("");
  return lines.join("\n");
}

/** True when the two texts differ only in trailing whitespace/newlines. */
export function samePartText(a: string, b: string): boolean {
  return a.replace(/\s+$/, "") === b.replace(/\s+$/, "");
}