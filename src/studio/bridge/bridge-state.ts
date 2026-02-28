/**
 * Bridge Shared State
 *
 * Single mutable state object shared across all bridge modules.
 * All former IIFE `let` variables live here.
 */

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
  markdownOverlaySelections: [] as any[],
  markdownSelectionOverlayRenderFrame: null as number | null,

  // Slash menu
  markdownSlashMenuRoot: null as HTMLElement | null,
  markdownSlashMenuTimer: null as ReturnType<typeof setTimeout> | null,
  markdownSlashMenuContext: null as any,
  markdownSlashMenuCommands: [] as any[],
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

  // Lexical
  markdownLexicalApi: null as any,
  markdownLexicalSetupPromise: null as Promise<void> | null,

  // Markdown content
  markdownCurrentContent: "",
  markdownCurrentEditorContent: "",
  markdownLexicalRenderedContent: null as string | null,
  markdownApplyingRemoteUpdate: false,
  markdownFrontmatter: "",
  markdownRawBlocks: [] as string[],
  markdownRawBlockTokenPrefix: "VF_RAW_BLOCK",
  markdownLatestMdxBlocks: [] as any[],
  markdownLatestMdxImportMap: {} as Record<string, any>,
  markdownLatestPresenceUsers: [] as any[],
  markdownLatestSelections: [] as any[],
  markdownHasUnsavedChanges: false,
  markdownSaveInProgress: false,

  // Yjs
  markdownYDoc: null as any,
  markdownYProvider: null as any,
  markdownYText: null as any,
  markdownYjsConnected: false,
  markdownYjsSetupId: 0,
  markdownYjsY: null as any,
  markdownPendingSelection: null as any,

  // Console
  originalConsole: {} as Record<string, (...args: any[]) => void>,
  logCounter: 0,

  // Screenshot
  html2canvasLoaded: false,
  html2canvasPromise: null as Promise<void> | null,
};

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
