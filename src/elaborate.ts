/**
 * Elaboration — Phase 3 and 5 of `docs/vhdl-implementation.md`.
 *
 * Zips a parsed design against the component database: every instance gets its
 * package variant, its pin numbers (from the variant's pin map) and its place
 * on a net. The result is the netlist of section 6.1 plus the BOM rows of 6.2.
 *
 * This module is deliberately free of any tscircuit or Tauri dependency so it
 * can run in the webview (for checks) and in the Node generator alike.
 */

import type { ComponentModel } from "./vhdlPart";
import type { DesignModel } from "./vhdlDesign";

export interface ElaborationIssue {
  severity: "error" | "warning";
  message: string;
}

/** A component the design may instantiate. */
export interface ComponentSource {
  entity: string;
  model: ComponentModel;
  /** Where it came from, for messages (file name is enough). */
  file?: string;
}

export interface ElaboratedInstance {
  refdes: string;
  entity: string;
  variant: string;
  footprint: string;
  /** Port name → pin number, from the selected variant's pin map. */
  pins: Record<string, number>;
}

export interface NetConnection {
  refdes: string;
  pin: number;
  port: string;
}

export interface Net {
  name: string;
  connections: NetConnection[];
}

export interface Netlist {
  components: ElaboratedInstance[];
  nets: Net[];
}

export interface BomRow {
  refdes: string;
  entity: string;
  variant: string;
  manufacturer: string;
  part_number: string;
  footprint: string;
  qty: number;
}

export interface ElaborationResult {
  netlist: Netlist;
  bom: BomRow[];
  issues: ElaborationIssue[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Metadata constant lookup (constants lose their `<NAME>_` prefix when parsed). */
function metadata(model: ComponentModel, key: string): string {
  const entry = model.metadata.find((item) => same(item.key, key));
  return entry?.value ?? "";
}

/**
 * Elaborate a design against the available components.
 * Reports the error conditions of spec §5.3 and the BOM grouping of §6.2.
 */
export function elaborate(design: DesignModel, components: ComponentSource[]): ElaborationResult {
  const issues: ElaborationIssue[] = [];
  const byEntity = new Map<string, ComponentSource>();
  for (const component of components) {
    const key = component.entity.toLowerCase();
    if (byEntity.has(key)) {
      const first = byEntity.get(key);
      issues.push({
        severity: "error",
        message: `Duplicate entity '${component.entity}' in files ${first?.file ?? "?"} and ${component.file ?? "?"}`,
      });
      continue;
    }
    byEntity.set(key, component);
  }

  const netlist: Netlist = { components: [], nets: [] };
  const netMap = new Map<string, Net>();
  const netKey = (name: string) => name.toLowerCase();

  const addConnection = (net: string, connection: NetConnection) => {
    const key = netKey(net);
    let entry = netMap.get(key);
    if (!entry) {
      entry = { name: net, connections: [] };
      netMap.set(key, entry);
    }
    entry.connections.push(connection);
  };

  /** Every external port of the design is a net, even if unused. */
  for (const port of design.ports) addConnection(port.name, { refdes: "", pin: 0, port: "" });
  // …those placeholders are removed again below (they only create the net).
  for (const net of netMap.values()) net.connections = [];

  for (const instance of design.instances) {
    const component = byEntity.get(instance.entity.toLowerCase());
    if (!component) {
      issues.push({
        severity: "error",
        message: `Instantiation of an entity not found in the library: '${instance.entity}' (instance ${instance.label})`,
      });
      continue;
    }

    const model = component.model;
    const variantName = instance.variant || model.defaultVariant;
    const variant =
      model.variants.find((item) => same(item.name, variantName)) ??
      model.variants.find((item) => same(item.name, instance.variant));

    if (!variant) {
      issues.push({
        severity: "error",
        message: `Unknown variant '${instance.variant}' for entity ${model.name}`,
      });
      continue;
    }

    // Ports of the entity that the instantiation does not connect.
    const connected = new Set(instance.connections.map((entry) => entry.port.toLowerCase()));
    for (const port of model.ports) {
      if (!port.name.startsWith("_") && !connected.has(port.name.toLowerCase())) {
        issues.push({
          severity: "warning",
          message: `Port '${port.name}' on ${instance.label} is not connected (floating)`,
        });
      }
    }

    const pins: Record<string, number> = {};
    for (const connection of instance.connections) {
      const port = model.ports.find((item) => same(item.name, connection.port));
      if (!port) {
        issues.push({
          severity: "error",
          message: `Port '${connection.port}' does not exist on entity ${model.name} (instance ${instance.label})`,
        });
        continue;
      }
      const pin = variant.pins[port.name];
      if (pin === undefined) {
        issues.push({
          severity: "error",
          message: `Port '${port.name}' has no pin mapping in variant '${variant.name}'`,
        });
        continue;
      }
      pins[port.name] = pin;
      // "open" leaves the pin unconnected in the netlist.
      addConnection(
        connection.signal,
        same(connection.signal, "open")
          ? { refdes: instance.label, pin, port: port.name }
          : { refdes: instance.label, pin, port: port.name },
      );
    }

    netlist.components.push({
      refdes: instance.label,
      entity: model.name,
      variant: variant.name,
      footprint: variant.footprint,
      pins,
    });
  }

  // Nets with a single connection are still nets; "open" ones are dropped.
  netlist.nets = [...netMap.values()]
    .filter((net) => !same(net.name, "open"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { netlist, bom: buildBom(netlist, components), issues };
}

/** BOM grouped by (entity, variant, manufacturer, part_number) — spec §6.2. */
export function buildBom(netlist: Netlist, components: ComponentSource[]): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const instance of netlist.components) {
    const model = components.find((component) => same(component.entity, instance.entity))?.model;
    const manufacturer = model ? metadata(model, "MFR") : "";
    const partNumber = model ? metadata(model, "PARTNUM") : "";
    const key = [instance.entity, instance.variant, manufacturer, partNumber].join("|").toLowerCase();
    const existing = rows.get(key);
    if (existing) {
      existing.qty += 1;
      existing.refdes = `${existing.refdes} ${instance.refdes}`;
      continue;
    }
    rows.set(key, {
      refdes: instance.refdes,
      entity: instance.entity,
      variant: instance.variant,
      manufacturer,
      part_number: partNumber,
      footprint: instance.footprint,
      qty: 1,
    });
  }
  return [...rows.values()].sort((a, b) => a.entity.localeCompare(b.entity));
}

/** BOM as CSV (section 6.2 columns). */
export function bomToCsv(rows: BomRow[]): string {
  const header = "refdes,entity,variant,manufacturer,part_number,footprint,qty";
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [
    header,
    ...rows.map((row) =>
      [
        row.refdes,
        row.entity,
        row.variant,
        row.manufacturer,
        row.part_number,
        row.footprint,
        String(row.qty),
      ]
        .map(quote)
        .join(","),
    ),
  ].join("\n");
}