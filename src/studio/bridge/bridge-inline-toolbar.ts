/**
 * Bridge Inline Toolbar
 *
 * Markdown inline formatting toolbar: bold, italic, strikethrough,
 * underline, code, link insertion, and block-type switching.
 */

import { editorState as state } from "./bridge-editor-state.ts";

// ---------------------------------------------------------------------------
// hideMarkdownInlineToolbar
// ---------------------------------------------------------------------------

export function hideMarkdownInlineToolbar(): void {
  if (!state.markdownInlineToolbarRoot) {
    return;
  }
  state.markdownInlineToolbarRoot.style.display = "none";
  const blockDropdown = state.markdownInlineToolbarRoot.querySelector<HTMLElement>(
    ".vf-markdown-editor__block-dropdown",
  );
  if (blockDropdown) {
    blockDropdown.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// toggleMarkdownInlineFormat
// ---------------------------------------------------------------------------

export function toggleMarkdownInlineFormat(format: string): void {
  if (
    !state.markdownLexicalApi ||
    !state.markdownLexicalApi.editor ||
    !state.markdownLexicalApi.lexicalModule
  ) {
    return;
  }
  if (typeof format !== "string" || !format) {
    return;
  }

  state.markdownLexicalApi.editor.focus();
  state.markdownLexicalApi.editor.dispatchCommand(
    state.markdownLexicalApi.lexicalModule.FORMAT_TEXT_COMMAND,
    format,
  );
  scheduleMarkdownInlineToolbarUpdate();
}

// ---------------------------------------------------------------------------
// insertMarkdownLink
// ---------------------------------------------------------------------------

export function insertMarkdownLink(): void {
  if (
    !state.markdownLexicalApi ||
    !state.markdownLexicalApi.editor ||
    !state.markdownLexicalApi.lexicalModule
  ) {
    return;
  }
  state.markdownLexicalApi.editor.update(function () {
    const selection = state.markdownLexicalApi.lexicalModule.$getSelection();
    if (
      !selection ||
      !state.markdownLexicalApi.lexicalModule.$isRangeSelection(selection)
    ) {
      return;
    }
    const text = selection.getTextContent() || "link text";
    selection.insertRawText("[" + text + "](url)");
  });
  scheduleMarkdownInlineToolbarUpdate();
}

// ---------------------------------------------------------------------------
// setMarkdownBlockType
// ---------------------------------------------------------------------------

export function setMarkdownBlockType(type: string): void {
  if (
    !state.markdownLexicalApi ||
    !state.markdownLexicalApi.editor ||
    !state.markdownLexicalApi.lexicalModule
  ) {
    return;
  }
  const api = state.markdownLexicalApi;
  api.editor.update(function () {
    const selection = api.lexicalModule.$getSelection();
    if (!selection || !api.lexicalModule.$isRangeSelection(selection)) {
      return;
    }
    if (type === "paragraph") {
      api.selectionModule.$setBlocksType(selection, function () {
        return api.lexicalModule.$createParagraphNode();
      });
    } else if (type === "h1") {
      api.selectionModule.$setBlocksType(selection, function () {
        return api.richTextModule.$createHeadingNode("h1");
      });
    } else if (type === "h2") {
      api.selectionModule.$setBlocksType(selection, function () {
        return api.richTextModule.$createHeadingNode("h2");
      });
    } else if (type === "h3") {
      api.selectionModule.$setBlocksType(selection, function () {
        return api.richTextModule.$createHeadingNode("h3");
      });
    } else if (type === "quote") {
      api.selectionModule.$setBlocksType(selection, function () {
        return api.richTextModule.$createQuoteNode();
      });
    } else if (type === "bullet") {
      api.editor.dispatchCommand(
        api.listModule.INSERT_UNORDERED_LIST_COMMAND,
        undefined,
      );
    } else if (type === "number") {
      api.editor.dispatchCommand(
        api.listModule.INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
    }
  });
  scheduleMarkdownInlineToolbarUpdate();
}

// ---------------------------------------------------------------------------
// getMarkdownToolbarState
// ---------------------------------------------------------------------------

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  blockType: string;
  [key: string]: boolean | string;
}

export function getMarkdownToolbarState(): ToolbarState {
  const toolbarState: ToolbarState = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
    blockType: "paragraph",
  };
  if (
    !state.markdownLexicalApi ||
    !state.markdownLexicalApi.editor ||
    !state.markdownLexicalApi.lexicalModule
  ) {
    return toolbarState;
  }
  const api = state.markdownLexicalApi;
  api.editor.getEditorState().read(function () {
    const selection = api.lexicalModule.$getSelection();
    if (!selection || !api.lexicalModule.$isRangeSelection(selection)) {
      return;
    }
    toolbarState.bold = selection.hasFormat("bold");
    toolbarState.italic = selection.hasFormat("italic");
    toolbarState.underline = selection.hasFormat("underline");
    toolbarState.strikethrough = selection.hasFormat("strikethrough");
    toolbarState.code = selection.hasFormat("code");

    let anchorNode = selection.anchor.getNode();
    let element = anchorNode;
    if (element.getType() === "text") {
      element = element.getParent();
    }
    if (!element) {
      toolbarState.blockType = "paragraph";
      return;
    }

    let node = element;
    while (node) {
      const nodeType = node.getType();
      if (nodeType === "heading") {
        toolbarState.blockType = node.getTag();
        return;
      }
      if (nodeType === "quote") {
        toolbarState.blockType = "quote";
        return;
      }
      if (nodeType === "list") {
        toolbarState.blockType = node.getListType() === "number" ? "number" : "bullet";
        return;
      }
      if (nodeType === "root") {
        break;
      }
      node = node.getParent();
    }
    toolbarState.blockType = "paragraph";
  });
  return toolbarState;
}

// ---------------------------------------------------------------------------
// updateMarkdownInlineToolbar
// ---------------------------------------------------------------------------

export function updateMarkdownInlineToolbar(): void {
  if (
    !state.markdownInlineToolbarRoot ||
    !state.markdownEditorRoot ||
    state.markdownEditorRoot.style.display !== "block" ||
    !state.markdownLexicalApi ||
    !state.markdownEditorSurface ||
    state.markdownEditorSurface.style.display === "none"
  ) {
    hideMarkdownInlineToolbar();
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideMarkdownInlineToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  if (
    !state.markdownEditorSurface.contains(range.startContainer) ||
    !state.markdownEditorSurface.contains(range.endContainer)
  ) {
    hideMarkdownInlineToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    hideMarkdownInlineToolbar();
    return;
  }

  const toolbarState = getMarkdownToolbarState();
  const buttons = state.markdownInlineToolbarRoot.querySelectorAll<HTMLElement>(
    ".vf-markdown-editor__inline-button[data-format]",
  );
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const fmt = btn.getAttribute("data-format");
    if (fmt && toolbarState[fmt]) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }

  const blockTrigger = state.markdownInlineToolbarRoot.querySelector<HTMLElement>(
    ".vf-markdown-editor__block-trigger",
  );
  if (blockTrigger) {
    const blockLabels: Record<string, string> = {
      paragraph: "\u00B6",
      h1: "H\u2081",
      h2: "H\u2082",
      h3: "H\u2083",
      quote: "\u201C",
      bullet: "\u2022",
      number: "1.",
    };
    blockTrigger.textContent = blockLabels[toolbarState.blockType] || "\u00B6";
  }

  const blockDropdown = state.markdownInlineToolbarRoot.querySelector<HTMLElement>(
    ".vf-markdown-editor__block-dropdown",
  );
  if (blockDropdown) {
    const options = blockDropdown.querySelectorAll<HTMLElement>(
      ".vf-markdown-editor__block-option",
    );
    for (let j = 0; j < options.length; j++) {
      const opt = options[j];
      if (opt.getAttribute("data-block-type") === toolbarState.blockType) {
        opt.classList.add("active");
      } else {
        opt.classList.remove("active");
      }
    }
  }

  const left = Math.max(
    8,
    Math.min(window.innerWidth - 220, rect.left + rect.width / 2 - 100),
  );
  const top = Math.max(
    8,
    Math.min(window.innerHeight - 80, rect.top - 72),
  );
  state.markdownInlineToolbarRoot.style.left = left + "px";
  state.markdownInlineToolbarRoot.style.top = top + "px";
  state.markdownInlineToolbarRoot.style.display = "flex";
}

// ---------------------------------------------------------------------------
// scheduleMarkdownInlineToolbarUpdate
// ---------------------------------------------------------------------------

export function scheduleMarkdownInlineToolbarUpdate(): void {
  if (state.markdownInlineToolbarFrame) {
    cancelAnimationFrame(state.markdownInlineToolbarFrame);
  }

  state.markdownInlineToolbarFrame = requestAnimationFrame(function () {
    state.markdownInlineToolbarFrame = null;
    updateMarkdownInlineToolbar();
  });
}
