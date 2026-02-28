/**
 * Bridge Markdown Editor
 *
 * Markdown editor lifecycle: Lexical rich-text setup, DOM scaffolding
 * (toolbar, surface, inline toolbar, block drag, textarea fallback),
 * content application, presence/selection pills, and edit-mode toggling.
 *
 * NOTE: This module participates in a circular import cycle with
 * bridge-markdown-core.ts and bridge-markdown-yjs.ts.
 * All cross-module calls must remain in function bodies (never at module top-level).
 */

import { state } from "./bridge-state.ts";
import { getConfig, isMarkdownPage } from "./bridge-config.ts";
import { DATA_VF_IGNORE } from "./bridge-constants.ts";

import {
  composeMarkdownContent,
  extractMarkdownParts,
  extractRawBlocksForEditor,
  handleMarkdownLocalChange,
  parseMdxImportMap,
  postMarkdownEditorReady,
  restoreRawBlocksFromEditor,
  saveMarkdownContent,
} from "./bridge-markdown-core.ts";

import { disposeMarkdownYjs, setupMarkdownYjsConnection } from "./bridge-markdown-yjs.ts";

import {
  clearMarkdownSelectionOverlay,
  clearMarkdownSelectionSync,
  scheduleMarkdownSelectionOverlayRender,
  scheduleMarkdownSelectionSync,
  sourceSelectionToEditorRange,
} from "./bridge-selection.ts";

import {
  handleMarkdownSlashMenuKeydown,
  hideMarkdownSlashMenu,
  scheduleMarkdownSlashMenuUpdate,
} from "./bridge-slash-menu.ts";

import {
  hideMarkdownInlineToolbar,
  insertMarkdownLink,
  scheduleMarkdownInlineToolbarUpdate,
  setMarkdownBlockType,
  toggleMarkdownInlineFormat,
} from "./bridge-inline-toolbar.ts";

import {
  autoScrollMarkdownSurfaceDuringDrag,
  createMarkdownDragGhost,
  getMarkdownBlockHoverIndexFromPointer,
  getMarkdownDropSlotIndexFromPointer,
  getMarkdownTopLevelBlocks,
  hideMarkdownBlockDragHandle,
  hideMarkdownBlockDragUi,
  hideMarkdownBlockDropIndicator,
  moveMarkdownCurrentBlockByDelta,
  moveMarkdownLexicalBlock,
  positionMarkdownBlockDragHandle,
  refreshMarkdownBlockDragHandlePosition,
  removeMarkdownDragGhost,
  setMarkdownMdxBlocks,
  showMarkdownBlockDropIndicator,
} from "./bridge-block-drag.ts";

// ---------------------------------------------------------------------------
// setupMarkdownLexicalEditor
// ---------------------------------------------------------------------------

export function setupMarkdownLexicalEditor(): void {
  if (
    !state.markdownEditorSurface ||
    state.markdownLexicalApi ||
    state.markdownLexicalSetupPromise
  ) {
    return;
  }

  state.markdownLexicalSetupPromise = Promise.all([
    import("https://esm.sh/lexical@0.21.0?target=es2022"),
    import("https://esm.sh/@lexical/rich-text@0.21.0?target=es2022"),
    import("https://esm.sh/@lexical/list@0.21.0?target=es2022"),
    import("https://esm.sh/@lexical/markdown@0.21.0?target=es2022"),
    import("https://esm.sh/@lexical/history@0.21.0?target=es2022"),
    import("https://esm.sh/@lexical/selection@0.21.0?target=es2022"),
  ])
    .then(function (modules: any[]) {
      if (!state.markdownEditorSurface) {
        return;
      }

      const lexicalModule = modules[0];
      const richTextModule = modules[1];
      const listModule = modules[2];
      const markdownModule = modules[3];
      const historyModule = modules[4];
      const selectionModule = modules[5];

      const editor = lexicalModule.createEditor({
        namespace: "veryfront-markdown-preview",
        nodes: [
          richTextModule.HeadingNode,
          richTextModule.QuoteNode,
          listModule.ListNode,
          listModule.ListItemNode,
        ],
        onError: function (error: unknown) {
          console.error("[StudioBridge] Markdown Lexical error", error);
        },
      });

      const unregisterRichText = richTextModule.registerRichText(editor);
      const unregisterList = listModule.registerList(editor);
      const unregisterHistory = historyModule.registerHistory(
        editor,
        historyModule.createEmptyHistoryState(),
        1000,
      );
      const unregisterUpdate = editor.registerUpdateListener(function (
        update: any,
      ) {
        if (state.markdownApplyingRemoteUpdate) {
          return;
        }

        let nextContent = "";
        update.editorState.read(function () {
          nextContent = markdownModule.$convertToMarkdownString(
            markdownModule.TRANSFORMERS,
            undefined,
            true,
          );
        });
        const restoredBody = restoreRawBlocksFromEditor(nextContent);
        const fullContent = composeMarkdownContent(restoredBody);

        if (fullContent === state.markdownLexicalRenderedContent) {
          return;
        }
        state.markdownLexicalRenderedContent = fullContent;

        handleMarkdownLocalChange(nextContent);
        scheduleMarkdownSlashMenuUpdate();
        scheduleMarkdownInlineToolbarUpdate();
      });

      editor.setRootElement(state.markdownEditorSurface);
      editor.update(function () {
        const root = lexicalModule.$getRoot();
        if (root.getChildrenSize() === 0) {
          root.append(lexicalModule.$createParagraphNode());
        }
      });
      state.markdownLexicalApi = {
        editor: editor,
        lexicalModule: lexicalModule,
        richTextModule: richTextModule,
        listModule: listModule,
        markdownModule: markdownModule,
        selectionModule: selectionModule,
        unregisterRichText: unregisterRichText,
        unregisterList: unregisterList,
        unregisterHistory: unregisterHistory,
        unregisterUpdate: unregisterUpdate,
      };

      state.markdownEditorSurface.style.display = "block";
      if (state.markdownEditorTextarea) {
        state.markdownEditorTextarea.style.display = "none";
      }

      applyMarkdownContent(state.markdownCurrentContent);
      hideMarkdownBlockDropIndicator();
    })
    .catch(function (error: unknown) {
      console.warn(
        "[StudioBridge] Failed to load Lexical markdown editor; falling back to textarea",
        error,
      );
      if (state.markdownEditorSurface) {
        state.markdownEditorSurface.style.display = "none";
      }
      if (state.markdownEditorTextarea) {
        state.markdownEditorTextarea.style.display = "block";
      }
      hideMarkdownSlashMenu();
      hideMarkdownInlineToolbar();
      hideMarkdownBlockDragUi();
      clearMarkdownSelectionOverlay();
    });
}

// ---------------------------------------------------------------------------
// focusMarkdownEditor
// ---------------------------------------------------------------------------

export function focusMarkdownEditor(): void {
  if (state.markdownLexicalApi && state.markdownEditorSurface) {
    state.markdownEditorSurface.focus();
    return;
  }
  if (state.markdownEditorTextarea) {
    state.markdownEditorTextarea.focus();
  }
}

// ---------------------------------------------------------------------------
// applyMarkdownHistoryCommand
// ---------------------------------------------------------------------------

export function applyMarkdownHistoryCommand(command: any): void {
  if (
    !state.markdownLexicalApi ||
    !state.markdownLexicalApi.editor ||
    !state.markdownLexicalApi.lexicalModule
  ) {
    return;
  }
  if (!command) {
    return;
  }

  state.markdownLexicalApi.editor.focus();
  state.markdownLexicalApi.editor.dispatchCommand(command, undefined);
  scheduleMarkdownSelectionSync();
  scheduleMarkdownSelectionOverlayRender();
  scheduleMarkdownSlashMenuUpdate();
  scheduleMarkdownInlineToolbarUpdate();
}

// ---------------------------------------------------------------------------
// applyMarkdownContent
// ---------------------------------------------------------------------------

export function applyMarkdownContent(content: unknown): void {
  if (typeof content !== "string") {
    return;
  }

  if (
    state.markdownLexicalApi &&
    state.markdownLexicalRenderedContent === content
  ) {
    console.debug(
      "[StudioBridge] applyMarkdownContent: skipped (content unchanged)",
    );
    state.markdownCurrentContent = content;
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
    scheduleMarkdownInlineToolbarUpdate();
    hideMarkdownBlockDropIndicator();
    return;
  }

  console.debug(
    "[StudioBridge] applyMarkdownContent: rebuilding Lexical DOM, content length:",
    content.length,
    "rendered match:",
    state.markdownLexicalRenderedContent === content,
    "current match:",
    state.markdownCurrentContent === content,
  );

  const mdxImportMap = parseMdxImportMap(content);
  const parts = extractMarkdownParts(content);
  const extracted = extractRawBlocksForEditor(parts.body, mdxImportMap);
  const editorContent = extracted.editorBody;
  const mdxBlocks = Array.isArray(extracted.mdxBlocks) ? extracted.mdxBlocks : [];
  state.markdownFrontmatter = parts.frontmatter;
  state.markdownRawBlocks = extracted.rawBlocks;
  state.markdownRawBlockTokenPrefix = extracted.tokenPrefix;
  state.markdownLatestMdxImportMap = mdxImportMap;
  setMarkdownMdxBlocks(mdxBlocks);

  state.markdownCurrentContent = content;
  state.markdownCurrentEditorContent = editorContent;

  if (state.markdownLexicalApi) {
    state.markdownApplyingRemoteUpdate = true;
    try {
      state.markdownLexicalRenderedContent = content;
      state.markdownLexicalApi.editor.update(
        function () {
          const lexicalModule = state.markdownLexicalApi.lexicalModule;
          const markdownModule = state.markdownLexicalApi.markdownModule;
          const root = lexicalModule.$getRoot();
          root.clear();
          markdownModule.$convertFromMarkdownString(
            editorContent,
            markdownModule.TRANSFORMERS,
            undefined,
            true,
          );
          if (root.getChildrenSize() === 0) {
            root.append(lexicalModule.$createParagraphNode());
          }
        },
        { discrete: true },
      );
    } finally {
      state.markdownApplyingRemoteUpdate = false;
    }
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
    scheduleMarkdownInlineToolbarUpdate();
    hideMarkdownBlockDropIndicator();
    return;
  }

  if (
    !state.markdownEditorTextarea ||
    state.markdownEditorTextarea.value === editorContent
  ) {
    clearMarkdownSelectionOverlay();
    hideMarkdownSlashMenu();
    hideMarkdownInlineToolbar();
    hideMarkdownBlockDragUi();
    return;
  }

  const selectionStart = state.markdownEditorTextarea.selectionStart;
  const selectionEnd = state.markdownEditorTextarea.selectionEnd;
  state.markdownEditorTextarea.value = editorContent;

  if (
    typeof selectionStart === "number" &&
    typeof selectionEnd === "number"
  ) {
    const max = state.markdownEditorTextarea.value.length;
    state.markdownEditorTextarea.setSelectionRange(
      Math.min(selectionStart, max),
      Math.min(selectionEnd, max),
    );
  }
  clearMarkdownSelectionOverlay();
  hideMarkdownSlashMenu();
  hideMarkdownInlineToolbar();
  hideMarkdownBlockDragUi();
}

// ---------------------------------------------------------------------------
// setMarkdownPersistStatus
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

// ---------------------------------------------------------------------------
// setMarkdownPresence
// ---------------------------------------------------------------------------

export function setMarkdownPresence(users: any[]): void {
  state.markdownLatestPresenceUsers = Array.isArray(users) ? users : [];
  if (!state.markdownPresenceRoot) {
    return;
  }

  state.markdownPresenceRoot.textContent = "";
  if (!Array.isArray(users) || users.length === 0) {
    state.markdownPresenceRoot.style.display = "none";
    return;
  }

  const seenIds: Record<string, boolean> = {};
  const uniqueUsers = users.filter(function (user: any) {
    if (!user || typeof user.name !== "string") {
      return false;
    }
    const uniqueKey = user.id || user.name;
    if (seenIds[uniqueKey]) {
      return false;
    }
    seenIds[uniqueKey] = true;
    return true;
  });
  const visibleUsers = uniqueUsers.slice(0, 4);

  if (visibleUsers.length === 0) {
    state.markdownPresenceRoot.style.display = "none";
    return;
  }

  state.markdownPresenceRoot.style.display = "inline-flex";

  for (const user of visibleUsers) {
    const pill = document.createElement("div");
    pill.className = "vf-markdown-editor__presence-pill";
    pill.setAttribute(DATA_VF_IGNORE, "true");
    pill.setAttribute(
      "data-current",
      user.isCurrentUser ? "true" : "false",
    );
    pill.setAttribute("data-agent", user.isAgent ? "true" : "false");
    pill.textContent = user.isCurrentUser ? "You" : user.name;

    const color = typeof user.color === "string" && user.color ? user.color : "#6b7280";
    pill.style.borderLeftColor = color;

    state.markdownPresenceRoot.appendChild(pill);
  }

  if (uniqueUsers.length > visibleUsers.length) {
    const extra = document.createElement("div");
    extra.className = "vf-markdown-editor__presence-pill";
    extra.setAttribute(DATA_VF_IGNORE, "true");
    extra.textContent = "+" + String(uniqueUsers.length - visibleUsers.length);
    state.markdownPresenceRoot.appendChild(extra);
  }
}

// ---------------------------------------------------------------------------
// setMarkdownSelections
// ---------------------------------------------------------------------------

export function setMarkdownSelections(selections: any[]): void {
  state.markdownLatestSelections = Array.isArray(selections) ? selections : [];
  if (!state.markdownSelectionsRoot) {
    return;
  }

  state.markdownSelectionsRoot.textContent = "";
  state.markdownOverlaySelections = [];
  if (!Array.isArray(selections) || selections.length === 0) {
    state.markdownSelectionsRoot.style.display = "none";
    clearMarkdownSelectionOverlay();
    return;
  }

  const visibleSelections = selections
    .filter(function (selection: any) {
      return (
        selection &&
        typeof selection.name === "string" &&
        typeof selection.start === "number" &&
        typeof selection.end === "number"
      );
    })
    .slice(0, 4);

  if (visibleSelections.length === 0) {
    state.markdownSelectionsRoot.style.display = "none";
    clearMarkdownSelectionOverlay();
    return;
  }

  state.markdownSelectionsRoot.style.display = "inline-flex";

  for (const selection of visibleSelections) {
    const pill = document.createElement("div");
    pill.className = "vf-markdown-editor__selection-pill";
    pill.setAttribute(DATA_VF_IGNORE, "true");
    const color = typeof selection.color === "string" && selection.color
      ? selection.color
      : "#6b7280";
    const displayName = selection.isCurrentUser ? "You" : selection.name;
    pill.style.borderLeftColor = color;

    const start = Math.max(0, Math.trunc(selection.start));
    const end = Math.max(0, Math.trunc(selection.end));
    const rangeLabel = start === end ? "@" + String(start) : String(start) + "-" + String(end);
    pill.textContent = displayName + " " + rangeLabel;
    state.markdownSelectionsRoot.appendChild(pill);

    const editorRange = sourceSelectionToEditorRange(start, end);
    if (!editorRange) {
      continue;
    }

    state.markdownOverlaySelections.push({
      name: displayName,
      color: color,
      start: editorRange.start,
      end: editorRange.end,
    });
  }

  if (selections.length > visibleSelections.length) {
    const extra = document.createElement("div");
    extra.className = "vf-markdown-editor__selection-pill";
    extra.setAttribute(DATA_VF_IGNORE, "true");
    extra.textContent = "+" + String(selections.length - visibleSelections.length);
    state.markdownSelectionsRoot.appendChild(extra);
  }

  scheduleMarkdownSelectionOverlayRender();
}

// ---------------------------------------------------------------------------
// ensureMarkdownEditor
// ---------------------------------------------------------------------------

export function ensureMarkdownEditor(): HTMLElement | undefined {
  if (state.markdownEditorRoot) {
    return state.markdownEditorRoot;
  }

  const editorRoot = document.createElement("div");
  editorRoot.className = "vf-markdown-editor";
  editorRoot.setAttribute(DATA_VF_IGNORE, "true");

  // -- Toolbar ---------------------------------------------------------------

  const toolbar = document.createElement("div");
  toolbar.className = "vf-markdown-editor__toolbar";
  toolbar.setAttribute(DATA_VF_IGNORE, "true");

  const title = document.createElement("div");
  title.className = "vf-markdown-editor__title";
  title.setAttribute(DATA_VF_IGNORE, "true");
  title.textContent = getConfig().pagePath || "Untitled";

  const actions = document.createElement("div");
  actions.className = "vf-markdown-editor__actions";
  actions.setAttribute(DATA_VF_IGNORE, "true");

  const status = document.createElement("div");
  status.className = "vf-markdown-editor__status";
  status.setAttribute(DATA_VF_IGNORE, "true");
  status.textContent = "";
  status.setAttribute("data-state", "");

  const presence = document.createElement("div");
  presence.className = "vf-markdown-editor__presence";
  presence.setAttribute(DATA_VF_IGNORE, "true");

  const selections = document.createElement("div");
  selections.className = "vf-markdown-editor__selections";
  selections.setAttribute(DATA_VF_IGNORE, "true");

  const exitButton = document.createElement("button");
  exitButton.type = "button";
  exitButton.className = "vf-markdown-editor__exit";
  exitButton.setAttribute(DATA_VF_IGNORE, "true");
  exitButton.textContent = "Done";
  exitButton.addEventListener("click", function () {
    setMarkdownEditMode(false);
  });

  actions.appendChild(status);
  actions.appendChild(presence);
  actions.appendChild(selections);
  actions.appendChild(exitButton);

  toolbar.appendChild(title);
  toolbar.appendChild(actions);

  // -- MDX blocks bar --------------------------------------------------------

  const mdxBlocks = document.createElement("div");
  mdxBlocks.className = "vf-markdown-editor__mdx-blocks";
  mdxBlocks.setAttribute(DATA_VF_IGNORE, "true");

  // -- Surface (contenteditable) ---------------------------------------------

  const surface = document.createElement("div");
  surface.className = "vf-markdown-editor__surface markdown-body";
  surface.setAttribute(DATA_VF_IGNORE, "true");
  surface.setAttribute("contenteditable", "true");
  surface.setAttribute("aria-label", "Markdown editor");
  surface.addEventListener("keyup", scheduleMarkdownSelectionSync);
  surface.addEventListener("mouseup", scheduleMarkdownSelectionSync);
  surface.addEventListener("input", function () {
    scheduleMarkdownSelectionSync();
    scheduleMarkdownSlashMenuUpdate();
  });
  surface.addEventListener("keyup", scheduleMarkdownSlashMenuUpdate);
  surface.addEventListener("mouseup", scheduleMarkdownSlashMenuUpdate);
  surface.addEventListener("keydown", handleMarkdownSlashMenuKeydown as EventListener);
  surface.addEventListener("keydown", function (event: KeyboardEvent) {
    if (!event.shiftKey || !event.altKey) {
      return;
    }
    if (event.key === "ArrowUp") {
      const moved = moveMarkdownCurrentBlockByDelta(-1);
      if (moved) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      const moved = moveMarkdownCurrentBlockByDelta(1);
      if (moved) {
        event.preventDefault();
      }
    }
  });
  surface.addEventListener("keydown", function (event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      saveMarkdownContent();
    }
  });
  surface.addEventListener("scroll", scheduleMarkdownSelectionOverlayRender);
  surface.addEventListener("scroll", scheduleMarkdownSlashMenuUpdate);
  surface.addEventListener("keyup", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("mouseup", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("input", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("scroll", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("scroll", refreshMarkdownBlockDragHandlePosition);

  // -- Surface wrap ----------------------------------------------------------

  const surfaceWrap = document.createElement("div");
  surfaceWrap.className = "vf-markdown-editor__surface-wrap";
  surfaceWrap.setAttribute(DATA_VF_IGNORE, "true");

  // -- Selection overlay -----------------------------------------------------

  const selectionOverlay = document.createElement("div");
  selectionOverlay.className = "vf-markdown-editor__selection-overlay";
  selectionOverlay.setAttribute(DATA_VF_IGNORE, "true");

  // -- Slash menu ------------------------------------------------------------

  const slashMenu = document.createElement("div");
  slashMenu.className = "vf-markdown-editor__slash-menu";
  slashMenu.setAttribute(DATA_VF_IGNORE, "true");

  // -- Inline toolbar --------------------------------------------------------

  const inlineToolbar = document.createElement("div");
  inlineToolbar.className = "vf-markdown-editor__inline-toolbar";
  inlineToolbar.setAttribute(DATA_VF_IGNORE, "true");

  // Local helpers for inline buttons / separators
  function createInlineButton(
    label: string,
    format: string | null,
    handler: (() => void) | null,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vf-markdown-editor__inline-button";
    btn.setAttribute(DATA_VF_IGNORE, "true");
    btn.textContent = label;
    if (format) {
      btn.setAttribute("data-format", format);
    }
    btn.addEventListener("mousedown", function (event: MouseEvent) {
      event.preventDefault();
    });
    btn.addEventListener("click", function (event: MouseEvent) {
      event.preventDefault();
      if (handler) {
        handler();
      }
    });
    return btn;
  }

  function createSeparator(): HTMLDivElement {
    const sep = document.createElement("div");
    sep.className = "vf-markdown-editor__inline-separator";
    return sep;
  }

  // -- Block dropdown --------------------------------------------------------

  const blockDropdown = document.createElement("div");
  blockDropdown.className = "vf-markdown-editor__block-dropdown";
  blockDropdown.setAttribute(DATA_VF_IGNORE, "true");

  const blockTypes = [
    { type: "paragraph", label: "Paragraph" },
    { type: "h1", label: "Heading 1" },
    { type: "h2", label: "Heading 2" },
    { type: "h3", label: "Heading 3" },
    { type: "bullet", label: "Bulleted list" },
    { type: "number", label: "Numbered list" },
    { type: "quote", label: "Quote" },
  ];
  blockTypes.forEach(function (bt) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "vf-markdown-editor__block-option";
    opt.setAttribute(DATA_VF_IGNORE, "true");
    opt.setAttribute("data-block-type", bt.type);
    opt.textContent = bt.label;
    opt.addEventListener("mousedown", function (event: MouseEvent) {
      event.preventDefault();
    });
    opt.addEventListener("click", function (event: MouseEvent) {
      event.preventDefault();
      setMarkdownBlockType(bt.type);
      blockDropdown.style.display = "none";
      scheduleMarkdownInlineToolbarUpdate();
    });
    blockDropdown.appendChild(opt);
  });

  // -- Block trigger (pilcrow) -----------------------------------------------

  const blockTrigger = document.createElement("button");
  blockTrigger.type = "button";
  blockTrigger.className = "vf-markdown-editor__block-trigger";
  blockTrigger.setAttribute(DATA_VF_IGNORE, "true");
  blockTrigger.textContent = String.fromCharCode(182); // ¶
  blockTrigger.addEventListener("mousedown", function (event: MouseEvent) {
    event.preventDefault();
  });
  blockTrigger.addEventListener("click", function (event: MouseEvent) {
    event.preventDefault();
    const isOpen = blockDropdown.style.display === "block";
    blockDropdown.style.display = isOpen ? "none" : "block";
  });

  // -- Inline toolbar rows ---------------------------------------------------

  const row1 = document.createElement("div");
  row1.className = "vf-markdown-editor__inline-row";
  row1.appendChild(blockTrigger);
  row1.appendChild(createSeparator());
  row1.appendChild(
    createInlineButton("B", "bold", function () {
      toggleMarkdownInlineFormat("bold");
    }),
  );
  row1.appendChild(
    createInlineButton("I", "italic", function () {
      toggleMarkdownInlineFormat("italic");
    }),
  );
  row1.appendChild(
    createInlineButton("U", "underline", function () {
      toggleMarkdownInlineFormat("underline");
    }),
  );

  const row2 = document.createElement("div");
  row2.className = "vf-markdown-editor__inline-row";
  row2.appendChild(
    createInlineButton(String.fromCodePoint(128279), null, function () {
      insertMarkdownLink();
    }),
  );
  row2.appendChild(
    createInlineButton("S", "strikethrough", function () {
      toggleMarkdownInlineFormat("strikethrough");
    }),
  );
  row2.appendChild(
    createInlineButton("</>", "code", function () {
      toggleMarkdownInlineFormat("code");
    }),
  );

  inlineToolbar.appendChild(row1);
  inlineToolbar.appendChild(row2);
  inlineToolbar.appendChild(blockDropdown);

  // -- Global listeners for block dropdown -----------------------------------
  // These self-guard via blockDropdown.style.display check and are closures
  // over local DOM refs, so they persist for the editor's lifetime.

  document.addEventListener("mousedown", function (event: MouseEvent) {
    if (
      blockDropdown.style.display === "block" &&
      !blockDropdown.contains(event.target as Node) &&
      event.target !== blockTrigger
    ) {
      blockDropdown.style.display = "none";
    }
  });

  document.addEventListener(
    "keydown",
    function (event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        blockDropdown.style.display === "block"
      ) {
        event.preventDefault();
        event.stopPropagation();
        blockDropdown.style.display = "none";
      }
    },
    true,
  );

  // -- Block drag handle -----------------------------------------------------

  const blockDragHandle = document.createElement("button");
  blockDragHandle.type = "button";
  blockDragHandle.className = "vf-markdown-editor__block-handle";
  blockDragHandle.setAttribute(DATA_VF_IGNORE, "true");
  blockDragHandle.textContent = "::";
  blockDragHandle.draggable = true;
  blockDragHandle.setAttribute("data-dragging", "false");
  blockDragHandle.addEventListener("dragstart", function (event: DragEvent) {
    const indexText = blockDragHandle.getAttribute("data-block-index");
    const index = Number(indexText);
    if (!Number.isInteger(index)) {
      event.preventDefault();
      return;
    }
    state.markdownBlockDragSourceIndex = index;
    state.markdownBlockDragActive = true;
    blockDragHandle.setAttribute("data-dragging", "true");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));

      const blocks = getMarkdownTopLevelBlocks();
      const block = blocks[index];
      removeMarkdownDragGhost();
      if (block) {
        const ghost = createMarkdownDragGhost(block);
        document.body.appendChild(ghost);
        state.markdownBlockDragGhost = ghost;
        event.dataTransfer.setDragImage(ghost, 14, 14);
      }
    }
    showMarkdownBlockDropIndicator(index);
  });
  blockDragHandle.addEventListener("mouseenter", function () {
    if (state.markdownBlockHandleHoverIndex >= 0) {
      blockDragHandle.style.display = "block";
    }
  });
  blockDragHandle.addEventListener("mouseleave", function (event: MouseEvent) {
    if (state.markdownBlockDragActive) {
      return;
    }
    const next = event.relatedTarget as Node | null;
    if (
      next &&
      state.markdownEditorSurface &&
      state.markdownEditorSurface.contains(next)
    ) {
      return;
    }
    hideMarkdownBlockDragHandle();
  });
  blockDragHandle.addEventListener("dragend", function () {
    hideMarkdownBlockDragUi();
  });

  // -- Block drop indicator / label ------------------------------------------

  const blockDropIndicator = document.createElement("div");
  blockDropIndicator.className = "vf-markdown-editor__block-drop-indicator";
  blockDropIndicator.setAttribute(DATA_VF_IGNORE, "true");

  const blockDropLabel = document.createElement("div");
  blockDropLabel.className = "vf-markdown-editor__block-drop-label";
  blockDropLabel.setAttribute(DATA_VF_IGNORE, "true");

  // -- Surface wrap assembly -------------------------------------------------

  surfaceWrap.appendChild(surface);
  surfaceWrap.appendChild(selectionOverlay);

  // -- Textarea (fallback) ---------------------------------------------------

  const textarea = document.createElement("textarea");
  textarea.className = "vf-markdown-editor__textarea";
  textarea.setAttribute(DATA_VF_IGNORE, "true");
  textarea.setAttribute("aria-label", "Markdown editor");
  textarea.spellcheck = false;
  textarea.addEventListener("input", function () {
    handleMarkdownLocalChange(textarea.value);
    scheduleMarkdownSelectionSync();
    hideMarkdownSlashMenu();
  });
  textarea.addEventListener("select", scheduleMarkdownSelectionSync);
  textarea.addEventListener("keyup", scheduleMarkdownSelectionSync);
  textarea.addEventListener("click", scheduleMarkdownSelectionSync);
  textarea.addEventListener("input", clearMarkdownSelectionOverlay);
  textarea.addEventListener("keydown", function () {
    hideMarkdownSlashMenu();
    hideMarkdownInlineToolbar();
    hideMarkdownBlockDragUi();
  });

  // -- Surface mouse/drag/drop events ----------------------------------------

  surface.addEventListener("mousemove", function (event: MouseEvent) {
    if (state.markdownBlockDragActive) {
      return;
    }

    const index = getMarkdownBlockHoverIndexFromPointer(
      event.target as Element,
      event.clientX,
      event.clientY,
    );
    if (index < 0) {
      hideMarkdownBlockDragHandle();
      return;
    }
    const blocks = getMarkdownTopLevelBlocks();
    const block = blocks[index];
    if (!block) {
      hideMarkdownBlockDragHandle();
      return;
    }
    positionMarkdownBlockDragHandle(block, index);
  });

  surface.addEventListener("mouseleave", function (event: MouseEvent) {
    if (!state.markdownBlockDragActive) {
      const next = event.relatedTarget as Node | null;
      if (
        next &&
        state.markdownBlockDragHandle &&
        (next === state.markdownBlockDragHandle ||
          state.markdownBlockDragHandle.contains(next))
      ) {
        return;
      }
      hideMarkdownBlockDragHandle();
    }
  });

  surface.addEventListener("dragover", function (event: DragEvent) {
    if (!state.markdownBlockDragActive) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    autoScrollMarkdownSurfaceDuringDrag(event.clientY);
    const slotIndex = getMarkdownDropSlotIndexFromPointer(event.clientY);
    if (slotIndex >= 0) {
      showMarkdownBlockDropIndicator(slotIndex);
    }
  });

  surface.addEventListener("drop", function (event: DragEvent) {
    if (!state.markdownBlockDragActive) {
      return;
    }
    event.preventDefault();

    const fallbackSlot = getMarkdownDropSlotIndexFromPointer(event.clientY);
    const slotIndex = state.markdownBlockDropSlotIndex >= 0
      ? state.markdownBlockDropSlotIndex
      : fallbackSlot;
    const sourceIndex = state.markdownBlockDragSourceIndex;
    hideMarkdownBlockDragUi();
    if (sourceIndex < 0 || slotIndex < 0) {
      return;
    }
    moveMarkdownLexicalBlock(sourceIndex, slotIndex);
  });

  // -- Assemble editor root --------------------------------------------------

  editorRoot.appendChild(toolbar);
  editorRoot.appendChild(mdxBlocks);
  editorRoot.appendChild(surfaceWrap);
  editorRoot.appendChild(textarea);
  editorRoot.appendChild(slashMenu);
  editorRoot.appendChild(inlineToolbar);
  editorRoot.appendChild(blockDragHandle);
  editorRoot.appendChild(blockDropIndicator);
  editorRoot.appendChild(blockDropLabel);
  document.body.appendChild(editorRoot);

  // -- Store references in state ---------------------------------------------

  state.markdownEditorRoot = editorRoot;
  state.markdownEditorSurface = surface;
  state.markdownEditorTextarea = textarea;
  state.markdownPersistStatus = status;
  state.markdownPresenceRoot = presence;
  state.markdownSelectionsRoot = selections;
  state.markdownMdxBlocksRoot = mdxBlocks;
  state.markdownSelectionOverlayRoot = selectionOverlay;
  state.markdownSlashMenuRoot = slashMenu;
  state.markdownInlineToolbarRoot = inlineToolbar;
  state.markdownBlockDragHandle = blockDragHandle;
  state.markdownBlockDropIndicator = blockDropIndicator;
  state.markdownBlockDropLabel = blockDropLabel;
  setMarkdownMdxBlocks(state.markdownLatestMdxBlocks);
  setMarkdownPresence(state.markdownLatestPresenceUsers);
  setMarkdownSelections(state.markdownLatestSelections);
  setupMarkdownLexicalEditor();
  applyMarkdownContent(state.markdownCurrentContent);

  return editorRoot;
}

// ---------------------------------------------------------------------------
// setMarkdownEditMode
// ---------------------------------------------------------------------------

function registerMarkdownGlobalListeners(): void {
  // Clean up any previous listeners before re-registering
  for (const cleanup of state.markdownGlobalListenerCleanups) cleanup();
  state.markdownGlobalListenerCleanups = [];

  const onSelectionChange = function () {
    if (
      !state.markdownEditorRoot ||
      state.markdownEditorRoot.style.display !== "block"
    ) {
      return;
    }
    scheduleMarkdownSelectionSync();
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
    scheduleMarkdownInlineToolbarUpdate();
  };
  document.addEventListener("selectionchange", onSelectionChange);
  state.markdownGlobalListenerCleanups.push(
    () => document.removeEventListener("selectionchange", onSelectionChange),
  );

  window.addEventListener("resize", scheduleMarkdownSelectionOverlayRender);
  window.addEventListener("resize", scheduleMarkdownSlashMenuUpdate);
  window.addEventListener("resize", scheduleMarkdownInlineToolbarUpdate);
  window.addEventListener("resize", hideMarkdownBlockDragUi);
  state.markdownGlobalListenerCleanups.push(
    () => window.removeEventListener("resize", scheduleMarkdownSelectionOverlayRender),
    () => window.removeEventListener("resize", scheduleMarkdownSlashMenuUpdate),
    () => window.removeEventListener("resize", scheduleMarkdownInlineToolbarUpdate),
    () => window.removeEventListener("resize", hideMarkdownBlockDragUi),
  );
}

export function setMarkdownEditMode(enabled: boolean): void {
  const markdownBody = document.getElementById("markdown-body");
  if (!markdownBody || !isMarkdownPage()) {
    return;
  }

  if (enabled) {
    ensureMarkdownEditor();
    registerMarkdownGlobalListeners();
    setupMarkdownLexicalEditor();
    markdownBody.style.display = "none";
    if (state.markdownEditorRoot) {
      state.markdownEditorRoot.style.display = "block";
    }
    state.markdownHasUnsavedChanges = false;
    focusMarkdownEditor();
    scheduleMarkdownSelectionSync();
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
    scheduleMarkdownInlineToolbarUpdate();
    postMarkdownEditorReady();

    // Self-connect to Yjs when server-injected config is available
    if (
      getConfig().wsUrl &&
      getConfig().yjsGuid &&
      !state.markdownYDoc
    ) {
      setupMarkdownYjsConnection({
        wsUrl: getConfig().wsUrl,
        guid: getConfig().yjsGuid,
        fileId: state.markdownFileId,
      });
    }
  } else {
    markdownBody.style.display = "";
    if (state.markdownEditorRoot) {
      state.markdownEditorRoot.style.display = "none";
    }
    hideMarkdownSlashMenu();
    hideMarkdownInlineToolbar();
    hideMarkdownBlockDragUi();
    state.markdownOverlaySelections = [];
    clearMarkdownSelectionOverlay();
    clearMarkdownSelectionSync();
    disposeMarkdownYjs();

    // Remove global listeners registered by registerMarkdownGlobalListeners
    for (const cleanup of state.markdownGlobalListenerCleanups) cleanup();
    state.markdownGlobalListenerCleanups = [];
  }

  const nextUrl = new URL(window.location.href);
  if (enabled) {
    nextUrl.searchParams.set("edit", "true");
  } else {
    nextUrl.searchParams.delete("edit");
  }
  window.history.replaceState(window.history.state, "", nextUrl.toString());
}

// ---------------------------------------------------------------------------
// ensureMarkdownEditButton
// ---------------------------------------------------------------------------

export function ensureMarkdownEditButton(): void {
  if (state.markdownEditButton || !isMarkdownPage()) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "vf-markdown-edit-button";
  button.textContent = "Edit";
  button.setAttribute(DATA_VF_IGNORE, "true");
  button.addEventListener("click", function () {
    setMarkdownEditMode(true);
  });

  document.body.appendChild(button);
  state.markdownEditButton = button;
}

// ---------------------------------------------------------------------------
// setupMarkdownEditor
// ---------------------------------------------------------------------------

export function setupMarkdownEditor(params: URLSearchParams): void {
  if (!isMarkdownPage()) {
    return;
  }

  state.markdownFileId = params.get("vf_file_id") || getConfig().pageId || null;
  ensureMarkdownEditButton();

  if (params.get("edit") === "true") {
    setMarkdownEditMode(true);
  }
}
