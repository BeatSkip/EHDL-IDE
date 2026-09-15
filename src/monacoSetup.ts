import * as monaco from "monaco-editor";
import { typescript } from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

// Use locally-bundled workers (no CDN) so the editor works offline inside Tauri.
// TypeScript gets its language-service worker (symbol programs are TypeScript);
// everything else — including VHDL — uses the plain editor worker.
(globalThis as { MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => unknown } }).MonacoEnvironment = {
  getWorker: (_moduleId, label) =>
    label === "typescript" || label === "javascript" ? new tsWorker() : new editorWorker(),
};

// Symbol programs import `tscircuit`, whose type definitions are not available
// inside the worker — reporting that as an error would cover the file in
// squiggles, so only syntax is checked.
typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
});

// ---- VHDL language (Monarch tokenizer) ----

const VHDL_KEYWORDS = [
  "abs", "access", "after", "alias", "all", "and", "architecture", "array",
  "assert", "attribute", "begin", "block", "body", "buffer", "bus", "case",
  "component", "configuration", "constant", "context", "declare", "default",
  "disconnect", "downto", "else", "elsif", "end", "entity", "exit", "file",
  "for", "function", "generate", "generic", "group", "guarded", "if", "impure",
  "in", "inertial", "inout", "is", "label", "library", "linkage", "literal",
  "loop", "map", "mod", "nand", "new", "next", "nor", "not", "null", "of",
  "on", "open", "or", "others", "out", "package", "port", "postponed",
  "procedure", "process", "pure", "range", "record", "register", "reject",
  "rem", "report", "return", "rol", "ror", "select", "severity", "shared",
  "signal", "sla", "sll", "sra", "srl", "subtype", "then", "to", "transport",
  "type", "unaffected", "units", "until", "use", "variable", "wait", "when",
  "while", "with", "xnor", "xor",
];

const VHDL_TYPES = [
  "std_logic", "std_logic_vector", "std_ulogic", "std_ulogic_vector",
  "integer", "natural", "positive", "boolean", "bit", "bit_vector",
  "character", "string", "real", "time", "signed", "unsigned",
];

monaco.languages.register({ id: "vhdl" });

monaco.languages.setMonarchTokensProvider("vhdl", {
  keywords: VHDL_KEYWORDS,
  types: VHDL_TYPES,

  tokenizer: {
    root: [
      { include: "@whitespace" },

      // Standard/consecutive-quote runs used for std_logic values: '0', '1', 'Z'
      [/(\')[\'01XZULHWN-](\')/, "string"],
      [/[a-zA-Z_][\w]*/, { cases: { "@keywords": "keyword", "@types": "type", "@default": "identifier" } }],
      [/\d+/, "number"],
      [/=>|<=|:=|<>|==|&|[+\-*/]/, "operator"],
      [/[();,.:]/, "delimiter"],
    ],

    whitespace: [
      [/--.*$/, "comment"],
      [/\s+/, "white"],
    ],
  },
});

monaco.languages.setLanguageConfiguration("vhdl", {
  comments: { lineComment: "--" },
  brackets: [["(", ")"]],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
});
