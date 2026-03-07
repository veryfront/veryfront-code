/**
 * Bridge Block Drag
 *
 * Markdown block-level drag-and-drop, reordering, MDX block UI,
 * and all helpers that operate on top-level editor blocks.
 */

import { editorState as state } from "./bridge-editor-state.ts";
import type { MdxBlock } from "./bridge-state.ts";
import { getConfig, isMdxPage } from "./bridge-config.ts";
import { DATA_VF_IGNORE } from "./bridge-constants.ts";
import { btn, el } from "./bridge-dom-helpers.ts";
import { openFilePathInStudio } from "./bridge-markdown-core.ts";
import {
  scheduleMarkdownSelectionOverlayRender,
  scheduleMarkdownSelectionSync,
} from "./bridge-selection.ts";
import { scheduleMarkdownSlashMenuUpdate } from "./bridge-slash-menu.ts";
import { scheduleMarkdownInlineToolbarUpdate } from "./bridge-inline-toolbar.ts";

// ---------------------------------------------------------------------------
// Top-level block helpers
// ---------------------------------------------------------------------------

export function getMarkdownTopLevelBlocks(): Element[] {
  if (!state.markdownEditorSurface) {
    return [];
  }

  return Array.from(state.markdownEditorSurface.children).filter(function (node) {
    return node && node.nodeType === Node.ELEMENT_NODE;
  });
}

// ---------------------------------------------------------------------------
// Hide / show helpers
// ---------------------------------------------------------------------------

export function hideMarkdownBlockDragHandle(): void {
  state.markdownBlockHandleHoverIndex = -1;
  if (!state.markdownBlockDragHandle) {
    return;
  }
  state.markdownBlockDragHandle.style.display = "none";
  state.markdownBlockDragHandle.removeAttribute("data-block-index");
}

export function hideMarkdownBlockDropIndicator(): void {
  state.markdownBlockDropSlotIndex = -1;
  if (state.markdownBlockDropIndicator) {
    state.markdownBlockDropIndicator.style.display = "none";
  }
  if (state.markdownBlockDropLabel) {
    state.markdownBlockDropLabel.style.display = "none";
    state.markdownBlockDropLabel.textContent = "";
  }
}

export function hideMarkdownBlockDragUi(): void {
  state.markdownBlockDragActive = false;
  state.markdownBlockDragSourceIndex = -1;
  if (state.markdownBlockDragHandle) {
    state.markdownBlockDragHandle.setAttribute("data-dragging", "false");
  }
  removeMarkdownDragGhost();
  hideMarkdownBlockDropIndicator();
  hideMarkdownBlockDragHandle();
}

// ---------------------------------------------------------------------------
// Block element lookups
// ---------------------------------------------------------------------------

function getMarkdownBlockElementFromNode(node: Node | null): Element | null {
  if (!state.markdownEditorSurface || !node) {
    return null;
  }

  let current: Element | null = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : (node as Node).parentElement;
  while (current && current.parentElement !== state.markdownEditorSurface) {
    current = current.parentElement;
  }

  if (!current || current.parentElement !== state.markdownEditorSurface) {
    return null;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Block type info
// ---------------------------------------------------------------------------

function getMarkdownBlockTypeInfo(block: Element | null): { label: string; color: string } {
  if (!block || !(block as Element).tagName) {
    return { label: "block", color: "#0081f8" };
  }

  const tag = (block as Element).tagName.toLowerCase();
  if (tag === "h1") {
    return { label: "heading 1", color: "#7c3aed" };
  }
  if (tag === "h2") {
    return { label: "heading 2", color: "#7c3aed" };
  }
  if (tag === "h3") {
    return { label: "heading 3", color: "#7c3aed" };
  }
  if (tag === "ul" || tag === "ol") {
    return { label: "list", color: "#0d9488" };
  }
  if (tag === "blockquote") {
    return { label: "quote", color: "#2563eb" };
  }
  if (tag === "pre") {
    return { label: "code block", color: "#ea580c" };
  }
  if (tag === "img" || tag === "figure") {
    return { label: "image", color: "#db2777" };
  }
  if (tag === "p") {
    return { label: "paragraph", color: "#16a34a" };
  }
  return { label: tag, color: "#0081f8" };
}

// ---------------------------------------------------------------------------
// Block preview text
// ---------------------------------------------------------------------------

function getMarkdownBlockPreviewText(block: Element | null): string {
  if (!block) {
    return "";
  }
  const text = String((block as Element).textContent || "")
    .replace(new RegExp("\\s+", "g"), " ")
    .trim();
  if (!text) {
    return "Empty block";
  }
  if (text.length > 84) {
    return text.slice(0, 84) + "...";
  }
  return text;
}

// ---------------------------------------------------------------------------
// Drag ghost
// ---------------------------------------------------------------------------

export function removeMarkdownDragGhost(): void {
  if (!state.markdownBlockDragGhost) {
    return;
  }
  state.markdownBlockDragGhost.remove();
  state.markdownBlockDragGhost = null;
}

export function createMarkdownDragGhost(block: Element): HTMLElement {
  const typeInfo = getMarkdownBlockTypeInfo(block);
  const ghost = el("div", "vf-markdown-editor__block-drag-ghost");
  const title = el(
    "span",
    "vf-markdown-editor__block-drag-ghost-title",
    "Moving " + typeInfo.label,
  );
  const text = el(
    "span",
    "vf-markdown-editor__block-drag-ghost-text",
    getMarkdownBlockPreviewText(block),
  );

  ghost.appendChild(title);
  ghost.appendChild(text);
  return ghost;
}

// ---------------------------------------------------------------------------
// MDX helpers
// ---------------------------------------------------------------------------

export function getMdxBlockOpenUiState(block: { filePath?: string } | null | undefined): {
  hasResolvedTarget: boolean;
  buttonLabel: string;
  showUnresolvedNote: boolean;
} {
  const hasResolvedTarget = !!(
    block &&
    typeof block.filePath === "string" &&
    block.filePath.trim()
  );
  return {
    hasResolvedTarget: hasResolvedTarget,
    buttonLabel: hasResolvedTarget ? "Edit in Studio" : "Open MDX source",
    showUnresolvedNote: !hasResolvedTarget,
  };
}

// ---------------------------------------------------------------------------
// MDX blocks panel
// ---------------------------------------------------------------------------

export function setMarkdownMdxBlocks(blocks: MdxBlock[]): void {
  const PAGE_PATH = getConfig().pagePath;

  state.markdownLatestMdxBlocks = Array.isArray(blocks) ? blocks : [];
  if (!state.markdownMdxBlocksRoot) {
    return;
  }

  state.markdownMdxBlocksRoot.textContent = "";
  if (!isMdxPage() || state.markdownLatestMdxBlocks.length === 0) {
    state.markdownMdxBlocksRoot.style.display = "none";
    return;
  }

  state.markdownMdxBlocksRoot.style.display = "flex";
  for (const block of state.markdownLatestMdxBlocks.slice(0, 8)) {
    if (!block || typeof block.label !== "string") {
      continue;
    }

    const item = el("div", "vf-markdown-editor__mdx-block");

    const safeLine = Number.isFinite(block.lineNumber)
      ? Math.max(1, Math.trunc(block.lineNumber))
      : 1;
    const label = el(
      "div",
      "vf-markdown-editor__mdx-block-label",
      block.label + " (line " + String(safeLine) + ")",
    );
    const openUiState = getMdxBlockOpenUiState(block);

    const openButton = btn("vf-markdown-editor__mdx-open", openUiState.buttonLabel, function () {
      const targetFile = typeof block.filePath === "string" && block.filePath
        ? block.filePath
        : PAGE_PATH;
      const targetLine = targetFile === PAGE_PATH ? safeLine : 1;
      const targetSymbol = targetFile === PAGE_PATH
        ? ""
        : typeof block.symbolName === "string"
        ? block.symbolName
        : "";
      openFilePathInStudio(targetFile, targetLine, targetSymbol);
    });

    if (openUiState.showUnresolvedNote) {
      openButton.title = "Component import could not be resolved. Opening current MDX source.";
    }

    item.appendChild(label);
    if (openUiState.showUnresolvedNote) {
      item.appendChild(el("span", "vf-markdown-editor__mdx-note", "Unresolved import"));
    }
    item.appendChild(openButton);
    state.markdownMdxBlocksRoot.appendChild(item);
  }

  if (state.markdownMdxBlocksRoot.childNodes.length === 0) {
    state.markdownMdxBlocksRoot.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// Pointer / hover helpers
// ---------------------------------------------------------------------------

export function getMarkdownBlockHoverIndexFromPointer(
  targetNode: Node | null,
  clientX: number,
  clientY: number,
): number {
  const blocks = getMarkdownTopLevelBlocks();
  if (blocks.length === 0) {
    return -1;
  }

  const directBlock = getMarkdownBlockElementFromNode(targetNode);
  const directIndex = blocks.indexOf(directBlock!);
  if (directIndex >= 0) {
    return directIndex;
  }

  if (!state.markdownEditorSurface) {
    return -1;
  }
  const surfaceRect = state.markdownEditorSurface.getBoundingClientRect();
  const leftBoundary = surfaceRect.left - 44;
  const rightBoundary = surfaceRect.left + Math.min(96, surfaceRect.width * 0.35);
  if (clientX < leftBoundary || clientX > rightBoundary) {
    return -1;
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    const rect = block.getBoundingClientRect();
    if (clientY >= rect.top - 4 && clientY <= rect.bottom + 4) {
      return i;
    }
  }

  const firstBlock = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  if (!firstBlock || !lastBlock) return -1;
  const firstRect = firstBlock.getBoundingClientRect();
  const lastRect = lastBlock.getBoundingClientRect();
  if (clientY < firstRect.top) {
    return 0;
  }
  if (clientY > lastRect.bottom) {
    return blocks.length - 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Drag handle positioning
// ---------------------------------------------------------------------------

export function positionMarkdownBlockDragHandle(block: Element, index: number): void {
  if (
    !state.markdownBlockDragHandle ||
    !block ||
    !state.markdownEditorRoot ||
    state.markdownEditorRoot.style.display !== "block"
  ) {
    hideMarkdownBlockDragHandle();
    return;
  }

  const rect = block.getBoundingClientRect();
  const surfaceRect = state.markdownEditorSurface
    ? state.markdownEditorSurface.getBoundingClientRect()
    : null;
  if (!surfaceRect || rect.width <= 0 || rect.height <= 0) {
    hideMarkdownBlockDragHandle();
    return;
  }

  // Ignore blocks outside the visible scroll viewport.
  if (rect.bottom < surfaceRect.top || rect.top > surfaceRect.bottom) {
    hideMarkdownBlockDragHandle();
    return;
  }

  const left = Math.max(6, rect.left - 36);
  const top = Math.max(6, rect.top + 1);
  state.markdownBlockDragHandle.style.left = left + "px";
  state.markdownBlockDragHandle.style.top = top + "px";
  state.markdownBlockDragHandle.style.display = "block";
  state.markdownBlockDragHandle.setAttribute("data-block-index", String(index));
  state.markdownBlockHandleHoverIndex = index;
}

export function refreshMarkdownBlockDragHandlePosition(): void {
  if (state.markdownBlockDragActive || state.markdownBlockHandleHoverIndex < 0) {
    return;
  }
  const blocks = getMarkdownTopLevelBlocks();
  const block = blocks[state.markdownBlockHandleHoverIndex];
  if (!block) {
    hideMarkdownBlockDragHandle();
    return;
  }
  positionMarkdownBlockDragHandle(block, state.markdownBlockHandleHoverIndex);
}

// ---------------------------------------------------------------------------
// Drop slot
// ---------------------------------------------------------------------------

export function getMarkdownDropSlotIndexFromPointer(clientY: number): number {
  const blocks = getMarkdownTopLevelBlocks();
  if (blocks.length === 0) {
    return -1;
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    const rect = block.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    if (clientY < midpoint) {
      return i;
    }
  }
  return blocks.length;
}

// ---------------------------------------------------------------------------
// Auto-scroll during drag
// ---------------------------------------------------------------------------

export function autoScrollMarkdownSurfaceDuringDrag(clientY: number): void {
  if (!state.markdownEditorSurface) {
    return;
  }

  const rect = state.markdownEditorSurface.getBoundingClientRect();
  const threshold = 42;
  const maxStep = 20;
  let delta = 0;

  if (clientY < rect.top + threshold) {
    const distance = rect.top + threshold - clientY;
    delta = -Math.min(maxStep, Math.max(2, Math.floor(distance / 3)));
  } else if (clientY > rect.bottom - threshold) {
    const distance = clientY - (rect.bottom - threshold);
    delta = Math.min(maxStep, Math.max(2, Math.floor(distance / 3)));
  }

  if (delta !== 0) {
    state.markdownEditorSurface.scrollTop += delta;
    refreshMarkdownBlockDragHandlePosition();
  }
}

// ---------------------------------------------------------------------------
// Drop indicator
// ---------------------------------------------------------------------------

export function showMarkdownBlockDropIndicator(slotIndex: number): void {
  if (!state.markdownBlockDropIndicator || !state.markdownEditorSurface) {
    return;
  }

  const blocks = getMarkdownTopLevelBlocks();
  if (blocks.length === 0) {
    hideMarkdownBlockDropIndicator();
    return;
  }

  const safeSlot = Math.max(0, Math.min(blocks.length, Math.trunc(slotIndex || 0)));
  const surfaceRect = state.markdownEditorSurface.getBoundingClientRect();
  let top;

  if (safeSlot >= blocks.length) {
    const lastBlock = blocks[blocks.length - 1];
    if (!lastBlock) {
      hideMarkdownBlockDropIndicator();
      return;
    }
    const lastRect = lastBlock.getBoundingClientRect();
    top = lastRect.bottom + 1;
  } else {
    const slotBlock = blocks[safeSlot];
    if (!slotBlock) {
      hideMarkdownBlockDropIndicator();
      return;
    }
    const rect = slotBlock.getBoundingClientRect();
    top = rect.top - 1;
  }

  state.markdownBlockDropIndicator.style.left = Math.max(8, surfaceRect.left + 8) + "px";
  state.markdownBlockDropIndicator.style.top = Math.max(8, top) + "px";
  state.markdownBlockDropIndicator.style.width = Math.max(40, surfaceRect.width - 16) + "px";
  state.markdownBlockDropIndicator.style.display = "block";
  state.markdownBlockDropSlotIndex = safeSlot;

  const dropType = safeSlot >= blocks.length
    ? { label: "end of document", color: "#0284c7" }
    : getMarkdownBlockTypeInfo(blocks[safeSlot] ?? null);
  state.markdownBlockDropIndicator.style.background = dropType.color;
  state.markdownBlockDropIndicator.style.boxShadow = "0 1px 6px " + dropType.color;

  if (state.markdownBlockDropLabel) {
    state.markdownBlockDropLabel.textContent = safeSlot >= blocks.length
      ? "Drop at end"
      : "Drop before " + dropType.label;
    state.markdownBlockDropLabel.style.left = Math.max(8, surfaceRect.left + 8) + "px";
    state.markdownBlockDropLabel.style.top = Math.max(8, top - 26) + "px";
    state.markdownBlockDropLabel.style.borderColor = dropType.color;
    state.markdownBlockDropLabel.style.display = "block";
  }
}

// ---------------------------------------------------------------------------
// Lexical block move
// ---------------------------------------------------------------------------

export function moveMarkdownLexicalBlock(sourceIndex: number, targetSlotIndex: number): boolean {
  if (
    !state.markdownLexicalApi ||
    !state.markdownLexicalApi.editor ||
    !state.markdownLexicalApi.lexicalModule
  ) {
    return false;
  }

  const source = Math.trunc(sourceIndex);
  const targetSlot = Math.trunc(targetSlotIndex);
  if (!Number.isInteger(source) || !Number.isInteger(targetSlot)) {
    return false;
  }

  let didMove = false;
  const lexApi = state.markdownLexicalApi;
  lexApi.editor.update(function () {
    const root = lexApi.lexicalModule.$getRoot();
    const children = root.getChildren();
    const maxSlot = children.length;
    if (source < 0 || source >= maxSlot || targetSlot < 0 || targetSlot > maxSlot) {
      return;
    }

    let adjustedSlot = targetSlot;
    if (source < adjustedSlot) {
      adjustedSlot -= 1;
    }
    if (adjustedSlot === source) {
      return;
    }

    const node = children[source];
    node.remove();
    const afterRemoval = root.getChildren();
    if (adjustedSlot >= afterRemoval.length) {
      root.append(node);
    } else {
      afterRemoval[adjustedSlot].insertBefore(node);
    }
    didMove = true;
  });

  if (didMove) {
    scheduleMarkdownSelectionSync();
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
    scheduleMarkdownInlineToolbarUpdate();
  }
  return didMove;
}

// ---------------------------------------------------------------------------
// Selection-based block index
// ---------------------------------------------------------------------------

function getMarkdownCurrentBlockIndexFromSelection(): number {
  if (!state.markdownEditorSurface) {
    return -1;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return -1;
  }

  const range = selection.getRangeAt(0);
  if (!state.markdownEditorSurface.contains(range.startContainer)) {
    return -1;
  }

  const block = getMarkdownBlockElementFromNode(range.startContainer);
  if (!block) {
    return -1;
  }

  const blocks = getMarkdownTopLevelBlocks();
  return blocks.indexOf(block);
}

// ---------------------------------------------------------------------------
// Move current block by delta (keyboard shortcut)
// ---------------------------------------------------------------------------

export function moveMarkdownCurrentBlockByDelta(delta: number): boolean {
  const blocks = getMarkdownTopLevelBlocks();
  if (blocks.length <= 1) {
    return false;
  }

  const index = getMarkdownCurrentBlockIndexFromSelection();
  if (index < 0) {
    return false;
  }

  const step = Math.sign(delta);
  if (step === 0) {
    return false;
  }

  let targetSlot;
  if (step < 0) {
    targetSlot = Math.max(0, index - 1);
  } else {
    targetSlot = Math.min(blocks.length, index + 2);
  }

  const moved = moveMarkdownLexicalBlock(index, targetSlot);
  if (moved) {
    setTimeout(function () {
      const nextBlocks = getMarkdownTopLevelBlocks();
      const nextIndex = Math.max(0, Math.min(nextBlocks.length - 1, index + step));
      const nextBlock = nextBlocks[nextIndex];
      if (nextBlock) {
        positionMarkdownBlockDragHandle(nextBlock, nextIndex);
      }
    }, 0);
  }
  return moved;
}
