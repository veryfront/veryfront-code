/**
 * Bridge Slash Menu
 *
 * Slash-command popup for the markdown editor: filtering, rendering,
 * keyboard navigation, and command application.
 */

import { MARKDOWN_SLASH_COMMANDS, state } from "./bridge-state.ts";
import { DATA_VF_IGNORE } from "./bridge-constants.ts";
import {
  composeMarkdownContent,
  restoreRawBlocksFromEditor,
  scheduleMarkdownSync,
} from "./bridge-markdown-core.ts";
import { applyMarkdownContent, focusMarkdownEditor } from "./bridge-markdown-editor.ts";
import {
  getMarkdownEditorSelection,
  scheduleMarkdownSelectionOverlayRender,
  scheduleMarkdownSelectionSync,
  setMarkdownEditorSelection,
} from "./bridge-selection.ts";

// ---------------------------------------------------------------------------
// Hide
// ---------------------------------------------------------------------------

export function hideMarkdownSlashMenu(): void {
  state.markdownSlashMenuContext = null;
  state.markdownSlashMenuCommands = [];
  state.markdownSlashMenuActiveIndex = 0;
  if (!state.markdownSlashMenuRoot) {
    return;
  }
  state.markdownSlashMenuRoot.style.display = "none";
  state.markdownSlashMenuRoot.textContent = "";
}

// ---------------------------------------------------------------------------
// Command insert helpers
// ---------------------------------------------------------------------------

export function getMarkdownSlashCommandInsert(
  id: string,
  indent?: string,
): { text: string; caretOffset: number } | null {
  const prefix = typeof indent === "string" ? indent : "";

  if (id === "text") {
    const text = prefix;
    return { text: text, caretOffset: text.length };
  }
  if (id === "heading-1") {
    const text = prefix + "# ";
    return { text: text, caretOffset: text.length };
  }
  if (id === "heading-2") {
    const text = prefix + "## ";
    return { text: text, caretOffset: text.length };
  }
  if (id === "heading-3") {
    const text = prefix + "### ";
    return { text: text, caretOffset: text.length };
  }
  if (id === "bulleted-list") {
    const text = prefix + "- ";
    return { text: text, caretOffset: text.length };
  }
  if (id === "numbered-list") {
    const text = prefix + "1. ";
    return { text: text, caretOffset: text.length };
  }
  if (id === "quote-block") {
    const text = prefix + "> ";
    return { text: text, caretOffset: text.length };
  }
  if (id === "code-block") {
    const fence = String.fromCharCode(96, 96, 96);
    const text = prefix + fence + "\n" + prefix + "\n" + prefix + fence;
    return {
      text: text,
      caretOffset: (prefix + fence + "\n" + prefix).length,
    };
  }
  if (id === "image") {
    const text = prefix + "![alt text](https://)";
    return {
      text: text,
      caretOffset: (prefix + "![alt text](").length,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Apply a slash command
// ---------------------------------------------------------------------------

export function applyMarkdownSlashCommand(index: number): boolean {
  if (!state.markdownSlashMenuContext || state.markdownSlashMenuCommands.length === 0) {
    return false;
  }

  const command = state.markdownSlashMenuCommands[index];
  if (!command) {
    return false;
  }

  const insert = getMarkdownSlashCommandInsert(command.id, state.markdownSlashMenuContext.indent);
  if (!insert) {
    return false;
  }

  const editorContent = typeof state.markdownCurrentEditorContent === "string"
    ? state.markdownCurrentEditorContent
    : "";
  const before = editorContent.slice(0, state.markdownSlashMenuContext.lineStart);
  const after = editorContent.slice(state.markdownSlashMenuContext.caret);
  const nextEditorContent = before + insert.text + after;
  const nextCaret = before.length + insert.caretOffset;
  const nextFullContent = composeMarkdownContent(restoreRawBlocksFromEditor(nextEditorContent));
  const hasChanged = nextFullContent !== state.markdownCurrentContent;

  applyMarkdownContent(nextFullContent);
  if (hasChanged) {
    state.markdownHasUnsavedChanges = true;
    scheduleMarkdownSync(nextFullContent);
  }

  setTimeout(function () {
    focusMarkdownEditor();
    setMarkdownEditorSelection(nextCaret, nextCaret);
    scheduleMarkdownSelectionSync();
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
  }, 0);

  hideMarkdownSlashMenu();
  return true;
}

// ---------------------------------------------------------------------------
// Render the slash-menu DOM
// ---------------------------------------------------------------------------

export function renderMarkdownSlashMenu(): void {
  if (
    !state.markdownSlashMenuRoot ||
    !state.markdownSlashMenuContext ||
    state.markdownSlashMenuCommands.length === 0
  ) {
    hideMarkdownSlashMenu();
    return;
  }

  state.markdownSlashMenuRoot.textContent = "";

  const maxLeft = Math.max(8, window.innerWidth - 312);
  const maxTop = Math.max(8, window.innerHeight - 320);
  const left = Math.max(8, Math.min(maxLeft, state.markdownSlashMenuContext.anchorLeft));
  const top = Math.max(8, Math.min(maxTop, state.markdownSlashMenuContext.anchorTop));
  state.markdownSlashMenuRoot.style.left = left + "px";
  state.markdownSlashMenuRoot.style.top = top + "px";

  const sectionHeader = document.createElement("div");
  sectionHeader.className = "vf-markdown-editor__slash-section";
  sectionHeader.textContent = "Basic blocks";
  state.markdownSlashMenuRoot.appendChild(sectionHeader);

  state.markdownSlashMenuCommands.forEach(function (command: any, index: number) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vf-markdown-editor__slash-item";
    item.setAttribute(
      "data-active",
      index === state.markdownSlashMenuActiveIndex ? "true" : "false",
    );
    item.setAttribute(DATA_VF_IGNORE, "true");
    item.addEventListener("mousedown", function (event: MouseEvent) {
      event.preventDefault();
    });
    item.addEventListener("click", function (event: MouseEvent) {
      event.preventDefault();
      state.markdownSlashMenuActiveIndex = index;
      applyMarkdownSlashCommand(state.markdownSlashMenuActiveIndex);
    });

    const icon = document.createElement("span");
    icon.className = "vf-markdown-editor__slash-icon";
    icon.textContent = command.icon || "";

    const title = document.createElement("span");
    title.className = "vf-markdown-editor__slash-item-title";
    title.textContent = command.label;

    item.appendChild(icon);
    item.appendChild(title);

    if (command.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "vf-markdown-editor__slash-shortcut";
      shortcut.textContent = command.shortcut;
      item.appendChild(shortcut);
    }

    state.markdownSlashMenuRoot!.appendChild(item);
  });

  const footer = document.createElement("div");
  footer.className = "vf-markdown-editor__slash-footer";
  const footerLabel = document.createElement("span");
  footerLabel.textContent = "Close menu";
  const footerKey = document.createElement("span");
  footerKey.className = "vf-markdown-editor__slash-footer-key";
  footerKey.textContent = "esc";
  footer.appendChild(footerLabel);
  footer.appendChild(footerKey);
  state.markdownSlashMenuRoot.appendChild(footer);

  state.markdownSlashMenuRoot.style.display = "block";

  const activeItem = state.markdownSlashMenuRoot.querySelector(
    '.vf-markdown-editor__slash-item[data-active="true"]',
  );
  if (activeItem) {
    activeItem.scrollIntoView({ block: "nearest" });
  }
}

// ---------------------------------------------------------------------------
// Update – re-compute context from caret position
// ---------------------------------------------------------------------------

export function updateMarkdownSlashMenu(): void {
  if (
    !state.markdownEditorRoot ||
    state.markdownEditorRoot.style.display !== "block" ||
    !state.markdownLexicalApi ||
    !state.markdownEditorSurface ||
    state.markdownEditorSurface.style.display === "none"
  ) {
    hideMarkdownSlashMenu();
    return;
  }

  const selection = getMarkdownEditorSelection();
  if (!selection || selection.start !== selection.end) {
    hideMarkdownSlashMenu();
    return;
  }

  const caret = selection.start;
  const editorContent = typeof state.markdownCurrentEditorContent === "string"
    ? state.markdownCurrentEditorContent
    : "";
  const lineStart = editorContent.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const line = editorContent.slice(lineStart, caret);
  const match = line.match(/^(\s*)\/([a-z0-9-]*)$/i);
  if (!match) {
    hideMarkdownSlashMenu();
    return;
  }

  const query = (match[2] || "").toLowerCase();
  const commands = MARKDOWN_SLASH_COMMANDS.filter(function (command) {
    if (!query) {
      return true;
    }
    if (command.label.toLowerCase().includes(query)) {
      return true;
    }
    return command.aliases.some(function (alias) {
      return alias.startsWith(query);
    });
  });

  if (commands.length === 0) {
    hideMarkdownSlashMenu();
    return;
  }

  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) {
    hideMarkdownSlashMenu();
    return;
  }
  const caretRect = domSelection.getRangeAt(0).getBoundingClientRect();
  const anchorLeft = caretRect.left;
  const anchorTop = caretRect.bottom + 8;

  state.markdownSlashMenuCommands = commands.slice(0, 8);
  state.markdownSlashMenuActiveIndex = Math.max(
    0,
    Math.min(state.markdownSlashMenuActiveIndex, state.markdownSlashMenuCommands.length - 1),
  );
  state.markdownSlashMenuContext = {
    lineStart: lineStart,
    caret: caret,
    indent: match[1] || "",
    query: query,
    anchorLeft: anchorLeft,
    anchorTop: anchorTop,
  };
  renderMarkdownSlashMenu();
}

// ---------------------------------------------------------------------------
// Debounced schedule
// ---------------------------------------------------------------------------

export function scheduleMarkdownSlashMenuUpdate(): void {
  if (state.markdownSlashMenuTimer) {
    clearTimeout(state.markdownSlashMenuTimer);
  }
  state.markdownSlashMenuTimer = setTimeout(function () {
    state.markdownSlashMenuTimer = null;
    updateMarkdownSlashMenu();
  }, 0);
}

// ---------------------------------------------------------------------------
// Keyboard handler
// ---------------------------------------------------------------------------

export function handleMarkdownSlashMenuKeydown(event: KeyboardEvent): boolean {
  if (
    !state.markdownSlashMenuRoot ||
    state.markdownSlashMenuRoot.style.display !== "block" ||
    state.markdownSlashMenuCommands.length === 0
  ) {
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.markdownSlashMenuActiveIndex = (state.markdownSlashMenuActiveIndex + 1) %
      state.markdownSlashMenuCommands.length;
    renderMarkdownSlashMenu();
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.markdownSlashMenuActiveIndex =
      (state.markdownSlashMenuActiveIndex - 1 + state.markdownSlashMenuCommands.length) %
      state.markdownSlashMenuCommands.length;
    renderMarkdownSlashMenu();
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    return applyMarkdownSlashCommand(state.markdownSlashMenuActiveIndex);
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideMarkdownSlashMenu();
    return true;
  }

  return false;
}
