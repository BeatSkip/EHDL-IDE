/**
 * VHDL component files — the source of truth for part data.
 *
 * Implements the component-file format of `docs/vhdl-implementation.md`:
 * one file per component, holding a package (`<partname>_pkg`) with the pin
 * enum, the `pin_map` variants and their `*_FP` footprint constants, an entity
 * (`<PARTNAME>`) whose port names match the enum literals exactly, and an
 * architecture named `rtl` (usually empty).
 *
 * Only the VHDL subset from section 8 of that spec is parsed — never full VHDL.
 *
 * Comments and the architecture body are kept and written back out, so a save
 * from the graphical editor does not throw hand-written text away.
 */

/** Port directions the entity may declare. */
export type PortDirection = "in" | "out" | "inout" | "buffer" | "linkage";

export interface ComponentPort {
  /** Port name — must equal a literal of the pin enum. */
  name: string;
  direction: PortDirection;
}

export interface ComponentVariant {
  /** Variant suffix: `LM358_SOIC8` → "SOIC8". */
  name: string;
  /** IPC-7351 footprint name from `<PARTNAME>_<VARIANT>_FP`. */
  footprint: string;
  /** Pin number per port name. */
  pins: Record<string, number>;
}

export interface ComponentMetadata {
  /** Constant suffix without the `<NAME>_` prefix, e.g. "MFR" or "PARTNUM". */
  key: string;
  value: string;
}

export interface ComponentModel {
  /** Entity name — the part name, as written. */
  name: string;
  ports: ComponentPort[];
  variants: ComponentVariant[];
  /** Variant selected by the entity generic's default value. */
  defaultVariant: string;
  /** Extra string constants (manufacturer, part number, links, …). */
  metadata: ComponentMetadata[];
  /** Architecture body, preserved verbatim (usually empty). */
  architectureBody: string;
  /** Comment lines kept from the source file. */
  comments: string[];
}

export interface ComponentIssue {
  severity: "error" | "warning";
  message: string;
}

export interface ParsedComponent {
  model: ComponentModel;
  issues: ComponentIssue[];
}

/** The `pin_map` type name used by generated files. */
export const PIN_MAP_TYPE = "pin_map";

/** Package name of a part: `LM358` → `lm358_pkg`. */
export const packageNameFor = (name: string): string => `${name.toLowerCase()}_pkg`;

/** Pin enum type name of a part: `LM358` → `lm358_pin`. */
export const pinTypeNameFor = (name: string): string => `${name.toLowerCase()}_pin`;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A component with one empty variant — the starting point for a new part. */
export function emptyComponent(name: string): ComponentModel {
  return {
    name,
    ports: [],
    variants: [{ name: "DEFAULT", footprint: "", pins: {} }],
    defaultVariant: "DEFAULT",
    metadata: [],
    architectureBody: "",
    comments: [],
  };
}

/** Strip `--` comments (VHDL comments run to the end of the line). */
function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const index = line.indexOf("--");
      return index >= 0 ? line.slice(0, index) : line;
    })
    .join("\n");
}

/** Comment lines of the original file. */
function commentLines(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("--")) continue;
    // Skip the header this module generates, so it isn't duplicated on save.
    if (/^--\s*EHDL component:/i.test(trimmed)) continue;
    found.push(trimmed);
  }
  return found;
}

function parseAggregate(value: string): Record<string, number> {
  const inner = value.trim().replace(/^\(/, "").replace(/\)$/, "");
  const pins: Record<string, number> = {};
  for (const part of inner.split(",")) {
    const match = /^\s*([A-Za-z_]\w*)\s*=>\s*(\d+)/.exec(part);
    if (match) pins[match[1]] = Number(match[2]);
  }
  return pins;
}

function unquote(value: string): string {
  const match = /"([^"]*)"/.exec(value);
  return match ? match[1] : value.trim();
}

/** Slice the text of a `... is ... end <kind>` block, without the header. */
function blockBody(text: string, header: RegExp, end: RegExp): { name: string; body: string } | null {
  const match = header.exec(text);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const stop = end.exec(rest);
  return {
    name: match[1],
    body: stop ? rest.slice(0, stop.index) : rest,
  };
}

/**
 * Parse a component file. Never throws: whatever could be understood is
 * returned along with the problems found (§5.3 of the spec).
 */
export function parseComponentVhdl(text: string, fallbackName = "part"): ParsedComponent {
  const issues: ComponentIssue[] = [];
  const code = stripComments(text);

  const pkg = blockBody(code, /package\s+([A-Za-z_]\w*)\s+is\b/i, /end\s+package\b/i);
  const entityMatch = /entity\s+([A-Za-z_]\w*)\s+is\b/i.exec(code);
  const arch = blockBody(code, /architecture\s+([A-Za-z_]\w*)\s+of\s+([A-Za-z_]\w*)\s+is\b/i, /end\s+(architecture\b|\w+\s*;)/i);

  const name = entityMatch?.[1] ?? pkg?.name.replace(/_pkg$/i, "") ?? fallbackName;
  const model: ComponentModel = {
    name,
    ports: [],
    variants: [],
    defaultVariant: "",
    metadata: [],
    architectureBody: "",
    comments: commentLines(text),
  };

  if (!pkg) issues.push({ severity: "error", message: "No package found in the file." });
  if (!entityMatch) issues.push({ severity: "error", message: "No entity found in the file." });
  if (!arch) issues.push({ severity: "error", message: "No architecture found in the file." });

  // --- package: pin enum, pin_map type, constants --------------------------
  let pinLiterals: string[] = [];
  let pinMapType = PIN_MAP_TYPE;
  let pinTypeActual = pinTypeNameFor(name);
  if (pkg) {
    const enumMatch = /type\s+([A-Za-z_]\w*)\s+is\s*\(([^)]*)\)\s*;/i.exec(pkg.body);
    if (enumMatch) {
      pinTypeActual = enumMatch[1];
      pinLiterals = enumMatch[2]
        .split(",")
        .map((literal) => literal.trim())
        .filter(Boolean);
    } else {
      issues.push({ severity: "error", message: "No pin enum type found in the package." });
    }

    const arrayMatch = /type\s+([A-Za-z_]\w*)\s+is\s+array\s*\(([^)]*)\)\s+of\s+([A-Za-z_]\w*)\s*;/i.exec(
      pkg.body,
    );
    if (arrayMatch) pinMapType = arrayMatch[1];

    const constants: { name: string; type: string; value: string }[] = [];
    const constRe = /constant\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*:=\s*([\s\S]*?);/gi;
    let current: RegExpExecArray | null;
    while ((current = constRe.exec(pkg.body)) !== null) {
      constants.push({ name: current[1], type: current[2], value: current[3].trim() });
    }

    const variants = new Map<string, ComponentVariant>();
    const footprints = new Map<string, string>();
    const prefix = `${name}_`.toLowerCase();

    for (const constant of constants) {
      const lower = constant.name.toLowerCase();
      if (!lower.startsWith(prefix)) continue;
      const suffix = constant.name.slice(prefix.length);
      if (same(constant.type, pinMapType) || constant.value.startsWith("(")) {
        variants.set(suffix, { name: suffix, footprint: "", pins: parseAggregate(constant.value) });
      } else if (same(constant.type, "string")) {
        if (/_FP$/i.test(suffix)) footprints.set(suffix.slice(0, -3), unquote(constant.value));
        else model.metadata.push({ key: suffix, value: unquote(constant.value) });
      }
    }

    for (const [suffix, footprint] of footprints) {
      const variant = variants.get(suffix);
      if (variant) variant.footprint = footprint;
    }
    model.variants = [...variants.values()];

    if (model.variants.length === 0) {
      issues.push({
        severity: "error",
        message: `No pin_map constants found — expected ${name}_<VARIANT> constants in the package.`,
      });
    }
  }

  // --- entity: generic default + ports -------------------------------------
  if (entityMatch) {
    const start = entityMatch.index + entityMatch[0].length;
    const archIndex = /architecture\s+[A-Za-z_]\w*\s+of\b/i.exec(code.slice(start))?.index;
    const entityBody = code.slice(start, archIndex === undefined ? undefined : start + archIndex);

    const generic = /generic\s*\(([\s\S]*?)\)\s*;/i.exec(entityBody);
    if (generic) {
      const value = /PACKAGE_VARIANT\s*:\s*string\s*:=\s*"([^"]*)"/i.exec(generic[1]);
      if (value) model.defaultVariant = value[1];
    }

    const port = /\bport\s*\(([\s\S]*?)\)\s*;/i.exec(entityBody);
    if (port) {
      for (const item of port[1].split(";")) {
        const match = /^\s*([A-Za-z_]\w*)\s*:\s*(in|out|inout|buffer|linkage)\b/i.exec(item);
        if (match) model.ports.push({ name: match[1], direction: match[2].toLowerCase() as PortDirection });
      }
    }
  }

  // --- architecture body (preserved verbatim) ------------------------------
  if (arch) {
    const archHeader = /architecture\s+[A-Za-z_]\w*\s+of\s+[A-Za-z_]\w*\s+is\b/i.exec(code);
    if (archHeader) {
      const afterHeader = archHeader.index + archHeader[0].length;
      const begin = /\bbegin\b/i.exec(code.slice(afterHeader));
      if (begin) {
        const bodyStart = afterHeader + begin.index + begin[0].length;
        const end = /end\s+(architecture\b|\w+\s*;)/i.exec(code.slice(bodyStart));
        model.architectureBody = (end ? code.slice(bodyStart, bodyStart + end.index) : code.slice(bodyStart)).trim();
      }
    }
  }

  // --- cross-checks (§5.3) -------------------------------------------------
  if (model.ports.length === 0) {
    issues.push({ severity: "warning", message: "This component has no ports yet." });
  }
  const literals = new Set(pinLiterals.map((literal) => literal.toLowerCase()));
  for (const port of model.ports) {
    if (!literals.has(port.name.toLowerCase())) {
      issues.push({
        severity: "error",
        message: `Port '${port.name}' is not present in the pin enum '${pinTypeActual}'.`,
      });
    }
  }
  for (const variant of model.variants) {
    for (const port of model.ports) {
      // A pin map is indexed by the pin enum, so a port that is not an enum
      // literal is unmapped in every variant (spec §10, Test 3).
      if (variant.pins[port.name] === undefined || !literals.has(port.name.toLowerCase())) {
        issues.push({
          severity: "error",
          // Exact wording required by spec §10 Test 3.
          message: `Port '${port.name}' has no pin mapping in variant '${variant.name}'`,
        });
      }
    }
    if (!variant.footprint) {
      issues.push({
        severity: "warning",
        message: `Variant '${variant.name}' has no footprint constant ('${model.name}_${variant.name}_FP').`,
      });
    }
  }
  if (model.defaultVariant && !model.variants.some((v) => same(v.name, model.defaultVariant))) {
    issues.push({
      severity: "warning",
      message: `Default variant '${model.defaultVariant}' is not defined in the package.`,
    });
  }

  return { model, issues };
}

/** Render a component as canonical VHDL (round-trips through the parser). */
export function serializeComponent(model: ComponentModel): string {
  const name = model.name.trim() || "part";
  const variants = model.variants.length > 0 ? model.variants : [{ name: "DEFAULT", footprint: "", pins: {} }];
  const defaultVariant =
    variants.find((variant) => same(variant.name, model.defaultVariant))?.name ?? variants[0].name;

  const lines: string[] = [`-- EHDL component: ${name}`];

  // Keep hand-written comments: they are valid anywhere in VHDL.
  for (const comment of model.comments) {
    if (!lines.includes(comment)) lines.push(comment);
  }

  lines.push(
    "library ieee;",
    "use ieee.std_logic_1164.all;",
    "",
    `package ${packageNameFor(name)} is`,
    `  type ${pinTypeNameFor(name)} is (${model.ports.map((port) => port.name).join(", ")});`,
    `  type ${PIN_MAP_TYPE} is array (${pinTypeNameFor(name)}) of natural;`,
    "",
  );

  for (const variant of variants) {
    const pins = model.ports.map((port) => {
      const value = variant.pins[port.name];
      return `${port.name} => ${Number.isFinite(value) ? value : 0}`;
    });
    lines.push(
      `  constant ${name}_${variant.name} : ${PIN_MAP_TYPE} := (${pins.join(", ")});`,
      `  constant ${name}_${variant.name}_FP : string := "${variant.footprint}";`,
      "",
    );
  }

  for (const entry of model.metadata) {
    if (!entry.key.trim()) continue;
    lines.push(`  constant ${name}_${entry.key.trim()} : string := "${entry.value}";`);
  }

  lines.push(
    "end package;",
    "",
    "library ieee;",
    "use ieee.std_logic_1164.all;",
    "",
    `entity ${name} is`,
    "  generic (",
    `    PACKAGE_VARIANT : string := "${defaultVariant}"`,
    "  );",
    "  port (",
  );

  model.ports.forEach((port, index) => {
    const separator = index === model.ports.length - 1 ? "" : ";";
    lines.push(`    ${port.name} : ${port.direction} std_logic${separator}`);
  });

  lines.push("  );", "end entity;", "", `architecture rtl of ${name} is`, "begin");
  if (model.architectureBody) lines.push(model.architectureBody);
  lines.push("end architecture;", "");

  return lines.join("\n");
}
