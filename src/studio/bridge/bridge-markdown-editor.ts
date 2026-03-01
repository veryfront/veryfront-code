/**
 * Bridge Markdown Editor
 *
 * Markdown editor lifecycle: Lexical rich-text setup, DOM scaffolding
 * (surface, inline toolbar, block drag, textarea fallback),
 * content application, overlay selections, and edit-mode toggling.
 *
 * NOTE: This module participates in a circular import cycle with
 * bridge-markdown-core.ts and bridge-markdown-yjs.ts.
 * All cross-module calls must remain in function bodies (never at module top-level).
 */

import { editorState as state } from "./bridge-editor-state.ts";
import { getConfig, isMarkdownPage } from "./bridge-config.ts";
import { btn, el } from "./bridge-dom-helpers.ts";

import {
  composeMarkdownContent,
  extractMarkdownParts,
  extractRawBlocksForEditor,
  handleMarkdownLocalChange,
  parseMdxImportMap,
  postMarkdownEditorReady,
  restoreRawBlocksFromEditor,
} from "./bridge-markdown-core.ts";

import { disposeMarkdownYjs, setupMarkdownYjsConnection } from "./bridge-markdown-yjs.ts";

import {
  buildEditorRenderedMaps,
  clearMarkdownSelectionOverlay,
  clearMarkdownSelectionSync,
  getDomRenderedText,
  getTextOffsetWithinRoot,
  scheduleMarkdownSelectionOverlayRender,
  scheduleMarkdownSelectionSync,
  setMarkdownEditorSelection,
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
          // Reconcile once remote apply settles so local edits during this window
          // are not silently dropped.
          state.markdownPendingLocalReconcile = true;
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

        // Use Range.toString() for rendered text — consistent with
        // getTextOffsetWithinRoot (1 \n per block boundary).
        const renderedText = getDomRenderedText(state.markdownEditorSurface);

        // Rebuild editor↔rendered offset maps after every edit
        const maps = buildEditorRenderedMaps(nextContent, renderedText);
        state.markdownEditorToRenderedMap = maps.editorToRendered;
        state.markdownRenderedToEditorMap = maps.renderedToEditor;

        const restoredBody = restoreRawBlocksFromEditor(nextContent);
        const fullContent = composeMarkdownContent(restoredBody);

        if (fullContent === state.markdownLexicalRenderedContent) {
          return;
        }
        state.markdownLexicalRenderedContent = fullContent;

        // Pass pre-computed fullContent to avoid redundant restore+compose
        handleMarkdownLocalChange(nextContent, fullContent);
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

  // Cancel any pending debounced sync from pre-remote local edits.
  if (state.markdownSyncTimer) {
    clearTimeout(state.markdownSyncTimer);
    state.markdownSyncTimer = null;
  }

  if (state.markdownLexicalApi) {
    // Save current selection offset before rebuilding the tree
    let savedSelectionOffset = -1;
    if (state.markdownEditorSurface) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (state.markdownEditorSurface.contains(range.startContainer)) {
          savedSelectionOffset = getTextOffsetWithinRoot(
            state.markdownEditorSurface,
            range.startContainer,
            range.startOffset,
          );
        }
      }
    }

    state.markdownLastRemoteContent = content;
    const remoteUpdateToken = state.markdownRemoteUpdateToken + 1;
    state.markdownRemoteUpdateToken = remoteUpdateToken;
    state.markdownPendingLocalReconcile = false;
    state.markdownApplyingRemoteUpdate = true;
    state.markdownLexicalRenderedContent = content;
    const api = state.markdownLexicalApi;
    const remoteContentSnapshot = content;
    api.editor.update(
      function () {
        const lexicalModule = api.lexicalModule;
        const markdownModule = api.markdownModule;
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

    // Build editor↔rendered offset maps from committed DOM state.
    // Use Range.toString() — consistent with getTextOffsetWithinRoot.
    {
      const renderedText = getDomRenderedText(state.markdownEditorSurface);
      const maps = buildEditorRenderedMaps(editorContent, renderedText);
      state.markdownEditorToRenderedMap = maps.editorToRendered;
      state.markdownRenderedToEditorMap = maps.renderedToEditor;
    }

    // Reset flags after all synchronous Lexical reconciliation completes.
    // setTimeout(0) is more reliable than queueMicrotask for catching
    // secondary updates from list normalization, etc.
    setTimeout(function () {
      // Ignore stale reset callbacks from earlier remote applies.
      if (state.markdownRemoteUpdateToken !== remoteUpdateToken) {
        return;
      }
      state.markdownApplyingRemoteUpdate = false;
      if (state.markdownLastRemoteContent === remoteContentSnapshot) {
        state.markdownLastRemoteContent = null;
      }

      if (!state.markdownPendingLocalReconcile || !state.markdownLexicalApi) {
        return;
      }
      state.markdownPendingLocalReconcile = false;

      let nextContent = "";
      const reconcileApi = state.markdownLexicalApi;
      reconcileApi.editor.getEditorState().read(function () {
        nextContent = reconcileApi.markdownModule.$convertToMarkdownString(
          reconcileApi.markdownModule.TRANSFORMERS,
          undefined,
          true,
        );
      });

      // Use Range.toString() — consistent with getTextOffsetWithinRoot.
      const renderedText = getDomRenderedText(state.markdownEditorSurface);
      const maps = buildEditorRenderedMaps(nextContent, renderedText);
      state.markdownEditorToRenderedMap = maps.editorToRendered;
      state.markdownRenderedToEditorMap = maps.renderedToEditor;

      const restoredBody = restoreRawBlocksFromEditor(nextContent);
      const fullContent = composeMarkdownContent(restoredBody);
      if (fullContent === state.markdownLexicalRenderedContent) {
        return;
      }
      state.markdownLexicalRenderedContent = fullContent;
      handleMarkdownLocalChange(nextContent, fullContent);
      scheduleMarkdownSlashMenuUpdate();
      scheduleMarkdownInlineToolbarUpdate();
    }, 0);

    // Restore selection to the same offset (clamped to new content length)
    if (savedSelectionOffset >= 0 && state.markdownEditorSurface) {
      const maxOffset = editorContent.length;
      const restoredOffset = Math.min(savedSelectionOffset, maxOffset);
      setMarkdownEditorSelection(restoredOffset);
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
// updateMarkdownOverlaySelections
// ---------------------------------------------------------------------------

/**
 * Rebuild overlay selections from the latest remote selections.
 * Converts source offsets to editor (rendered) offsets and schedules
 * the cursor overlay render. No toolbar pill DOM — overlays show
 * cursors/highlights directly on the editor surface.
 */
export function updateMarkdownOverlaySelections(selections: any[]): void {
  state.markdownLatestSelections = Array.isArray(selections) ? selections : [];
  state.markdownOverlaySelections = [];

  if (!Array.isArray(selections) || selections.length === 0) {
    clearMarkdownSelectionOverlay();
    return;
  }

  const validSelections = selections
    .filter(function (selection: any) {
      return (
        selection &&
        typeof selection.name === "string" &&
        typeof selection.start === "number" &&
        typeof selection.end === "number"
      );
    });

  if (validSelections.length === 0) {
    clearMarkdownSelectionOverlay();
    return;
  }

  for (const selection of validSelections) {
    const color = typeof selection.color === "string" && selection.color
      ? selection.color
      : "#6b7280";
    const displayName = selection.isCurrentUser ? "You" : selection.name;

    const start = Math.max(0, Math.trunc(selection.start));
    const end = Math.max(0, Math.trunc(selection.end));

    const editorRange = sourceSelectionToEditorRange(start, end);
    if (!editorRange) {
      continue;
    }

    state.markdownOverlaySelections.push({
      id: selection.id || "",
      name: displayName,
      color: color,
      isCurrentUser: selection.isCurrentUser || false,
      start: editorRange.start,
      end: editorRange.end,
    });
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

  const editorRoot = el("div", "vf-markdown-editor");

  // -- MDX blocks bar --------------------------------------------------------

  const mdxBlocks = el("div", "vf-markdown-editor__mdx-blocks");

  // -- Surface (contenteditable) ---------------------------------------------

  const surface = el("div", "vf-markdown-editor__surface markdown-body");
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
  surface.addEventListener("keydown", handleMarkdownSlashMenuKeydown as unknown as EventListener);
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
  surface.addEventListener("scroll", scheduleMarkdownSelectionOverlayRender);
  surface.addEventListener("scroll", scheduleMarkdownSlashMenuUpdate);
  surface.addEventListener("keyup", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("mouseup", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("input", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("scroll", scheduleMarkdownInlineToolbarUpdate);
  surface.addEventListener("scroll", refreshMarkdownBlockDragHandlePosition);

  // -- Surface wrap ----------------------------------------------------------

  const surfaceWrap = el("div", "vf-markdown-editor__surface-wrap");

  // -- Selection overlay -----------------------------------------------------

  const selectionOverlay = el("div", "vf-markdown-editor__selection-overlay");

  // -- Slash menu ------------------------------------------------------------

  const slashMenu = el("div", "vf-markdown-editor__slash-menu");

  // -- Inline toolbar --------------------------------------------------------

  const inlineToolbar = el("div", "vf-markdown-editor__inline-toolbar");

  // Local helpers for inline buttons / separators
  function createInlineButton(
    label: string,
    format: string | null,
    handler: (() => void) | null,
  ): HTMLButtonElement {
    const button = btn("vf-markdown-editor__inline-button", label, function (event) {
      event.preventDefault();
      if (handler) handler();
    });
    if (format) button.setAttribute("data-format", format);
    button.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    return button;
  }

  function createSeparator(): HTMLDivElement {
    return el("div", "vf-markdown-editor__inline-separator");
  }

  // -- Block dropdown --------------------------------------------------------

  const blockDropdown = el("div", "vf-markdown-editor__block-dropdown");

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
    const opt = btn("vf-markdown-editor__block-option", bt.label, function (event) {
      event.preventDefault();
      setMarkdownBlockType(bt.type);
      blockDropdown.style.display = "none";
      scheduleMarkdownInlineToolbarUpdate();
    });
    opt.setAttribute("data-block-type", bt.type);
    opt.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    blockDropdown.appendChild(opt);
  });

  // -- Block trigger (pilcrow) -----------------------------------------------

  const blockTrigger = btn(
    "vf-markdown-editor__block-trigger",
    String.fromCharCode(182), // ¶
    function (event) {
      event.preventDefault();
      const isOpen = blockDropdown.style.display === "block";
      blockDropdown.style.display = isOpen ? "none" : "block";
    },
  );
  blockTrigger.addEventListener("mousedown", function (event) {
    event.preventDefault();
  });

  // -- Inline toolbar row ----------------------------------------------------

  const row = el("div", "vf-markdown-editor__inline-row");
  row.appendChild(blockTrigger);
  row.appendChild(createSeparator());
  row.appendChild(
    createInlineButton("B", "bold", function () {
      toggleMarkdownInlineFormat("bold");
    }),
  );
  row.appendChild(
    createInlineButton("I", "italic", function () {
      toggleMarkdownInlineFormat("italic");
    }),
  );
  row.appendChild(
    createInlineButton("U", "underline", function () {
      toggleMarkdownInlineFormat("underline");
    }),
  );
  row.appendChild(
    createInlineButton("S", "strikethrough", function () {
      toggleMarkdownInlineFormat("strikethrough");
    }),
  );
  row.appendChild(createSeparator());
  row.appendChild(
    createInlineButton(String.fromCodePoint(128279), null, function () {
      insertMarkdownLink();
    }),
  );
  row.appendChild(
    createInlineButton("</>", "code", function () {
      toggleMarkdownInlineFormat("code");
    }),
  );

  inlineToolbar.appendChild(row);
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

  const blockDragHandle = btn("vf-markdown-editor__block-handle", "::", function () {});
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

  const blockDropIndicator = el("div", "vf-markdown-editor__block-drop-indicator");
  const blockDropLabel = el("div", "vf-markdown-editor__block-drop-label");

  // -- Surface wrap assembly -------------------------------------------------

  surfaceWrap.appendChild(surface);
  surfaceWrap.appendChild(selectionOverlay);

  // -- Textarea (fallback) ---------------------------------------------------

  const textarea = el("textarea", "vf-markdown-editor__textarea");
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
  state.markdownMdxBlocksRoot = mdxBlocks;
  state.markdownSelectionOverlayRoot = selectionOverlay;
  state.markdownSlashMenuRoot = slashMenu;
  state.markdownInlineToolbarRoot = inlineToolbar;
  state.markdownBlockDragHandle = blockDragHandle;
  state.markdownBlockDropIndicator = blockDropIndicator;
  state.markdownBlockDropLabel = blockDropLabel;
  setMarkdownMdxBlocks(state.markdownLatestMdxBlocks);
  updateMarkdownOverlaySelections(state.markdownLatestSelections);
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
        fileId: state.markdownFileId || "",
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
    state.markdownEditorToRenderedMap = [];
    state.markdownRenderedToEditorMap = [];
    clearMarkdownSelectionOverlay();
    clearMarkdownSelectionSync();
    disposeMarkdownYjs();

    // Remove global listeners registered by registerMarkdownGlobalListeners
    for (const cleanup of state.markdownGlobalListenerCleanups) cleanup();
    state.markdownGlobalListenerCleanups = [];
  }

  // Update floating edit button label to reflect current mode
  if (state.markdownEditButton) {
    state.markdownEditButton.textContent = enabled ? "Done" : "Edit";
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

  const button = btn("vf-markdown-edit-button", "Edit", function () {
    const isEditing = state.markdownEditorRoot &&
      state.markdownEditorRoot.style.display === "block";
    setMarkdownEditMode(!isEditing);
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

  // In Simple Mode, auto-activate the editor for markdown pages
  // (no Edit button needed — the editor IS the experience).
  // In Advanced Mode, show the Edit button and wait for user click.
  if (getConfig().studioMode === "simple") {
    setMarkdownEditMode(true);
  } else {
    ensureMarkdownEditButton();

    if (params.get("edit") === "true") {
      setMarkdownEditMode(true);
    }
  }
}
