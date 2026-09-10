import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import "../monacoSetup"; // registers the worker + VHDL language
import type { VhdlFile } from "../data";
import { getEditorText, setEditorText } from "../editorState";
import { registerEditor, unregisterEditor } from "../editors";
import { loadSettings, subscribeSettings } from "../settings";

/**
 * A VHDL code editor backed by Monaco (the editor used by VS Code), with a
 * VS Code dark theme and a VHDL Monarch tokenizer. Each open file gets its own
 * Monaco instance; edits are kept in the shared editor store so switching tabs
 * preserves each file's content. Ctrl/Cmd+S triggers `onSave` (writes real
 * files back to disk). Font size / word wrap come from the Settings modal and
 * apply live to every open instance.
 */
export function CodeEditor({ file, onSave }: { file: VhdlFile; onSave?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!host.current) return;

    const settings = loadSettings();
    const editor = monaco.editor.create(host.current, {
      value: getEditorText(file.id, file.content),
      language: "vhdl",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: "Consolas, monospace",
      fontSize: settings.fontSize,
      wordWrap: settings.wordWrap ? "on" : "off",
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      tabSize: 4,
      insertSpaces: false,
      folding: true,
      renderWhitespace: "none",
    });
    editorRef.current = editor;

    // Ctrl/Cmd+S saves the document (real files are written to disk).
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.());

    // Make this editor reachable from the Edit menu (undo/redo/clipboard).
    registerEditor(file.id, editor);

    // Keep the shared store in sync so edits survive tab switches.
    const subscription = editor.onDidChangeModelContent(() => {
      setEditorText(file.id, editor.getValue());
    });

    return () => {
      subscription.dispose();
      unregisterEditor(file.id);
      editorRef.current = null;
      editor.dispose();
    };
    // One instance per file (each open file tab mounts a dedicated editor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  // Push Settings-modal changes (font size / word wrap) to this editor live.
  useEffect(() => {
    return subscribeSettings((settings) => {
      editorRef.current?.updateOptions({
        fontSize: settings.fontSize,
        wordWrap: settings.wordWrap ? "on" : "off",
      });
    });
  }, []);

  return <div className="editor monaco-host" ref={host} />;
}
