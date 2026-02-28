/**
 * Bridge Shared State
 *
 * Single mutable state object shared across all bridge modules.
 * All former IIFE `let` variables live here.
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
// State
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

  // Markdown editor DOM
  markdownEditorRoot: null as HTMLElement | null,
  markdownEditorSurface: null as HTMLElement | null,
  markdownEditorTextarea: null as HTMLTextAreaElement | null,
  markdownEditButton: null as HTMLButtonElement | null,
  markdownFileId: null as string | null,

  // Markdown timers
  markdownSyncTimer: null as ReturnType<typeof setTimeout> | null,
  markdownSelectionSyncTimer: null as ReturnType<typeof setTimeout> | null,

  // Markdown persist
  markdownPersistStatus: null as HTMLElement | null,

  // Markdown presence & selections
  markdownPresenceRoot: null as HTMLElement | null,
  markdownSelectionsRoot: null as HTMLElement | null,
  markdownSelectionOverlayRoot: null as HTMLElement | null,
  markdownOverlaySelections: [] as RemoteSelection[],
  markdownSelectionOverlayRenderFrame: null as number | null,

  // Slash menu
  markdownSlashMenuRoot: null as HTMLElement | null,
  markdownSlashMenuTimer: null as ReturnType<typeof setTimeout> | null,
  markdownSlashMenuContext: null as SlashMenuContext | null,
  markdownSlashMenuCommands: [] as SlashMenuCommand[],
  markdownSlashMenuActiveIndex: 0,

  // Inline toolbar
  markdownInlineToolbarRoot: null as HTMLElement | null,
  markdownInlineToolbarFrame: null as number | null,

  // Block drag
  markdownBlockDragHandle: null as HTMLElement | null,
  markdownBlockDropIndicator: null as HTMLElement | null,
  markdownBlockDropLabel: null as HTMLElement | null,
  markdownBlockDragGhost: null as HTMLElement | null,
  markdownBlockDragSourceIndex: -1,
  markdownBlockDropSlotIndex: -1,
  markdownBlockHandleHoverIndex: -1,
  markdownBlockDragActive: false,

  // MDX blocks
  markdownMdxBlocksRoot: null as HTMLElement | null,

  // Global listener cleanups
  markdownGlobalListenerCleanups: [] as Array<() => void>,

  // Lexical
  markdownLexicalApi: null as LexicalApi | null,
  markdownLexicalSetupPromise: null as Promise<void> | null,

  // Markdown content
  markdownCurrentContent: "",
  markdownCurrentEditorContent: "",
  markdownLexicalRenderedContent: null as string | null,
  markdownApplyingRemoteUpdate: false,
  markdownFrontmatter: "",
  markdownRawBlocks: [] as string[],
  markdownRawBlockTokenPrefix: "VF_RAW_BLOCK",
  markdownLatestMdxBlocks: [] as MdxBlock[],
  markdownLatestMdxImportMap: {} as Record<string, MdxImportEntry>,
  markdownLatestPresenceUsers: [] as PresenceUser[],
  markdownLatestSelections: [] as RemoteSelection[],
  markdownHasUnsavedChanges: false,
  markdownSaveInProgress: false,

  // Yjs (dynamically imported — typed structurally)
  markdownYDoc: null as { getText(name: string): unknown; destroy(): void } | null,
  markdownYProvider: null as {
    on(event: string, cb: (...args: unknown[]) => void): void;
    disconnect(): void;
    destroy(): void;
    awareness: unknown;
  } | null,
  markdownYText: null as { length: number } | null,
  markdownYjsConnected: false,
  markdownYjsSetupId: 0,
  markdownYjsY: null as unknown,
  markdownPendingSelection: null as { start: number; end: number } | null,

  // Console
  originalConsole: {} as Record<string, (...args: unknown[]) => void>,
  logCounter: 0,

  // Screenshot
  html2canvasLoaded: false,
  html2canvasPromise: null as Promise<void> | null,
};

// ---------------------------------------------------------------------------
// Persist status (lives here to avoid circular imports between core ↔ editor)
// ---------------------------------------------------------------------------

export function setMarkdownPersistStatus(status: string): void {
  if (!state.markdownPersistStatus) {
    return;
  }

  const nextStatus = status === "saving" || status === "saved" || status === "error"
    ? status
    : "saved";

  state.markdownPersistStatus.setAttribute("data-state", nextStatus);
  if (nextStatus === "saving") {
    state.markdownPersistStatus.textContent = "Saving...";
    return;
  }
  if (nextStatus === "error") {
    state.markdownPersistStatus.textContent = "Save failed";
    return;
  }
  state.markdownPersistStatus.textContent = "Saved";
}

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

export const MARKDOWN_SLASH_COMMANDS = [
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
