// Shared in-memory editor text store so each open file keeps its edits even if
// flexlayout unmounts/remounts a tab's content when switching files.
const store = new Map<string, string>();

export function getEditorText(fileId: string, fallback: string): string {
  return store.get(fileId) ?? fallback;
}

export function setEditorText(fileId: string, text: string): void {
  store.set(fileId, text);
}
