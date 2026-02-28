/**
 * Bridge Editor State
 *
 * Mutable state for the markdown editor subsystem. Separated from
 * bridge-state.ts so editor modules can import only what they need
 * without depending on bridge infrastructure (inspector, console, etc.).
 *
 * Editor modules should import { editorState as state } from here.
 * Bridge modules that need both can import state from bridge-state
 * and editorState from here.
 */

import type {
  LexicalApi,
  MdxBlock,
  MdxImportEntry,
  PresenceUser,
  RemoteSelection,
  SlashMenuCommand,
  SlashMenuContext,
} from "./bridge-state.ts";

export const editorState = {
  // Editor DOM
  markdownEditorRoot: null as HTMLElement | null,
  markdownEditorSurface: null as HTMLElement | null,
  markdownEditorTextarea: null as HTMLTextAreaElement | null,
  markdownEditButton: null as HTMLButtonElement | null,
  markdownFileId: null as string | null,

  // Timers
  markdownSyncTimer: null as ReturnType<typeof setTimeout> | null,
  markdownSelectionSyncTimer: null as ReturnType<typeof setTimeout> | null,

  // Persist
  markdownPersistStatus: null as HTMLElement | null,

  // Presence & selections
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

  // Content
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
};

// ---------------------------------------------------------------------------
// Persist status (lives here with editor state, not bridge-state)
// ---------------------------------------------------------------------------

export function setMarkdownPersistStatus(status: string): void {
  if (!editorState.markdownPersistStatus) {
    return;
  }

  const nextStatus = status === "saving" || status === "saved" || status === "error"
    ? status
    : "saved";

  editorState.markdownPersistStatus.setAttribute("data-state", nextStatus);
  if (nextStatus === "saving") {
    editorState.markdownPersistStatus.textContent = "Saving...";
    return;
  }
  if (nextStatus === "error") {
    editorState.markdownPersistStatus.textContent = "Save failed";
    return;
  }
  editorState.markdownPersistStatus.textContent = "Saved";
}
