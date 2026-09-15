// Shared in-memory editor text store so each open file keeps its edits even if
// flexlayout unmounts/remounts a tab's content when switching files.
const store = new Map<string, string>();

type Listener = { id: string; notify: (text: string) => void };
const listeners = new Set<Listener>();

export function getEditorText(fileId: string, fallback: string): string {
  return store.get(fileId) ?? fallback;
}

/** The text held for a document, or `undefined` when the store has none. */
export function peekEditorText(fileId: string): string | undefined {
  return store.get(fileId);
}

export function setEditorText(fileId: string, text: string): void {
  store.set(fileId, text);
  for (const listener of listeners) {
    if (listener.id === fileId) listener.notify(text);
  }
}

/**
 * Watch one document's text — used by previews that redraw as you type (the
 * Part editor's symbol drawing). Returns the unsubscribe function.
 */
export function subscribeEditorText(fileId: string, notify: (text: string) => void): () => void {
  const listener: Listener = { id: fileId, notify };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
