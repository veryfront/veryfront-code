/**
 * Bridge Shared State
 *
 * Bridge infrastructure state (inspector, console, screenshot).
 * Editor state lives in bridge-editor-state.ts.
 */

// ---------------------------------------------------------------------------
// Shared types (used by state and multiple bridge modules)
// ---------------------------------------------------------------------------

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  isCurrentUser: boolean;
  isAgent: boolean;
}

export interface RemoteSelection {
  id: string;
  name: string;
  color: string;
  isCurrentUser: boolean;
  start: number;
  end: number;
}

export interface SlashMenuContext {
  lineStart: number;
  caret: number;
  indent: string;
  query: string;
  anchorLeft: number;
  anchorTop: number;
}

export interface SlashMenuCommand {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  icon: string;
  shortcut: string;
}

export interface MdxImportEntry {
  filePath: string;
  symbolName: string;
  importKind: string;
}

export interface MdxBlock {
  tokenIndex: number;
  label: string;
  lineNumber: number;
  filePath: string;
  symbolName: string;
}

/** Lexical editor API surface exposed after dynamic import */
export interface LexicalApi {
  editor: unknown;
  lexicalModule: unknown;
  richTextModule: unknown;
  listModule: unknown;
  markdownModule: unknown;
  selectionModule: unknown;
  unregisterRichText: () => void;
  unregisterList: () => void;
  unregisterHistory: () => void;
  unregisterUpdate: () => void;
}

// ---------------------------------------------------------------------------
// Bridge infrastructure state
// ---------------------------------------------------------------------------

export const state = {
  // Inspector
  inspectMode: false,
  selectedNodeId: null as string | null,
  hoveredNodeId: null as string | null,
  lastTreeSignature: "",

  // Overlays
  hoverOverlay: null as HTMLElement | null,
  selectionOverlay: null as HTMLElement | null,

  // Console
  originalConsole: {} as Record<string, (...args: unknown[]) => void>,
  logCounter: 0,

  // Screenshot
  html2canvasLoaded: false,
  html2canvasPromise: null as Promise<void> | null,
};

// ---------------------------------------------------------------------------
// Re-exports from editor state (for modules that import from bridge-state)
// ---------------------------------------------------------------------------

export { editorState, setMarkdownPersistStatus } from "./bridge-editor-state.ts";

export const LEXICAL_YJS_ORIGIN = "lexical-yjs-binding";

export const CONSOLE_METHODS = [
  "log",
  "debug",
  "info",
  "warn",
  "error",
  "table",
  "clear",
  "dir",
];

export const DOM_IGNORE_TAGS = ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"];

export const MARKDOWN_SLASH_COMMANDS: SlashMenuCommand[] = [
  {
    id: "text",
    label: "Text",
    description: "Plain text block",
    aliases: ["text", "paragraph", "p"],
    icon: "T",
    shortcut: "",
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Create a top-level heading",
    aliases: ["h1", "heading", "title"],
    icon: "H\u2081",
    shortcut: "#",
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Create a second-level heading",
    aliases: ["h2", "heading2", "subheading"],
    icon: "H\u2082",
    shortcut: "##",
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Create a third-level heading",
    aliases: ["h3", "heading3"],
    icon: "H\u2083",
    shortcut: "###",
  },
  {
    id: "bulleted-list",
    label: "Bulleted list",
    description: "Start a bullet list item",
    aliases: ["list", "bullet", "ul"],
    icon: "\u2022",
    shortcut: "-",
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    description: "Start a numbered list item",
    aliases: ["olist", "numbered", "ol"],
    icon: "1.",
    shortcut: "1.",
  },
  {
    id: "quote-block",
    label: "Quote",
    description: "Insert a block quote line",
    aliases: ["quote", "blockquote"],
    icon: "\u201C",
    shortcut: ">",
  },
  {
    id: "code-block",
    label: "Code block",
    description: "Insert a fenced code block",
    aliases: ["code", "fence", "snippet"],
    icon: "<>",
    shortcut: "```",
  },
  {
    id: "image",
    label: "Image",
    description: "Insert markdown image syntax",
    aliases: ["image", "img", "photo"],
    icon: "\uD83D\uDDBC",
    shortcut: "",
  },
];
