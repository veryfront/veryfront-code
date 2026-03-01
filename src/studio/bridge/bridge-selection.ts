/**
 * Bridge Selection
 *
 * Markdown editor selection helpers: offset conversion between editor,
 * body, and source coordinate spaces; collaborative selection sync via
 * Y.js awareness; and selection overlay rendering for remote cursors.
 */

import { editorState as state } from "./bridge-editor-state.ts";
import { DATA_VF_IGNORE } from "./bridge-constants.ts";

// ---------------------------------------------------------------------------
// Offset helpers
// ---------------------------------------------------------------------------

/**
 * Return the plain-text content of `root` as seen by `Range.toString()`.
 * This produces 1 `\n` per block boundary, consistent with
 * `getTextOffsetWithinRoot` which also uses `Range.toString().length`.
 */
export function getDomRenderedText(root: Node | null): string {
  if (!root) return "";
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    return range.toString();
  } catch {
    return "";
  }
}

export function getTextOffsetWithinRoot(
  root: Node | null,
  targetNode: Node | null,
  targetOffset: number,
): number {
  if (!root || !targetNode) {
    return 0;
  }

  if (!root.contains(targetNode)) {
    return 0;
  }

  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(targetNode, targetOffset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

export function getMarkdownEditorSelection(): { start: number; end: number } | null {
  if (state.markdownLexicalApi && state.markdownEditorSurface) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      !state.markdownEditorSurface.contains(range.startContainer) ||
      !state.markdownEditorSurface.contains(range.endContainer)
    ) {
      return null;
    }

    const start = getTextOffsetWithinRoot(
      state.markdownEditorSurface,
      range.startContainer,
      range.startOffset,
    );
    const end = getTextOffsetWithinRoot(
      state.markdownEditorSurface,
      range.endContainer,
      range.endOffset,
    );
    return {
      start: Math.max(0, Math.min(start, end)),
      end: Math.max(0, Math.max(start, end)),
    };
  }

  if (state.markdownEditorTextarea) {
    const start = typeof state.markdownEditorTextarea.selectionStart === "number"
      ? state.markdownEditorTextarea.selectionStart
      : 0;
    const end = typeof state.markdownEditorTextarea.selectionEnd === "number"
      ? state.markdownEditorTextarea.selectionEnd
      : start;

    return {
      start: Math.max(0, Math.min(start, end)),
      end: Math.max(0, Math.max(start, end)),
    };
  }

  return null;
}

export function getMarkdownRawBlockLength(index: number): number {
  const rawBlock = state.markdownRawBlocks[index];
  if (typeof rawBlock !== "string") {
    return 0;
  }
  return rawBlock.length;
}

export function escapeRegexText(value: unknown): string {
  const text = String(value || "");
  let escaped = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if ("\\^$.*+?()[]{}|".indexOf(char) >= 0) {
      escaped += "\\" + char;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

export function getMarkdownRawBlockTokenPattern(): RegExp {
  const prefix = typeof state.markdownRawBlockTokenPrefix === "string" &&
      state.markdownRawBlockTokenPrefix
    ? state.markdownRawBlockTokenPrefix
    : "VF_RAW_BLOCK";
  const escapedPrefix = escapeRegexText(prefix);
  return new RegExp("\\[\\[" + escapedPrefix + "_(\\d+)\\]\\]", "g");
}

export function editorOffsetToBodyOffset(
  editorOffset: number,
  bias?: "start" | "end",
): number {
  const editorContent = typeof state.markdownCurrentEditorContent === "string"
    ? state.markdownCurrentEditorContent
    : "";
  const maxOffset = editorContent.length;
  const safeOffset = Math.max(
    0,
    Math.min(maxOffset, Math.trunc(editorOffset || 0)),
  );
  const tokenPattern = getMarkdownRawBlockTokenPattern();
  let diffBefore = 0;
  let match = tokenPattern.exec(editorContent);

  while (match) {
    const token = match[0];
    const tokenStartEditor = match.index;
    const tokenEndEditor = tokenStartEditor + token.length;
    const rawLength = getMarkdownRawBlockLength(Number(match[1]));
    const tokenDelta = rawLength - token.length;
    const tokenStartBody = tokenStartEditor + diffBefore;

    if (safeOffset >= tokenEndEditor) {
      diffBefore += tokenDelta;
      match = tokenPattern.exec(editorContent);
      continue;
    }

    if (safeOffset > tokenStartEditor) {
      if (bias === "end") {
        return tokenStartBody + rawLength;
      }
      return tokenStartBody;
    }
    break;
  }

  return safeOffset + diffBefore;
}

export function bodyOffsetToEditorOffset(
  bodyOffset: number,
  bias?: "start" | "end",
): number {
  const editorContent = typeof state.markdownCurrentEditorContent === "string"
    ? state.markdownCurrentEditorContent
    : "";
  const safeBodyOffset = Math.max(0, Math.trunc(bodyOffset || 0));
  const tokenPattern = getMarkdownRawBlockTokenPattern();
  let diffBefore = 0;
  let match = tokenPattern.exec(editorContent);

  while (match) {
    const token = match[0];
    const tokenStartEditor = match.index;
    const tokenEndEditor = tokenStartEditor + token.length;
    const rawLength = getMarkdownRawBlockLength(Number(match[1]));
    const tokenStartBody = tokenStartEditor + diffBefore;
    const tokenEndBody = tokenStartBody + rawLength;

    if (safeBodyOffset > tokenEndBody) {
      diffBefore += rawLength - token.length;
      match = tokenPattern.exec(editorContent);
      continue;
    }

    if (safeBodyOffset >= tokenStartBody && safeBodyOffset <= tokenEndBody) {
      if (bias === "end") {
        return tokenEndEditor;
      }
      return tokenStartEditor;
    }

    const mappedOffset = safeBodyOffset - diffBefore;
    return Math.max(0, Math.min(editorContent.length, mappedOffset));
  }

  const mappedOffset = safeBodyOffset - diffBefore;
  return Math.max(0, Math.min(editorContent.length, mappedOffset));
}

export function editorOffsetToSourceOffset(
  renderedOffset: number,
  bias?: "start" | "end",
): number {
  const frontmatterLength = typeof state.markdownFrontmatter === "string"
    ? state.markdownFrontmatter.length
    : 0;
  // Convert rendered offset → editor offset first
  const editorOffset = renderedOffsetToEditorOffset(renderedOffset);
  const bodyOffset = editorOffsetToBodyOffset(editorOffset, bias);
  return Math.max(0, frontmatterLength + bodyOffset);
}

// ---------------------------------------------------------------------------
// Editor ↔ Rendered offset mapping
// ---------------------------------------------------------------------------

/**
 * Build bidirectional offset maps between the markdown editor content
 * (source text fed to Lexical) and the rendered plain text (what Lexical
 * displays in the DOM).
 *
 * Uses greedy alignment: every character in renderedText is expected to
 * appear in editorContent in the same order. Extra characters in
 * editorContent are markdown syntax (e.g. `# `, `**`, `~~`, `[`, `](url)`).
 */
export function buildEditorRenderedMaps(
  editorContent: string,
  renderedText: string,
): { editorToRendered: number[]; renderedToEditor: number[] } {
  // Lexical's getTextContent() appends trailing newlines after block nodes
  // (e.g. paragraphs, headings) that don't exist in the markdown source from
  // $convertToMarkdownString. Strip the excess trailing newlines so the
  // greedy alignment doesn't leave unconsumed characters at the end.
  let editorTrailing = 0;
  for (let i = editorContent.length - 1; i >= 0 && editorContent[i] === "\n"; i--) {
    editorTrailing++;
  }
  let renderedTrailing = 0;
  for (let i = renderedText.length - 1; i >= 0 && renderedText[i] === "\n"; i--) {
    renderedTrailing++;
  }
  const excessNewlines = Math.max(0, renderedTrailing - editorTrailing);
  const trimmed = excessNewlines > 0
    ? renderedText.slice(0, renderedText.length - excessNewlines)
    : renderedText;

  const e2r: number[] = new Array(editorContent.length + 1);
  const r2e: number[] = new Array(trimmed.length + 1);

  let ri = 0;
  for (let si = 0; si < editorContent.length; si++) {
    if (ri < trimmed.length && editorContent[si] === trimmed[ri]) {
      e2r[si] = ri;
      r2e[ri] = si;
      ri++;
    } else {
      // Try advancing rendered pointer past extra block separators
      // (Lexical's getTextContent() inserts \n\n between block elements,
      // but the markdown source may only have \n between e.g. list items)
      if (ri < trimmed.length && trimmed[ri] === "\n") {
        let tempRi = ri;
        while (tempRi < trimmed.length && trimmed[tempRi] === "\n") {
          tempRi++;
        }
        if (
          tempRi < trimmed.length &&
          editorContent[si] === trimmed[tempRi]
        ) {
          for (let k = ri; k < tempRi; k++) {
            if (r2e[k] === undefined) r2e[k] = si;
          }
          ri = tempRi;
          e2r[si] = ri;
          r2e[ri] = si;
          ri++;
          continue;
        }
      }
      // Syntax character — maps to the current rendered position
      e2r[si] = ri;
    }
  }

  // Warn when alignment didn't consume all rendered text — indicates a
  // mapping failure that will cause visible selection offset bugs.
  if (ri < trimmed.length) {
    console.warn(
      "[StudioBridge] Offset mapping divergence: rendered text has",
      trimmed.length - ri,
      "unconsumed characters starting at index",
      ri,
    );
  }

  // End-of-string sentinels
  e2r[editorContent.length] = Math.min(ri, trimmed.length);
  r2e[trimmed.length] = editorContent.length;

  // Fill any remaining unmatched rendered positions
  for (let r = ri; r < trimmed.length; r++) {
    if (r2e[r] === undefined) {
      r2e[r] = editorContent.length;
    }
  }

  // Fill gaps in r2e (shouldn't happen normally, but defensive)
  let lastSrc = 0;
  for (let r = 0; r <= trimmed.length; r++) {
    if (r2e[r] !== undefined) {
      lastSrc = r2e[r]!;
    } else {
      r2e[r] = lastSrc;
    }
  }

  return { editorToRendered: e2r, renderedToEditor: r2e };
}

function editorOffsetToRenderedOffset(editorOffset: number): number {
  const map = state.markdownEditorToRenderedMap;
  if (!map || map.length === 0) {
    return editorOffset;
  }
  const idx = Math.max(0, Math.min(map.length - 1, Math.trunc(editorOffset || 0)));
  return map[idx] ?? editorOffset;
}

function renderedOffsetToEditorOffset(renderedOffset: number): number {
  const map = state.markdownRenderedToEditorMap;
  if (!map || map.length === 0) {
    return renderedOffset;
  }
  const idx = Math.max(0, Math.min(map.length - 1, Math.trunc(renderedOffset || 0)));
  return map[idx] ?? renderedOffset;
}

export function sourceSelectionToEditorRange(
  start: number,
  end: number,
): { start: number; end: number } | null {
  const frontmatterLength = typeof state.markdownFrontmatter === "string"
    ? state.markdownFrontmatter.length
    : 0;
  const safeStart = Math.max(0, Math.trunc(start || 0));
  const safeEnd = Math.max(0, Math.trunc(end || 0));
  const sourceStart = Math.min(safeStart, safeEnd);
  const sourceEnd = Math.max(safeStart, safeEnd);

  if (sourceEnd <= frontmatterLength) {
    return null;
  }

  const bodyStart = Math.max(0, sourceStart - frontmatterLength);
  const bodyEnd = Math.max(0, sourceEnd - frontmatterLength);
  const editorStart = bodyOffsetToEditorOffset(bodyStart, "start");
  const editorEnd = bodyOffsetToEditorOffset(bodyEnd, "end");

  // Convert editor (markdown) offsets → rendered (DOM text) offsets
  const renderedStart = editorOffsetToRenderedOffset(editorStart);
  const renderedEnd = editorOffsetToRenderedOffset(editorEnd);

  return {
    start: Math.max(0, Math.min(renderedStart, renderedEnd)),
    end: Math.max(0, Math.max(renderedStart, renderedEnd)),
  };
}

export function setMarkdownEditorSelection(start: number, end?: number): void {
  const safeStart = Math.max(0, Math.trunc(start || 0));
  const endValue = typeof end === "number" ? end : safeStart;
  const safeEnd = Math.max(0, Math.trunc(endValue));

  if (state.markdownLexicalApi && state.markdownEditorSurface) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const anchor = resolveMarkdownTextPoint(
      state.markdownEditorSurface,
      safeStart,
    );
    const focus = resolveMarkdownTextPoint(
      state.markdownEditorSurface,
      safeEnd,
    );
    try {
      const range = document.createRange();
      range.setStart(anchor.node, anchor.offset);
      range.setEnd(focus.node, focus.offset);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Ignore when point resolution races with Lexical DOM updates.
    }
    return;
  }

  if (state.markdownEditorTextarea) {
    const max = state.markdownEditorTextarea.value.length;
    state.markdownEditorTextarea.setSelectionRange(
      Math.min(safeStart, max),
      Math.min(safeEnd, max),
    );
  }
}

// ---------------------------------------------------------------------------
// Selection sync (Y.js awareness)
// ---------------------------------------------------------------------------

export function scheduleMarkdownSelectionSync(): void {
  if (!state.markdownFileId) {
    return;
  }

  if (state.markdownSelectionSyncTimer) {
    clearTimeout(state.markdownSelectionSyncTimer);
  }

  state.markdownSelectionSyncTimer = setTimeout(function () {
    const selection = getMarkdownEditorSelection();
    if (!selection) {
      state.markdownPendingSelection = null;
      if (state.markdownYProvider) {
        state.markdownYProvider.awareness.setLocalStateField("selection", null);
      }
      return;
    }

    const start = editorOffsetToSourceOffset(selection.start, "start");
    const end = editorOffsetToSourceOffset(selection.end, "end");

    // Set local selection on Yjs awareness directly
    if (
      state.markdownYjsConnected &&
      state.markdownYText &&
      state.markdownYjsY &&
      state.markdownYProvider
    ) {
      const clampedStart = Math.max(
        0,
        Math.min(state.markdownYText.length, start),
      );
      const clampedEnd = Math.max(
        0,
        Math.min(state.markdownYText.length, end),
      );
      state.markdownYProvider.awareness.setLocalStateField("selection", [
        {
          anchor: state.markdownYjsY.createRelativePositionFromTypeIndex(
            state.markdownYText,
            clampedStart,
          ),
          marker: state.markdownYjsY.createRelativePositionFromTypeIndex(
            state.markdownYText,
            clampedEnd,
          ),
        },
      ]);
      state.markdownPendingSelection = null;
    } else {
      // Queue selection for replay after Yjs connects
      state.markdownPendingSelection = { start: start, end: end };
    }
  }, 80);
}

export function clearMarkdownSelectionSync(): void {
  if (state.markdownSelectionSyncTimer) {
    clearTimeout(state.markdownSelectionSyncTimer);
    state.markdownSelectionSyncTimer = null;
  }
  state.markdownPendingSelection = null;

  if (state.markdownYProvider) {
    state.markdownYProvider.awareness.setLocalStateField("selection", null);
  }
}

// ---------------------------------------------------------------------------
// Selection overlay rendering
// ---------------------------------------------------------------------------

export function clearMarkdownSelectionOverlay(): void {
  if (!state.markdownSelectionOverlayRoot) {
    return;
  }
  state.markdownSelectionOverlayRoot.textContent = "";
  state.markdownSelectionOverlayRoot.style.display = "none";
}

export function resolveMarkdownTextPoint(
  root: Node,
  rawOffset: number,
): { node: Node; offset: number } {
  const offset = Math.max(0, Math.trunc(rawOffset || 0));
  if (offset === 0) {
    // Fast path: find the first text node and return offset 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    return first
      ? { node: first, offset: 0 }
      : { node: root, offset: 0 };
  }

  // Walk text nodes and use Range.toString().length to measure cumulative
  // offset in the same coordinate space as getTextOffsetWithinRoot.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const measureRange = document.createRange();
  measureRange.setStart(root, 0);
  let lastTextNode: Node | null = null;
  let node = walker.nextNode();

  while (node) {
    lastTextNode = node;
    const textLength = node.textContent ? node.textContent.length : 0;

    // Measure cumulative Range.toString() offset through end of this node
    measureRange.setEnd(node, textLength);
    const cumulative = measureRange.toString().length;

    if (cumulative >= offset) {
      // Target falls within this node
      const nodeStart = cumulative - textLength;
      const localOffset = offset - nodeStart;
      return { node: node, offset: Math.min(localOffset, textLength) };
    }

    node = walker.nextNode();
  }

  if (lastTextNode) {
    const textLength = lastTextNode.textContent ? lastTextNode.textContent.length : 0;
    return { node: lastTextNode, offset: textLength };
  }

  return {
    node: root,
    offset: offset > 0 ? root.childNodes.length : 0,
  };
}

export function createMarkdownEditorRange(
  start: number,
  end: number,
): Range | null {
  if (!state.markdownEditorSurface) {
    return null;
  }

  const safeStart = Math.max(0, Math.min(start, end));
  const safeEnd = Math.max(0, Math.max(start, end));
  const startPoint = resolveMarkdownTextPoint(
    state.markdownEditorSurface,
    safeStart,
  );
  const endPoint = resolveMarkdownTextPoint(
    state.markdownEditorSurface,
    safeEnd,
  );

  try {
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  } catch {
    return null;
  }
}

export function toMarkdownOverlayRect(
  rect: { left: number; top: number; width: number; height: number },
  surfaceRect: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  const rawLeft = rect.left - surfaceRect.left;
  const rawTop = rect.top - surfaceRect.top;
  const rawRight = rawLeft + rect.width;
  const rawBottom = rawTop + rect.height;

  const left = Math.max(0, rawLeft);
  const top = Math.max(0, rawTop);
  const right = Math.min(surfaceRect.width, rawRight);
  const bottom = Math.min(surfaceRect.height, rawBottom);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: left,
    top: top,
    width: width,
    height: height,
  };
}

export function renderMarkdownSelectionOverlay(): void {
  if (!state.markdownSelectionOverlayRoot) {
    return;
  }

  if (
    !state.markdownEditorRoot ||
    state.markdownEditorRoot.style.display !== "block" ||
    !state.markdownEditorSurface ||
    !state.markdownLexicalApi ||
    !Array.isArray(state.markdownOverlaySelections) ||
    state.markdownOverlaySelections.length === 0
  ) {
    clearMarkdownSelectionOverlay();
    return;
  }

  const surfaceRect = state.markdownEditorSurface.getBoundingClientRect();
  if (surfaceRect.width <= 0 || surfaceRect.height <= 0) {
    clearMarkdownSelectionOverlay();
    return;
  }

  const computedStyle = window.getComputedStyle(state.markdownEditorSurface);
  const lineHeight = Math.max(
    14,
    Number.parseFloat(computedStyle.lineHeight || "0") || 22,
  );
  state.markdownSelectionOverlayRoot.textContent = "";
  state.markdownSelectionOverlayRoot.style.display = "block";

  for (const selection of state.markdownOverlaySelections) {
    if (
      !selection ||
      typeof selection.start !== "number" ||
      typeof selection.end !== "number"
    ) {
      continue;
    }

    const range = createMarkdownEditorRange(selection.start, selection.end);
    if (!range) {
      continue;
    }

    const color = typeof selection.color === "string" && selection.color
      ? selection.color
      : "#6b7280";
    const name = typeof selection.name === "string" && selection.name
      ? selection.name
      : "Anonymous";
    let labelAnchor: { left: number; top: number } | null = null;

    if (selection.start === selection.end) {
      const caretRect = range.getBoundingClientRect();
      const clippedCaret = toMarkdownOverlayRect(
        {
          left: caretRect.left,
          top: caretRect.top,
          width: 2,
          height: Math.max(caretRect.height, lineHeight),
        },
        surfaceRect,
      );

      if (!clippedCaret) {
        continue;
      }

      const caret = document.createElement("div");
      caret.className = "vf-markdown-editor__selection-caret";
      caret.setAttribute(DATA_VF_IGNORE, "true");
      caret.style.left = clippedCaret.left + "px";
      caret.style.top = clippedCaret.top + "px";
      caret.style.height = clippedCaret.height + "px";
      caret.style.background = color;
      state.markdownSelectionOverlayRoot.appendChild(caret);

      labelAnchor = { left: clippedCaret.left, top: clippedCaret.top };
    } else {
      const rectList = Array.from(range.getClientRects());
      for (const rect of rectList) {
        const clippedRect = toMarkdownOverlayRect(rect, surfaceRect);
        if (!clippedRect) {
          continue;
        }

        const highlight = document.createElement("div");
        highlight.className = "vf-markdown-editor__selection-highlight";
        highlight.setAttribute(DATA_VF_IGNORE, "true");
        highlight.style.left = clippedRect.left + "px";
        highlight.style.top = clippedRect.top + "px";
        highlight.style.width = clippedRect.width + "px";
        highlight.style.height = clippedRect.height + "px";
        highlight.style.background = color;
        state.markdownSelectionOverlayRoot.appendChild(highlight);

        if (!labelAnchor) {
          labelAnchor = { left: clippedRect.left, top: clippedRect.top };
        }
      }
    }

    if (!labelAnchor) {
      continue;
    }

    const label = document.createElement("div");
    label.className = "vf-markdown-editor__selection-label";
    label.setAttribute(DATA_VF_IGNORE, "true");
    label.textContent = name;
    label.style.left = labelAnchor.left + "px";
    label.style.top = labelAnchor.top + "px";
    label.style.background = color;
    state.markdownSelectionOverlayRoot.appendChild(label);
  }

  if (state.markdownSelectionOverlayRoot.childNodes.length === 0) {
    clearMarkdownSelectionOverlay();
  }
}

export function scheduleMarkdownSelectionOverlayRender(): void {
  if (state.markdownSelectionOverlayRenderFrame) {
    cancelAnimationFrame(state.markdownSelectionOverlayRenderFrame);
  }

  state.markdownSelectionOverlayRenderFrame = requestAnimationFrame(
    function () {
      state.markdownSelectionOverlayRenderFrame = null;
      renderMarkdownSelectionOverlay();
    },
  );
}
