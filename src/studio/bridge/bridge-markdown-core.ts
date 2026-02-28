/**
 * Bridge Markdown Core
 *
 * Markdown file helpers: path resolution, MDX import parsing,
 * frontmatter extraction, raw-block tokenisation, content composition,
 * editor sync scheduling, and text diffing.
 *
 * NOTE: This module participates in a circular import cycle with
 * bridge-markdown-yjs.ts. All cross-module calls must remain in
 * function bodies (never at module top-level).
 */

import { editorState as state, setMarkdownPersistStatus } from "./bridge-editor-state.ts";
import type { MdxBlock, MdxImportEntry } from "./bridge-state.ts";
import { getConfig, isMdxPage } from "./bridge-config.ts";
import { getEditorCallbacks } from "./bridge-editor-callbacks.ts";
import { syncLocalChangeToYText } from "./bridge-markdown-yjs.ts";
import {
  escapeRegexText,
  getMarkdownRawBlockTokenPattern,
  scheduleMarkdownSelectionOverlayRender,
} from "./bridge-selection.ts";

// Re-export shared types for consumers
export type { MdxBlock, MdxImportEntry };

export interface ExtractedRawBlocks {
  editorBody: string;
  rawBlocks: string[];
  mdxBlocks: MdxBlock[];
  tokenPrefix: string;
}

export interface MarkdownParts {
  frontmatter: string;
  body: string;
}

export interface TextDiff {
  index: number;
  deleteCount: number;
  insertText: string;
}

// ---------------------------------------------------------------------------
// Helpers (private to this module)
// ---------------------------------------------------------------------------

function getLineNumberForOffset(text: string, offset: number): number {
  const source = typeof text === "string" ? text : "";
  const maxOffset = Math.max(0, Math.min(source.length, Math.trunc(offset || 0)));
  let line = 1;
  for (let i = 0; i < maxOffset; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function getMdxComponentName(blockText: string): string {
  const source = typeof blockText === "string" ? blockText : "";
  const fence = String.fromCharCode(96, 96, 96);
  const componentMatch = source.match(/<\s*([A-Z][\w.]*)/);
  if (componentMatch && componentMatch[1]) {
    return componentMatch[1];
  }
  if (source.trim().startsWith(fence + "tsx")) {
    return "tsx block";
  }
  if (source.trim().startsWith(fence + "jsx")) {
    return "jsx block";
  }
  return "component block";
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function openFilePathInStudio(
  filePath: string,
  lineNumber?: number,
  symbolName?: string,
): void {
  if (typeof filePath !== "string" || !filePath) {
    return;
  }
  const safeLine = Number.isFinite(lineNumber) ? Math.max(1, Math.trunc(lineNumber!)) : 1;
  getEditorCallbacks()?.onOpenFile(
    filePath,
    safeLine,
    1,
    typeof symbolName === "string" && symbolName.trim() ? symbolName.trim() : undefined,
  );
}

export function openMarkdownSourceInStudio(lineNumber?: number): void {
  openFilePathInStudio(getConfig().pagePath, lineNumber);
}

export function normalizePathSegments(segments: string[]): string[] {
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

export function resolveImportPathForPage(importPath: string): string {
  const sourcePath = typeof importPath === "string" ? importPath.trim() : "";
  if (!sourcePath) {
    return "";
  }

  if (sourcePath.startsWith("@/") || sourcePath.startsWith("~/")) {
    return sourcePath.slice(2);
  }

  if (sourcePath.startsWith("/")) {
    let normalizedPath = sourcePath;
    while (normalizedPath.startsWith("/")) {
      normalizedPath = normalizedPath.slice(1);
    }
    return normalizedPath;
  }

  const pagePath = getConfig().pagePath;
  if (!pagePath || !sourcePath.startsWith(".")) {
    return sourcePath;
  }

  const baseParts = String(pagePath).split("/");
  baseParts.pop();
  const resolved = normalizePathSegments(baseParts.concat(sourcePath.split("/")));
  return resolved.join("/");
}

export function isLikelyProjectImportPath(importPath: string): boolean {
  if (typeof importPath !== "string") {
    return false;
  }
  const value = importPath.trim();
  if (!value) {
    return false;
  }
  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("@/") ||
    value.startsWith("~/")
  );
}

export function guessStudioFilePath(filePath: string): string {
  const sourcePath = typeof filePath === "string" ? filePath.trim() : "";
  if (!sourcePath) {
    return "";
  }

  const hasKnownExtension = sourcePath.match(/\.(tsx?|jsx?|mdx?|json|css|scss|sass|less)$/i);
  if (hasKnownExtension) {
    return sourcePath;
  }

  if (sourcePath.endsWith("/")) {
    return sourcePath + "index.tsx";
  }

  return sourcePath + ".tsx";
}

// ---------------------------------------------------------------------------
// MDX import parsing
// ---------------------------------------------------------------------------

export function parseMdxImportMap(content: string): Record<string, MdxImportEntry> {
  const source = typeof content === "string" ? content : "";
  const importMap: Record<string, MdxImportEntry> = {};
  if (!source) {
    return importMap;
  }

  const stripImportComments = function (specifierText: string): string {
    return String(specifierText || "")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n\r]*/g, " ");
  };

  const normalizeImportSpecifier = function (specifierText: string): string {
    return stripImportComments(specifierText)
      .replace(/\s+/g, " ")
      .trim();
  };

  const setImportEntry = function (
    localName: string,
    resolvedPath: string,
    symbolName: string,
    importKind: string,
  ): void {
    const key = typeof localName === "string" ? localName.trim() : "";
    const filePathValue = typeof resolvedPath === "string" ? resolvedPath.trim() : "";
    if (!key || !filePathValue) {
      return;
    }
    importMap[key] = {
      filePath: filePathValue,
      symbolName: typeof symbolName === "string" ? symbolName.trim() : "",
      importKind: typeof importKind === "string" ? importKind : "unknown",
    };
  };

  const mapNamedImports = function (namedSpecifier: string, resolvedPath: string): void {
    const text = String(namedSpecifier || "").trim();
    if (!text.startsWith("{") || !text.endsWith("}")) {
      return;
    }
    const named = text.slice(1, -1).split(",");
    for (const entry of named) {
      const part = entry.trim();
      if (!part) {
        continue;
      }
      const normalizedPart = normalizeImportSpecifier(part).trim();
      if (!normalizedPart || /^type\s+/.test(normalizedPart)) {
        continue;
      }
      const aliasMatch = normalizedPart.match(
        /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
      );
      const sourceName = aliasMatch ? aliasMatch[1]! : normalizedPart;
      const localName = aliasMatch ? aliasMatch[2]! : normalizedPart;
      if (localName) {
        const isDefaultAlias = sourceName === "default";
        setImportEntry(
          localName,
          resolvedPath,
          isDefaultAlias ? "" : sourceName,
          isDefaultAlias ? "default" : "named",
        );
      }
    }
  };

  const importPattern = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  let match = importPattern.exec(source);
  while (match) {
    const specifier = normalizeImportSpecifier(match[1] || "");
    if (!specifier) {
      match = importPattern.exec(source);
      continue;
    }
    const typeOnlySpecifier = specifier.startsWith("type ");
    const normalizedSpecifier = typeOnlySpecifier ? specifier.slice(5).trim() : specifier;
    if (typeOnlySpecifier) {
      match = importPattern.exec(source);
      continue;
    }
    const rawImportPath = String(match[2] || "").trim();
    if (!isLikelyProjectImportPath(rawImportPath)) {
      match = importPattern.exec(source);
      continue;
    }
    const resolvedPath = guessStudioFilePath(resolveImportPathForPage(rawImportPath));
    if (!resolvedPath) {
      match = importPattern.exec(source);
      continue;
    }

    if (normalizedSpecifier.startsWith("{") && normalizedSpecifier.endsWith("}")) {
      mapNamedImports(normalizedSpecifier, resolvedPath);
    } else if (normalizedSpecifier.startsWith("* as ")) {
      const namespaceName = normalizedSpecifier.slice(5).trim();
      if (namespaceName) {
        setImportEntry(namespaceName, resolvedPath, "", "namespace");
      }
    } else {
      const commaIndex = normalizedSpecifier.indexOf(",");
      if (commaIndex >= 0) {
        const defaultPart = normalizedSpecifier.slice(0, commaIndex).trim();
        const restPart = normalizedSpecifier.slice(commaIndex + 1).trim();
        const normalizedDefaultPart = defaultPart;
        if (normalizedDefaultPart && !/^type\s+/.test(normalizedDefaultPart)) {
          setImportEntry(normalizedDefaultPart, resolvedPath, "", "default");
        }
        if (restPart.startsWith("{")) {
          mapNamedImports(restPart, resolvedPath);
        } else if (restPart.startsWith("* as ")) {
          const namespaceName = restPart.slice(5).trim();
          if (namespaceName) {
            setImportEntry(namespaceName, resolvedPath, "", "namespace");
          }
        }
      } else {
        const normalizedDefaultPart = normalizedSpecifier;
        if (normalizedDefaultPart && !/^type\s+/.test(normalizedDefaultPart)) {
          setImportEntry(normalizedDefaultPart, resolvedPath, "", "default");
        }
      }
    }

    match = importPattern.exec(source);
  }

  return importMap;
}

// ---------------------------------------------------------------------------
// Markdown editor readiness & sync scheduling
// ---------------------------------------------------------------------------

export function postMarkdownEditorReady(): void {
  if (!state.markdownFileId) {
    return;
  }
  getEditorCallbacks()?.onEditorReady(state.markdownFileId, getConfig().pagePath);
}

export function scheduleMarkdownSync(_content: string): void {
  if (!state.markdownFileId) {
    return;
  }
  if (state.markdownSyncTimer) {
    clearTimeout(state.markdownSyncTimer);
  }
  state.markdownSyncTimer = setTimeout(function () {
    getEditorCallbacks()?.onContentChange(
      state.markdownFileId,
      getConfig().pagePath,
      state.markdownCurrentContent,
    );
  }, 120);
}

// ---------------------------------------------------------------------------
// Text diffing
// ---------------------------------------------------------------------------

export function computeTextDiff(oldText: string, newText: string): TextDiff {
  let prefixLen = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefixLen < minLen && oldText.charCodeAt(prefixLen) === newText.charCodeAt(prefixLen)) {
    prefixLen++;
  }
  let suffixLen = 0;
  const maxSuffix = minLen - prefixLen;
  while (
    suffixLen < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffixLen) ===
      newText.charCodeAt(newText.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }
  return {
    index: prefixLen,
    deleteCount: oldText.length - prefixLen - suffixLen,
    insertText: newText.slice(prefixLen, suffixLen > 0 ? newText.length - suffixLen : undefined),
  };
}

// ---------------------------------------------------------------------------
// Frontmatter extraction & content composition
// ---------------------------------------------------------------------------

export function extractMarkdownParts(content: string): MarkdownParts {
  if (typeof content !== "string") {
    return {
      frontmatter: "",
      body: "",
    };
  }

  const frontmatterPattern = new RegExp(
    "^---[ \\t]*\\r?\\n[\\s\\S]*?\\r?\\n---[ \\t]*(?:\\r?\\n)?",
  );
  const match = content.match(frontmatterPattern);
  if (!match) {
    return {
      frontmatter: "",
      body: content,
    };
  }

  return {
    frontmatter: match[0],
    body: content.slice(match[0].length),
  };
}

export function composeMarkdownContent(body: string): string {
  const safeBody = typeof body === "string" ? body : "";
  if (!state.markdownFrontmatter) {
    return safeBody;
  }
  if (!safeBody) {
    return state.markdownFrontmatter;
  }
  if (state.markdownFrontmatter.endsWith("\n")) {
    return state.markdownFrontmatter + safeBody;
  }
  return state.markdownFrontmatter + "\n" + safeBody;
}

// ---------------------------------------------------------------------------
// Raw block tokenisation (extract for editor, restore from editor)
// ---------------------------------------------------------------------------

export function extractRawBlocksForEditor(
  body: string,
  mdxImportMap: Record<string, MdxImportEntry> | null,
): ExtractedRawBlocks {
  const source = typeof body === "string" ? body : "";
  const rawBlocks: string[] = [];
  const mdxBlocks: MdxBlock[] = [];
  const tokenPrefix = "VF_RAW_BLOCK_" + Date.now().toString(36) + "_" +
    Math.random().toString(36).slice(2, 8);
  const trackMdxBlocks = isMdxPage();
  const importMap = mdxImportMap && typeof mdxImportMap === "object" ? mdxImportMap : {};

  const createToken = function (index: number): string {
    return "[[" + tokenPrefix + "_" + index + "]]";
  };

  const registerMdxBlock = function (
    rawBlock: string,
    tokenIndex: number,
    offset: number,
    inputText: string,
  ): void {
    if (!trackMdxBlocks) {
      return;
    }

    const trimmed = String(rawBlock || "").trimStart();
    const fence = String.fromCharCode(96, 96, 96);
    const startsWithTsxFence = trimmed.startsWith(fence + "tsx") ||
      trimmed.startsWith(fence + "jsx");
    const startsWithUpperTag = /^<\s*[A-Z]/.test(trimmed);
    const hasTsxProps = trimmed.indexOf("{") >= 0 && trimmed.indexOf("}") >= 0;

    if (!startsWithTsxFence && !startsWithUpperTag && !hasTsxProps) {
      return;
    }

    const label = startsWithTsxFence ? "TSX block" : "JSX " + getMdxComponentName(trimmed);
    const componentName = getMdxComponentName(trimmed);
    const componentNamePattern = /^[A-Z][\w$]*(?:\.[A-Z][\w$]*)*$/;
    const normalizedComponentName = componentNamePattern.test(componentName) ? componentName : "";
    const componentParts = normalizedComponentName ? normalizedComponentName.split(".") : [];
    const namespaceName = componentParts.length > 0 ? componentParts[0] : "";
    const fallbackSymbol = componentParts.length > 0
      ? componentParts[componentParts.length - 1]
      : "";
    const directEntry = normalizedComponentName
      ? (importMap as Record<string, any>)[normalizedComponentName]
      : null;
    const namespaceEntry = !directEntry && namespaceName
      ? (importMap as Record<string, any>)[namespaceName]
      : null;
    const importEntry = directEntry || namespaceEntry || null;
    const entryPath = importEntry && typeof importEntry.filePath === "string"
      ? importEntry.filePath
      : typeof importEntry === "string"
      ? importEntry
      : "";
    const entrySymbol = importEntry && typeof importEntry.symbolName === "string"
      ? importEntry.symbolName
      : "";
    const entryKind = importEntry && typeof importEntry.importKind === "string"
      ? importEntry.importKind
      : "";
    const componentPath = entryPath || "";
    let componentSymbol = fallbackSymbol;
    if (entrySymbol) {
      componentSymbol = entrySymbol;
    } else if (entryKind === "namespace" && componentParts.length > 1) {
      componentSymbol = componentParts[componentParts.length - 1];
    }
    mdxBlocks.push({
      tokenIndex: tokenIndex,
      label: label,
      lineNumber: getLineNumberForOffset(inputText, offset),
      filePath: componentPath,
      symbolName: componentSymbol || "",
    });
  };

  // Uses rest args because different patterns have different numbers of
  // capture groups. In a .replace() callback, the last two args are
  // always (offset, inputText), and the first capture group is always
  // the leading newline.
  const replaceWithToken = function (...args: any[]): string {
    const match: string = args[0];
    const leadingNewline: string = args[1];
    const offset: number = args[args.length - 2];
    const inputText: string = args[args.length - 1];
    const safeLeading = typeof leadingNewline === "string" ? leadingNewline : "";
    const tokenIndex = rawBlocks.length;
    const rawBlock = typeof match === "string" ? match.trimStart() : "";
    rawBlocks.push(rawBlock);
    registerMdxBlock(
      rawBlock,
      tokenIndex,
      Math.max(0, (offset || 0) + safeLeading.length),
      inputText || source,
    );
    return safeLeading + createToken(tokenIndex);
  };

  const mermaidFencePattern = new RegExp(
    "(^|\\n)\\x60\\x60\\x60mermaid[^\\n]*\\n[\\s\\S]*?\\n\\x60\\x60\\x60(?=\\n|$)",
    "g",
  );
  const tsxFencePattern = new RegExp(
    "(^|\\n)\\x60\\x60\\x60(?:tsx|jsx)[^\\n]*\\n[\\s\\S]*?\\n\\x60\\x60\\x60(?=\\n|$)",
    "g",
  );
  // Match opening and closing tag names to handle nested elements correctly.
  // Without backreference, <div><p>text</p></div> would stop at </p>.
  const htmlBlockPattern = new RegExp(
    "(^|\\n)<([A-Za-z][\\w:-]*)(?:\\s[^>\\n]*)?>[\\s\\S]*?<\\/\\2>(?=\\n|$)",
    "g",
  );
  const htmlSelfClosingPattern = new RegExp(
    "(^|\\n)<[A-Za-z][\\w:-]*(?:\\s[^>\\n]*)?\\/>(?=\\n|$)",
    "g",
  );

  let editorBody = source.replace(mermaidFencePattern, replaceWithToken as any);

  editorBody = editorBody.replace(tsxFencePattern, replaceWithToken as any);

  editorBody = editorBody.replace(htmlBlockPattern, replaceWithToken as any);

  editorBody = editorBody.replace(htmlSelfClosingPattern, replaceWithToken as any);

  return {
    editorBody: editorBody,
    rawBlocks: rawBlocks,
    mdxBlocks: mdxBlocks,
    tokenPrefix: tokenPrefix,
  };
}

export function restoreRawBlocksFromEditor(editorBody: string): string {
  const source = typeof editorBody === "string" ? editorBody : "";
  if (!source || state.markdownRawBlocks.length === 0) {
    return source;
  }
  const rawBlockTokenPattern = getMarkdownRawBlockTokenPattern();

  return source.replace(rawBlockTokenPattern, function (match: string, indexText: string): string {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0 || index >= state.markdownRawBlocks.length) {
      return match;
    }
    const rawBlock = state.markdownRawBlocks[index];
    return typeof rawBlock === "string" ? rawBlock : match;
  });
}

// ---------------------------------------------------------------------------
// Local change handling & save
// ---------------------------------------------------------------------------

/**
 * Called when the local editor content changes.
 *
 * Syncs changes to Yjs when connected and schedules content sync
 * and selection overlay rendering.
 */
export function handleMarkdownLocalChange(
  content: string,
  precomputedFullContent?: string,
): void {
  if (typeof content !== "string") {
    return;
  }

  state.markdownCurrentEditorContent = content;
  const fullContent = precomputedFullContent ??
    composeMarkdownContent(restoreRawBlocksFromEditor(content));
  if (fullContent === state.markdownCurrentContent) {
    return;
  }
  state.markdownCurrentContent = fullContent;
  state.markdownHasUnsavedChanges = true;
  // Only sync to Yjs for genuinely local edits. When markdownLastRemoteContent
  // is set, Lexical is still processing a remote update (e.g. normalizing
  // whitespace) and the output should NOT echo back to Yjs.
  if (state.markdownYjsConnected && state.markdownLastRemoteContent === null) {
    syncLocalChangeToYText(fullContent);
  }
  scheduleMarkdownSync(fullContent);
  scheduleMarkdownSelectionOverlayRender();
}

export function saveMarkdownContent(): void {
  if (!state.markdownHasUnsavedChanges) {
    return;
  }
  if (state.markdownSaveInProgress) {
    return;
  }
  const cb = getEditorCallbacks();
  if (!cb) {
    return;
  }
  state.markdownSaveInProgress = true;
  state.markdownSaveRequestedContent = state.markdownCurrentContent;
  setMarkdownPersistStatus("saving");
  if (state.markdownSyncTimer) {
    clearTimeout(state.markdownSyncTimer);
    state.markdownSyncTimer = null;
  }
  try {
    cb.onContentChange(
      state.markdownFileId,
      getConfig().pagePath,
      state.markdownCurrentContent,
      true,
    );
  } catch (err) {
    state.markdownSaveInProgress = false;
    state.markdownSaveRequestedContent = null;
    setMarkdownPersistStatus("error");
    console.error("[StudioBridge] Save failed:", err);
  }
  // markdownHasUnsavedChanges is cleared by setMarkdownPersistState response
  // from Studio, not here — avoids race where edits between save request
  // and response would be incorrectly marked as saved.
}
