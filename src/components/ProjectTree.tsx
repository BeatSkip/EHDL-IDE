import { useState } from "react";
import type { ProjectNode } from "../data";

function keyOf(node: ProjectNode): string {
  return node.kind === "file" ? node.id : node.name;
}

function TreeRow({
  node,
  depth,
  activeId,
  onSelect,
}: {
  node: ProjectNode;
  depth: number;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.kind === "folder") {
    return (
      <li className="tree-node">
        <div className={`tree-row tree-folder-row`} style={{ paddingLeft: depth * 14 }}>
          <button className="tree-caret" onClick={() => setOpen((o) => !o)}>
            {open ? "\u25be" : "\u25b8"}
          </button>
          <span className="tree-folder">{node.name}</span>
        </div>
        {open && (
          <ul className="tree-list">
            {node.children.map((c) => (
              <TreeRow key={keyOf(c)} node={c} depth={depth + 1} activeId={activeId} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li className="tree-node">
      <div
        className={`tree-row tree-file-row ${node.id === activeId ? "active" : ""}`}
        style={{ paddingLeft: depth * 14 + 18 }}
        onClick={() => onSelect(node.id)}
      >
        <span className="tree-file">{node.name}</span>
      </div>
    </li>
  );
}

export function ProjectTree({
  nodes,
  activeId,
  onSelect,
}: {
  nodes: ProjectNode[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel project">
      <div className="panel-title">PROJECT</div>
      <div className="panel-body">
        <ul className="tree-list">
          {nodes.map((n) => (
            <TreeRow key={keyOf(n)} node={n} depth={0} activeId={activeId} onSelect={onSelect} />
          ))}
        </ul>
      </div>
    </div>
  );
}
