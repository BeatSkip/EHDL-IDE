import type * as monaco from "monaco-editor";

/**
 * Tracks the live Monaco editor instances (keyed by document id) so the
 * Edit-menu actions (undo/redo/cut/copy/paste) can target the active editor.
 */
const registry = new Map<string, monaco.editor.IStandaloneCodeEditor>();

export function registerEditor(id: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  registry.set(id, editor);
}

export function unregisterEditor(id: string): void {
  registry.delete(id);
}

export function getEditor(id: string): monaco.editor.IStandaloneCodeEditor | undefined {
  return registry.get(id);
}
