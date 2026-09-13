/**
 * Top-level design files (section 4 of `docs/vhdl-implementation.md`).
 *
 * A design is a VHDL entity plus an architecture that instantiates components
 * (`LABEL : entity work.NAME generic map (PACKAGE_VARIANT => "…") port map (…)`).
 * Instance labels become reference designators, signals become nets and the
 * entity's own ports become external nets.
 *
 * Only the subset in section 8 of the spec is parsed.
 */

import type { ComponentIssue, PortDirection } from "./vhdlPart";

export interface DesignPort {
  name: string;
  direction: PortDirection;
}

export interface DesignInstance {
  /** Instance label — becomes the reference designator (e.g. "U1"). */
  label: string;
  /** Entity name of the instantiated component. */
  entity: string;
  /** `PACKAGE_VARIANT` override, or "" to use the entity's default. */
  variant: string;
  /** `port map` associations: port name → signal name ("open" = unconnected). */
  connections: { port: string; signal: string }[];
}

export interface DesignModel {
  /** Entity name of the design. */
  name: string;
  /** Ports of the design — external nets. */
  ports: DesignPort[];
  /** Internal signals declared in the architecture. */
  signals: string[];
  instances: DesignInstance[];
}

function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const index = line.indexOf("--");
      return index >= 0 ? line.slice(0, index) : line;
    })
    .join("\n");
}

/** Split a `port map` association list into port/signal pairs. */
function parseAssociations(body: string): { port: string; signal: string }[] {
  const pairs: { port: string; signal: string }[] = [];
  for (const item of body.split(",")) {
    const match = /^\s*([A-Za-z_]\w*)\s*=>\s*([A-Za-z_]\w*|open)\s*$/i.exec(item);
    if (match) pairs.push({ port: match[1], signal: match[2] });
  }
  return pairs;
}

/** Parse a top-level design. Never throws; problems are returned as issues. */
export function parseDesignVhdl(
  text: string,
  fallbackName = "design",
): { model: DesignModel; issues: ComponentIssue[] } {
  const issues: ComponentIssue[] = [];
  const code = stripComments(text);

  const entity = /entity\s+([A-Za-z_]\w*)\s+is\b/i.exec(code);
  const architecture = /architecture\s+([A-Za-z_]\w*)\s+of\s+([A-Za-z_]\w*)\s+is\b/i.exec(code);

  const model: DesignModel = {
    name: entity?.[1] ?? architecture?.[2] ?? fallbackName,
    ports: [],
    signals: [],
    instances: [],
  };

  if (!entity) issues.push({ severity: "error", message: "No entity found in the design file." });
  if (!architecture) {
    issues.push({ severity: "error", message: "No architecture found in the design file." });
  }

  // --- entity ports --------------------------------------------------------
  if (entity) {
    const start = entity.index + entity[0].length;
    const archIndex = architecture?.index;
    const entityBody = code.slice(start, archIndex === undefined ? undefined : archIndex);
    const port = /\bport\s*\(([\s\S]*?)\)\s*;/i.exec(entityBody);
    if (port) {
      for (const item of port[1].split(";")) {
        const match = /^\s*([A-Za-z_]\w*)\s*:\s*(in|out|inout|buffer|linkage)\b/i.exec(item);
        if (match) model.ports.push({ name: match[1], direction: match[2].toLowerCase() as PortDirection });
      }
    }
  }

  // --- architecture: signals + instantiations ------------------------------
  if (architecture) {
    const body = code.slice(architecture.index + architecture[0].length);

    const signalRe = /\bsignal\s+([A-Za-z_]\w*)\s*:/gi;
    let signalMatch: RegExpExecArray | null;
    while ((signalMatch = signalRe.exec(body)) !== null) model.signals.push(signalMatch[1]);

    // LABEL : entity [work.]NAME [generic map (…)] port map (…);
    const instanceRe =
      /([A-Za-z_]\w*)\s*:\s*entity\s+(?:[A-Za-z_]\w*\s*\.\s*)?([A-Za-z_]\w*)\s*([\s\S]*?);/gi;
    let instanceMatch: RegExpExecArray | null;
    while ((instanceMatch = instanceRe.exec(body)) !== null) {
      const [, label, entityName, rest] = instanceMatch;

      const genericMap = /generic\s+map\s*\(([\s\S]*?)\)/i.exec(rest);
      const variantMatch = genericMap
        ? /PACKAGE_VARIANT\s*=>\s*"([^"]*)"/i.exec(genericMap[1])
        : null;

      const portMap = /port\s+map\s*\(([\s\S]*?)\)/i.exec(rest);
      const connections = portMap ? parseAssociations(portMap[1]) : [];
      if (!portMap) {
        issues.push({
          severity: "error",
          message: `Instance '${label}' of '${entityName}' has no port map.`,
        });
      }

      model.instances.push({
        label,
        entity: entityName,
        variant: variantMatch?.[1] ?? "",
        connections,
      });
    }

    if (model.instances.length === 0) {
      issues.push({ severity: "warning", message: "No component instantiations found in the design." });
    }
  }

  return { model, issues };
}