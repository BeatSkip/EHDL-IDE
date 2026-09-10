import { useState } from "react";
import type { FsEntry } from "../fs";
import { listDir } from "../fs";

function FileRow({ entry, depth, onOpen }: { entry: FsEntry; depth: number; onOpen: (path: string) => void }) {
  return (
    <li className="tree-node">
      <div
        className="tree-row tree-file-row"
        style={{ paddingLeft: depth * 14 + 18 }}
        onClick={() => onOpen(entry.path)}
      >
        <span className="tree-file">{entry.name}</span>
      </div>
    </li>
  );
}

function DirRow({
  entry,
  depth,
  onOpen,
}: {
  entry: FsEntry;
  depth: number;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && children === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        setChildren(await listDir(entry.path));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <li className="tree-node">
      <div className="tree-row tree-folder-row" style={{ paddingLeft: depth * 14 }} onClick={toggle}>
        <button className="tree-caret" onClick={(e) => { e.stopPropagation(); void toggle(); }}>
          {open ? "\u25be" : "\u25b8"}
        </button>
        <span className="tree-folder">{entry.name}</span>
        {loading && <span className="tree-folder-loading">…</span>}
      </div>
      {error && <div className="tree-error">{error}</div>}
      {open && children && (
        <ul className="tree-list">
          {children.map((c) =>
            c.isDir ? (
              <DirRow key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} />
            ) : (
              <FileRow key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} />
            ),
          )}
        </ul>
      )}
    </li>
  );
}

/** Real file-system explorer for the opened folder (lazy directory loading). */
export function FileExplorer({
  rootPath,
  rootName,
  onOpenFile,
}: {
  rootPath: string;
  rootName: string;
  onOpenFile: (path: string) => void;
}) {
  return (
    <div className="panel project">
      <div className="panel-title" title={rootPath}>
        {rootName}
      </div>
      <div className="panel-body">
        <ul className="tree-list">
          <DirRow entry={{ path: rootPath, name: rootName, isDir: true }} depth={0} onOpen={onOpenFile} />
        </ul>
      </div>
    </div>
  );
}
