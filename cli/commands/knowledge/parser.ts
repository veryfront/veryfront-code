import { lstat as inspectLink } from "node:fs/promises";
import {
  isKnowledgeSourceOutputCandidate,
  type SourceOutputHint,
  type SourceOutputIndex,
  withKnowledgeSourceClaim,
} from "./source-output-index.ts";
import {
  acquireKnowledgeTargetOutputClaim,
  knowledgeOutputClaimPath,
  readKnowledgeClaimOwner,
  readProvenKnowledgeOutputStage,
  releaseKnowledgeTargetOutputClaim,
} from "./output-claim.ts";
import { isMissingKnowledgeOutput, publishKnowledgeOutput } from "./output-publication.ts";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "veryfront/platform/path";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
import type {
  DocumentExtractionOptions,
  DocumentExtractionProgress,
  DocumentExtractionProgressEvent,
} from "veryfront/extensions/compat";
import { inspectOkfDocument, type OkfDocumentDiagnostic } from "veryfront/knowledge";
import { VERSION } from "#cli/utils";
import {
  escapeReservedKnowledgeSlug,
  type KnowledgeSource,
  normalizeProvableLegacyLocalKnowledgePath,
  readKnowledgeIngestSourceKey,
  readProvableLegacyLocalKnowledgeSource,
} from "./command-helpers.ts";
import { isTextKnowledgeCompanionPath } from "./source-policy.ts";
import { computeHash, computeHashBytes } from "veryfront/utils";

export interface KnowledgeParserResult {
  success: true;
  source_path: string;
  source_filename: string;
  source_type: string;
  slug: string;
  /** Title-derived stem before local temporary file collisions. */
  preferred_slug?: string;
  sandbox_output_path: string;
  suggested_project_path: string;
  description: string;
  title: string;
  summary: string;
  stats: Record<string, unknown>;
  warnings: string[];
  storage_kind?: "binary";
  document_kind?: "generated" | "okf_concept" | "okf_index" | "okf_log";
  okf?: {
    path: string;
    envelope_conforms: boolean;
    diagnostics: OkfDocumentDiagnostic[];
    metadata: Record<string, unknown>;
  };
}

export interface KnowledgeParserInput {
  filePath: string;
  description?: string;
  /** Exact output name; otherwise the name comes from the title. */
  slug?: string;
  sourceReference?: string;
  /** The file name the user gave the source; defaults to the local file name. */
  sourceName?: string;
  /** The OKF `resource`: the path the user uploaded; defaults to `sourceReference`. */
  resource?: string;
  sourceKey?: string;
  sourceKind?: KnowledgeSource["kind"];
  okfRelativePath?: string;
  okfRole?: "companion";
}

export type ExtractDocumentText = (
  input: {
    filePath: string;
    mimeType: string;
    onProgress?: DocumentExtractionProgress;
    signal?: AbortSignal;
  },
) => Promise<string>;

type DocumentKreuzbergExtensionModule = {
  KreuzbergDocumentExtractor: new () => {
    extractInWorker(
      buffer: ArrayBuffer,
      mimeType: string,
      options?: DocumentExtractionOptions,
    ): Promise<string>;
  };
};

export interface RunKnowledgeParsersDeps {
  allocationSession?: KnowledgeAllocationSession;
  signal?: AbortSignal;
  extractDocumentText?: ExtractDocumentText;
  onProgress?: (event: DocumentExtractionProgressEvent) => void | Promise<void>;
}

interface ResolvedRunKnowledgeParsersDeps {
  signal?: AbortSignal;
  extractDocumentText: ExtractDocumentText;
  onProgress?: (event: DocumentExtractionProgressEvent) => void | Promise<void>;
}

const CODE_FENCE = "`".repeat(3);

const TEXT_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".ini",
  ".java",
  ".js",
  ".jsonl",
  ".jsx",
  ".kt",
  ".less",
  ".lua",
  ".mjs",
  ".ndjson",
  ".php",
  ".pl",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const TEXT_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "changelog",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".epub": "application/epub+zip",
  ".htm": "text/html",
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mdx": "text/mdx",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "text/xml",
};

type ParserOutput = {
  content: string;
  stats: Record<string, unknown>;
  warnings: string[];
};

type ParserDefinition = {
  sourceType: string;
  parse: (path: string, deps: ResolvedRunKnowledgeParsersDeps) => Promise<ParserOutput>;
};

export function slugifyKnowledgeValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|(?<!-)-+$/g, "") ||
    "document";
}

function titleizeFilename(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const title = stem.replaceAll("_", " ").replaceAll("-", " ").trim();
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ") || name;
}

function cleanText(value: string, preserveIndentation = false): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(
    /\n{3,}/g,
    "\n\n",
  );
  return preserveIndentation
    ? normalized.replace(/^\uFEFF/, "").replace(/^(?:[ \t]*\n)+/, "").trimEnd()
    : normalized.trim();
}

function yamlQuote(value: unknown): string {
  return JSON.stringify(value == null ? "" : String(value));
}

/** The same OKF shape Studio's chat ingest asks for; `source`, `source_type`, `added` are extensions. */
function buildFrontmatter(input: {
  title: string;
  description: string;
  resource: string;
  sourceKey?: string;
  tags: string[];
  source: string;
  sourceType: string;
}): string {
  const now = new Date().toISOString();
  return [
    "---",
    `type: ${yamlQuote("Document")}`,
    `title: ${yamlQuote(input.title)}`,
    `description: ${yamlQuote(input.description)}`,
    `resource: ${yamlQuote(input.resource)}`,
    `tags: ${JSON.stringify(input.tags)}`,
    `timestamp: ${yamlQuote(now)}`,
    `source: ${yamlQuote(input.source)}`,
    `source_type: ${yamlQuote(input.sourceType)}`,
    `added: ${yamlQuote(now)}`,
    "generated:",
    `  by: ${yamlQuote(`veryfront/${VERSION}`)}`,
    ...(input.sourceKey === undefined ? [] : [`  source_key: ${yamlQuote(input.sourceKey)}`]),
    "---",
  ].join("\n");
}

/** CommonMark HTML blocks end at a marker or the next blank line. */
function markdownHtmlBlockEnd(
  line: string,
  outsideParagraph: boolean,
): RegExp | "blank" | undefined {
  const rawTag = /^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i.exec(line)?.[1];
  if (rawTag) return /<\/(?:script|pre|style|textarea)>/i;
  if (/^ {0,3}<!--/.test(line)) return /-->/;
  if (/^ {0,3}<\?/.test(line)) return /\?>/;
  if (/^ {0,3}<![A-Z]/.test(line)) return />/;
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return /\]\]>/;
  if (
    /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i
      .test(line)
  ) return "blank";
  if (
    outsideParagraph &&
    /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/
      .test(line)
  ) return "blank";
  return undefined;
}

function isThematicBreak(line: string, mdx = false): boolean {
  if (mdx) line = line.replace(/^[ \t]*/, "");
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function markdownFenceStart(line: string): string | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match || match[1]?.startsWith("`") && match[2]?.includes("`")) return undefined;
  return match[1];
}

function startsInterruptingBlock(line: string, mdx = false, flow?: boolean): boolean {
  if (mdx) line = line.replace(/^[ \t]*/, "");
  return /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-+*][ \t]+\S|1[.)][ \t]+\S)/.test(line) ||
    isThematicBreak(line) || markdownFenceStart(line) !== undefined ||
    (mdx ? flow ?? startsMdxHeadingFlow(line) : markdownHtmlBlockEnd(line, false) !== undefined);
}

function expandHeadingIndentation(raw: string): string {
  let end = 0;
  for (;;) {
    while (raw[end] === " " || raw[end] === "\t") end += 1;
    if (raw[end] === ">") {
      end += 1;
      continue;
    }
    let markerEnd = end;
    if (/[-+*]/.test(raw[markerEnd] ?? "")) markerEnd += 1;
    else {
      while (/\d/.test(raw[markerEnd] ?? "") && markerEnd - end < 10) markerEnd += 1;
      if (markerEnd === end || markerEnd - end > 9 || !/[.)]/.test(raw[markerEnd] ?? "")) {
        break;
      }
      markerEnd += 1;
    }
    if (markerEnd < raw.length && raw[markerEnd] !== " " && raw[markerEnd] !== "\t") break;
    end = markerEnd;
  }
  let width = 0;
  let expanded = "";
  for (const character of raw.slice(0, end)) {
    const count = character === "\t" ? 4 - width % 4 : 1;
    expanded += character === "\t" ? " ".repeat(count) : character;
    width += count;
  }
  return expanded + raw.slice(end);
}

/** Markdown blank lines contain only ASCII spaces and tabs. */
function hasHeadingContent(line: string, _mdx: boolean): boolean {
  return /[^ \t]/.test(line);
}

function headingListMarker(line: string, mdx: boolean): RegExpExecArray | null {
  return (mdx ? /^ *(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/ : /^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/)
    .exec(line);
}

/** Track only positively identified list containers; ordinary indentation is not a container. */
function headingContainerLine(
  raw: string,
  indents: number[],
  insideBlock: boolean,
  paragraphOpen: boolean,
  paragraphInDescendant: boolean,
): { line: string; startsItem: boolean; lazy: boolean; emptyItem: boolean } {
  const line = expandHeadingIndentation(raw);
  const indentation = /^ */.exec(line)?.[0].length ?? 0;
  // Only prefixes that actually matched may expose an interrupting block.
  // Underindented text can remain lazy in the existing paragraph, but cannot
  // consume a marker or mutate any of its unmatched list containers.
  const matchedIndent = indents.findLast((indent) => indent <= indentation) ?? 0;
  const unmatched = indentation < (indents.at(-1) ?? 0);
  const remainder = line.slice(matchedIndent);
  const siblingItem = (unmatched || paragraphInDescendant) &&
    headingListMarker(remainder, false) !== null;
  if (siblingItem) paragraphOpen = false;
  const lazy = unmatched && paragraphOpen && !insideBlock && !siblingItem &&
    hasHeadingContent(line, false) && !startsInterruptingBlock(remainder);
  if (lazy) return { line: remainder, startsItem: false, lazy: true, emptyItem: false };
  if (hasHeadingContent(line, false) && !lazy) {
    while (indents.length && indentation < (indents.at(-1) ?? 0)) indents.pop();
  }
  let offset = Math.min(indents.at(-1) ?? 0, indentation);
  let content = line.slice(offset);
  let startsItem = false;
  let emptyItem = false;
  if (
    insideBlock || isThematicBreak(content) ||
    (paragraphOpen && /^ {0,3}(?:=+|-+)[ \t]*$/.test(content))
  ) return { line: content, startsItem, lazy, emptyItem };
  let marker = /^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(content);
  while (marker) {
    if (
      paragraphOpen &&
      (/^ {0,3}\d/.test(content) && !/^ {0,3}1[.)]/.test(content) ||
        !hasHeadingContent(content.slice(marker[0].length), false))
    ) break;
    const spacing = marker[1] ?? "";
    emptyItem = !hasHeadingContent(content.slice(marker[0].length), false);
    const width = marker[0].length - spacing.length +
      (emptyItem || spacing.length > 4 ? 1 : Math.max(1, spacing.length));
    startsItem = true;
    paragraphOpen = false;
    offset += width;
    indents.push(offset);
    content = line.slice(offset);
    marker = isThematicBreak(content)
      ? null
      : /^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(content);
  }
  return { line: content, startsItem, lazy, emptyItem };
}

/** Count a reference-definition block, including a continued destination and optional title. */
function interruptsDefinition(line: string, mdx: boolean, flow?: boolean): boolean {
  if (mdx) line = line.replace(/^[ \t]*/, "");
  return startsInterruptingBlock(line, mdx, flow) || /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
}

function headingDefinitionLines(
  lines: string[],
  start: number,
  containerIndent = 0,
  firstLine?: string,
  parentIndent = 0,
  continuedParagraph = false,
  mdx = false,
  readContent?: (index: number) => string | undefined,
  readInterrupt?: (index: number, line: string) => boolean,
): number {
  const interrupts = (index: number, line: string): boolean =>
    readInterrupt ? readInterrupt(index, line) : interruptsDefinition(line, mdx);
  const readLine = (index: number): string => {
    if (readContent) return readContent(index) ?? "";
    const line = expandHeadingIndentation(lines[index] ?? "");
    const indentation = /^ */.exec(line)?.[0].length ?? 0;
    return line.slice(Math.min(indentation, containerIndent));
  };
  // An outdented sibling starts in the last matched container, not in the
  // unmatched item's paragraph. Do not consume its marker as a destination.
  const leavesContainer = (index: number): boolean => {
    if (readContent) return readContent(index) === undefined;
    const line = expandHeadingIndentation(lines[index] ?? "");
    const indentation = /^ */.exec(line)?.[0].length ?? 0;
    return indentation < containerIndent &&
      headingListMarker(line.slice(Math.min(parentIndent, indentation)), mdx) !== null;
  };
  let offset = start;
  let first = firstLine ?? readLine(offset);
  if (!mdx && !continuedParagraph && /^ {4}/.test(first)) return 0;
  let label = /^[ \t]*\[(?:\\.|[^\[\]\\]){1,999}\]:[ \t]*/.exec(first);
  while (!label && /^[ \t]*\[/.test(first) && !first.includes("]") && first.length <= 1002) {
    offset += 1;
    const next = readLine(offset);
    if (
      leavesContainer(offset) || !hasHeadingContent(next, mdx) ||
      interrupts(offset, next)
    ) return 0;
    first += "\n" + next;
    label = /^[ \t]*\[(?:\\.|[^\[\]\\]){1,999}\]:[ \t]*/.exec(first);
  }
  if (!label || !/\S/.test(label[0].slice(label[0].indexOf("[") + 1, label[0].lastIndexOf("]")))) {
    return 0;
  }
  let rest = first.slice(label[0].length);
  if (!rest) {
    offset += 1;
    const continuation = readLine(offset);
    if (
      leavesContainer(offset) ||
      interrupts(offset, continuation)
    ) return 0;
    rest = continuation.replace(/^[ \t]*/, "");
  }
  let cursor = 0;
  if (rest.startsWith("<")) {
    cursor = 1;
    while (cursor < rest.length && rest[cursor] !== ">") {
      if (rest[cursor] === "<") return 0;
      if (rest[cursor] === "\\") cursor += 1;
      cursor += 1;
    }
    if (rest[cursor] !== ">") return 0;
    cursor += 1;
  } else {
    let depth = 0;
    while (cursor < rest.length && !/[ \t\n]/.test(rest[cursor] ?? "")) {
      const character = rest[cursor];
      // Bare destinations exclude ASCII controls, including escaped controls.
      // Unicode whitespace remains content rather than Markdown indentation.
      const characterCode = rest.charCodeAt(cursor);
      if (characterCode < 0x20 || characterCode === 0x7f) return 0;
      if (character === "\\" && /[!-/:-@[-`{-~]/.test(rest[cursor + 1] ?? "")) {
        cursor += 1;
      } else if (character === "(") depth += 1;
      else if (character === ")" && --depth < 0) return 0;
      cursor += 1;
    }
    if (!cursor || depth !== 0) return 0;
  }
  const destinationEnd = offset;
  const remainder = rest.slice(cursor);
  if (remainder && !/^[ \t]/.test(remainder)) return 0;
  rest = remainder.replace(/^[ \t]*/, "");
  if (!rest) {
    const next = readLine(offset + 1);
    if (leavesContainer(offset + 1) || !/^[ \t]*["'(]/.test(next)) {
      return destinationEnd - start + 1;
    }
    offset += 1;
    rest = next.replace(/^[ \t]*/, "");
  }
  const opening = rest[0];
  const closing = opening === "(" ? ")" : opening;
  if (opening !== '"' && opening !== "'" && opening !== "(") {
    return offset === destinationEnd ? 0 : destinationEnd - start + 1;
  }
  const titleFallback = offset === destinationEnd ? 0 : destinationEnd - start + 1;
  cursor = 1;
  for (;;) {
    while (cursor < rest.length) {
      const character = rest[cursor];
      if (character === "\\") cursor += 1;
      else if (character === closing) {
        return hasHeadingContent(rest.slice(cursor + 1), mdx) ? titleFallback : offset - start + 1;
      } else if (opening === "(" && character === "(") return 0;
      cursor += 1;
    }
    offset += 1;
    rest = readLine(offset);
    if (
      leavesContainer(offset) || !hasHeadingContent(rest, mdx) ||
      interrupts(offset, rest)
    ) {
      return titleFallback;
    }
    cursor = 0;
  }
}

/** Skip one JS literal/comment, keeping nested template expressions in the same region. */
function mdxLiteralEnd(source: string, start: number): number | undefined {
  const quote = source[start];
  if (source.startsWith("//", start)) {
    const end = source.indexOf("\n", start + 2);
    return end < 0 ? source.length : end;
  }
  if (source.startsWith("/*", start)) {
    const end = source.indexOf("*/", start + 2);
    return end < 0 ? source.length : end + 2;
  }
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") cursor += 2;
    else if (source[cursor] === quote) return cursor + 1;
    else if (quote === "`" && source.startsWith("${", cursor)) {
      cursor = mdxExpressionEnd(source, cursor + 1);
    } else cursor += 1;
  }
  return source.length;
}

/** Reuse literal/comment ownership when inspecting a token after JavaScript trivia. */
function mdxAfterTrivia(source: string, start: number): number {
  let cursor = start;
  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
    if (!source.startsWith("//", cursor) && !source.startsWith("/*", cursor)) return cursor;
    cursor = mdxLiteralEnd(source, cursor) ?? source.length;
  }
}

/** These lexical contexts still require an operand before an ESM block can end. */
function mdxNeedsOperand(previous: string): boolean {
  return !previous || /^[([{=,:!?&|+*\/%~^<>-]$/.test(previous) ||
    /^(?:return|throw|case|yield|await|void|typeof|delete|in|instanceof|new|extends|default|for-of|spread|prefix-update|function-declaration|function-expression|=>)$/
      .test(previous);
}

/** JSX values and regex literals additionally start at statement boundaries. */
function mdxCanStartExpression(previous: string): boolean {
  return mdxNeedsOperand(previous) || previous === ";" ||
    /^(?:else|do|control-end|statement-end|label-colon|case-colon)$/.test(previous);
}

/** Expressions own their strings, comments, regex literals and nested delimiters. */
function mdxExpressionEnd(source: string, start: number, esm = false): number {
  const closers: string[] = [];
  const controlParens = new Set<number>();
  const forParens = new Set<number>();
  const statementBlocks = new Set<number>();
  const statementScopes = new Set<number>();
  const classScopes = new Set<number>();
  const moduleClauses = new Set<number>();
  const caseClauses = new Set<number>();
  const ternaries = new Map<number, number>();
  const functionParens = new Map<number, boolean>();
  const pendingDeclarations: { kind: "function" | "class"; depth: number; statement: boolean }[] =
    [];
  let cursor = start;
  let previous = "";
  let previousEnd = start;
  let labelDepth: number | undefined;
  let asyncStatement = false;
  let forAwait = false;
  let jumpDepth: number | undefined;
  while (cursor < source.length) {
    const character = source[cursor] ?? "";
    if (jumpDepth === closers.length && /[\r\n]/.test(source.slice(previousEnd, cursor))) {
      previous = "statement-end";
      jumpDepth = undefined;
    }
    if (
      /^<\/?(?:[\p{ID_Start}_$][\p{ID_Continue}$.:_-]*|>)/u.test(source.slice(cursor)) &&
      mdxCanStartExpression(previous)
    ) {
      cursor = mdxElementEnd(source, cursor);
      previous = "value";
      previousEnd = cursor;
      labelDepth = undefined;
      continue;
    }
    const literalEnd = mdxLiteralEnd(source, cursor);
    if (literalEnd !== undefined) {
      const comment = source.startsWith("//", cursor) || source.startsWith("/*", cursor);
      cursor = literalEnd;
      if (!comment) {
        previous = "value";
        previousEnd = cursor;
        labelDepth = undefined;
      }
      continue;
    }
    if (source.startsWith("++", cursor) || source.startsWith("--", cursor)) {
      previous = mdxCanStartExpression(previous) || /[\r\n]/.test(source.slice(previousEnd, cursor))
        ? "prefix-update"
        : "postfix-update";
      cursor += 2;
      previousEnd = cursor;
      labelDepth = undefined;
      continue;
    }
    if (source.startsWith("...", cursor)) {
      previous = "spread";
      cursor += 3;
      previousEnd = cursor;
      labelDepth = undefined;
      continue;
    }
    if (source.startsWith("?.", cursor) || source.startsWith("??", cursor)) {
      previous = source[cursor + 1] === "." ? "." : "?";
      cursor += 2;
      previousEnd = cursor;
      labelDepth = undefined;
      continue;
    }
    if (source.startsWith("=>", cursor)) {
      previous = "=>";
      cursor += 2;
      previousEnd = cursor;
      labelDepth = undefined;
      continue;
    }
    if (character === "/" && mdxCanStartExpression(previous)) {
      // A regex cannot contain an unescaped line ending; braces inside it are data.
      let end = cursor + 1;
      let characterClass = false;
      for (; end < source.length && source[end] !== "\n"; end += 1) {
        if (source[end] === "\\") end += 1;
        else if (source[end] === "[") characterClass = true;
        else if (source[end] === "]") characterClass = false;
        else if (source[end] === "/" && !characterClass) break;
      }
      if (source[end] === "/") {
        cursor = end + 1;
        previous = "value";
        previousEnd = cursor;
        labelDepth = undefined;
        continue;
      }
    }
    const number =
      /^(?:0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?n?)/
        .exec(source.slice(cursor))?.[0];
    if (number) {
      cursor += number.length;
      previous = "value";
      previousEnd = cursor;
      labelDepth = undefined;
      continue;
    }
    const identifier = /^[\p{ID_Start}_$][\p{ID_Continue}$]*/u.exec(source.slice(cursor))?.[0];
    const afterAsi = (identifier !== undefined || character === "{") &&
      statementScopes.has(closers.length) &&
      /[\r\n]/.test(source.slice(previousEnd, cursor)) &&
      (!mdxCanStartExpression(previous) || previous === "return" || previous === "yield");
    if (identifier) {
      const statementStart = afterAsi || !previous || previous === ";" ||
        previous === "{" && statementScopes.has(closers.length) ||
        /^(?:statement-end|control-end|label-colon|case-colon|else|do|export|default)$/.test(
          previous,
        );
      if (
        /^(?:break|continue|debugger)$/.test(identifier) && statementStart &&
        statementScopes.has(closers.length)
      ) jumpDepth = closers.length;
      labelDepth = statementStart && statementScopes.has(closers.length)
        ? closers.length
        : undefined;
      if (
        (identifier === "case" || identifier === "default") && statementScopes.has(closers.length)
      ) {
        caseClauses.add(closers.length);
        labelDepth = undefined;
      }
      if (identifier === "async") asyncStatement = statementStart;
      if (identifier === "await") forAwait = previous === "for";
      const following = source[mdxAfterTrivia(source, cursor + identifier.length)];
      const keywordPosition = statementStart || mdxCanStartExpression(previous) ||
        identifier === "function" && previous === "async";
      if (
        (identifier === "function" || identifier === "class") && keywordPosition &&
        following !== ":" && !(identifier === "class" && following === "(") &&
        !moduleClauses.has(closers.length)
      ) {
        pendingDeclarations.push({
          kind: identifier,
          depth: closers.length,
          statement: statementStart || previous === "async" && asyncStatement,
        });
      }
      // `of` is an expression separator only in the owning for header, after
      // its left binding. Ordinary identifiers and member names keep value context.
      const forOf = identifier === "of" && forParens.has(closers.length) &&
        previous !== "." && !mdxCanStartExpression(previous) &&
        !/^(?:const|let|var)$/.test(previous);
      if (forOf) forParens.delete(closers.length);
      previous = forOf ? "for-of" : previous === "." ? "value" : identifier;
      cursor += identifier.length;
      previousEnd = cursor;
      continue;
    }
    const opening = "([{".indexOf(character);
    let closedContext: string | undefined;
    if (character === ";") {
      forParens.delete(closers.length);
      jumpDepth = undefined;
    }
    if (character === "?") ternaries.set(closers.length, (ternaries.get(closers.length) ?? 0) + 1);
    if (character === ":") {
      const conditional = ternaries.get(closers.length) ?? 0;
      if (conditional) ternaries.set(closers.length, conditional - 1);
      else if (caseClauses.delete(closers.length)) closedContext = "case-colon";
      else if (labelDepth === closers.length) closedContext = "label-colon";
    }
    if (!/\s/.test(character)) labelDepth = undefined;
    if (opening >= 0 && opening < 3) {
      const declaration = pendingDeclarations.at(-1);
      if (
        declaration?.depth === closers.length &&
        (character === "(" && declaration.kind === "function" ||
          character === "{" && declaration.kind === "class")
      ) {
        pendingDeclarations.pop();
        if (character === "(") functionParens.set(closers.length + 1, declaration.statement);
        else {
          classScopes.add(closers.length + 1);
          if (declaration.statement) statementBlocks.add(closers.length + 1);
        }
      }
      if (esm && character === "{" && /^(?:import|export)$/.test(previous)) {
        moduleClauses.add(closers.length + 1);
      }
      closers.push(")]}"[opening] ?? "");
      if (
        character === "(" && (/^(?:if|while|for|with|switch|catch)$/.test(previous) ||
          previous === "await" && forAwait)
      ) {
        controlParens.add(closers.length);
        if (previous === "for" || previous === "await" && forAwait) {
          forParens.add(closers.length);
        }
      }
      if (character === "{") {
        const statementBlock = afterAsi && !classScopes.has(closers.length) ||
          /^(?:control-end|statement-end|function-declaration|label-colon|case-colon|else|try|catch|finally|do)$/
            .test(previous) ||
          /^[{;]$/.test(previous) && statementScopes.has(closers.length - 1);
        if (statementBlock) statementBlocks.add(closers.length);
        if (
          statementBlock || /^(?:function-expression|=>|\))$/.test(previous) ||
          previous === "static" && classScopes.has(closers.length - 1)
        ) {
          statementScopes.add(closers.length);
        }
      }
    } else if (character === closers.at(-1)) {
      const functionDeclaration = functionParens.get(closers.length);
      if (functionDeclaration !== undefined) {
        closedContext = functionDeclaration ? "function-declaration" : "function-expression";
        functionParens.delete(closers.length);
      }
      if (controlParens.delete(closers.length)) closedContext = "control-end";
      forParens.delete(closers.length);
      if (statementBlocks.delete(closers.length)) closedContext = "statement-end";
      while ((pendingDeclarations.at(-1)?.depth ?? -1) >= closers.length) {
        pendingDeclarations.pop();
      }
      if (jumpDepth !== undefined && jumpDepth >= closers.length) jumpDepth = undefined;
      statementScopes.delete(closers.length);
      classScopes.delete(closers.length);
      moduleClauses.delete(closers.length);
      caseClauses.delete(closers.length);
      ternaries.delete(closers.length);
      closers.pop();
      if (!esm && !closers.length) return cursor + 1;
    }
    // MDX ESM blocks use a blank-line boundary, not JavaScript semicolons or ASI.
    if (
      esm && !closers.length && character === "\n" && /^\s*\n/.test(source.slice(cursor + 1)) &&
      !mdxNeedsOperand(previous) && previous !== "." &&
      !/^(?:export|import|const|let|var|extends)$/.test(previous) && !pendingDeclarations.length
    ) {
      return cursor + 1;
    }
    if (!/\s/.test(character)) {
      previous = closedContext ?? character;
      previousEnd = cursor + 1;
    }
    cursor += 1;
  }
  return source.length;
}

/** A JSX tag ends only outside attribute strings and JavaScript expressions. */
function mdxTagEnd(source: string, start: number): number {
  let cursor = start + 1;
  while (cursor < source.length) {
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      // JSX quoted attributes are raw text: backslashes do not escape the quote.
      const end = source.indexOf(quote, cursor + 1);
      cursor = end < 0 ? source.length : end + 1;
    } else if (source[cursor] === "{") cursor = mdxExpressionEnd(source, cursor);
    else if (source[cursor] === ">") return cursor + 1;
    else cursor += 1;
  }
  return source.length;
}

/** A JSX element owns its child text, tags and embedded JavaScript expressions. */
function mdxElementEnd(source: string, start: number): number {
  let cursor = mdxTagEnd(source, start);
  const first = source.slice(start, cursor);
  if (first.startsWith("</") || first.endsWith("/>")) return cursor;
  let depth = 1;
  while (cursor < source.length) {
    if (source[cursor] === "{") cursor = mdxExpressionEnd(source, cursor);
    else if (/^<\/?(?:[\p{ID_Start}_$][\p{ID_Continue}$.:_-]*|>)/u.test(source.slice(cursor))) {
      const end = mdxTagEnd(source, cursor);
      const tag = source.slice(cursor, end);
      if (tag.startsWith("</")) depth -= 1;
      else if (!tag.endsWith("/>")) depth += 1;
      cursor = end;
      if (!depth) return cursor;
    } else cursor += 1;
  }
  return cursor;
}

/** Flow MDX permits only tags/expressions and whitespace through the line ending. */
function mdxLineRegion(source: string, start: number): { kind: "flow" | "inline"; end: number } {
  let cursor = start;
  const openTags: number[] = [];
  for (;;) {
    if (source[cursor] === "{") cursor = mdxExpressionEnd(source, cursor);
    else if (/^<\/?(?:[\p{ID_Start}_$][\p{ID_Continue}$.:_-]*|>)/u.test(source.slice(cursor))) {
      const end = mdxTagEnd(source, cursor);
      const tag = source.slice(cursor, end);
      if (tag.startsWith("</")) openTags.pop();
      else if (!tag.endsWith("/>")) openTags.push(cursor);
      cursor = end;
    } else {
      const opening = openTags[0];
      return {
        kind: "inline",
        end: opening === undefined ? cursor : mdxElementEnd(source, opening),
      };
    }
    while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
    if (cursor >= source.length || source[cursor] === "\n") return { kind: "flow", end: cursor };
  }
}

function startsMdxHeadingRegion(line: string): boolean {
  return line.startsWith("{") ||
    /^<\/?(?:[\p{ID_Start}_$][\p{ID_Continue}$.:_-]*|>)/u.test(line);
}

function startsMdxHeadingFlow(line: string): boolean {
  return startsMdxHeadingRegion(line) && mdxLineRegion(line + "\n", 0).kind === "flow";
}

type MdxHeadingContainer =
  | { kind: "quote" }
  | { kind: "list"; indent: number; empty: boolean };

type MdxHeadingParagraph = {
  owner: MdxHeadingContainer[];
  kind: "definition" | "text";
  lines: string[];
};

type MdxHeadingState = {
  containers: MdxHeadingContainer[];
  paragraph?: MdxHeadingParagraph;
  fence?: { owner: MdxHeadingContainer[]; marker: string };
};

function sameHeadingOwner(a: MdxHeadingContainer[], b: MdxHeadingContainer[]): boolean {
  return a.length === b.length && a.every((frame, index) => frame === b[index]);
}

/** Consume each frame's prefix at its own level, never an aggregate indentation. */
function readHeadingOwnedLine(
  source: string,
  owner: MdxHeadingContainer[],
  mdx = true,
): string | undefined {
  let line = expandHeadingIndentation(source);
  for (const frame of owner) {
    if (frame.kind === "quote") {
      const prefix = (mdx ? /^ *>[ \t]?/ : /^ {0,3}>[ \t]?/).exec(line);
      if (!prefix) return undefined;
      line = line.slice(prefix[0].length);
    } else {
      if ((/^ */.exec(line)?.[0].length ?? 0) < frame.indent) {
        if (hasHeadingContent(line, true)) return undefined;
        line = "";
        continue;
      }
      line = line.slice(frame.indent);
    }
  }
  return line;
}

/** Read only the owned lines needed to classify an expression or JSX region. */
function mdxHeadingRegion(
  lines: string[],
  index: number,
  first: string,
  owner: MdxHeadingContainer[],
): { kind: "flow" | "inline"; through: number; text: string } {
  const content = [first];
  let exhausted = false;
  for (;;) {
    const source = content.join("\n") + "\n";
    const region = mdxLineRegion(source, 0);
    if (region.end < source.length || exhausted || index + content.length >= lines.length) {
      const consumed = source.slice(0, region.end).split("\n").length;
      const count = Math.min(consumed, content.length);
      return {
        kind: region.kind,
        through: index + count - 1,
        text: content.slice(0, count).join("\n").replace(/\s*\n\s*/g, " ").trim(),
      };
    }
    // Geometric lookahead avoids rescanning every growing one-line prefix
    // when a multiline region is incomplete.
    const batch = content.length;
    for (let step = 0; step < batch; step += 1) {
      if (index + content.length >= lines.length) {
        exhausted = true;
        break;
      }
      const next = readHeadingOwnedLine(lines[index + content.length] ?? "", owner);
      if (next === undefined) {
        exhausted = true;
        break;
      }
      content.push(next);
    }
  }
}

/** One prefix traversal separates actual ownership from inherited interruption rules. */
function mdxHeadingLine(
  source: string,
  state: MdxHeadingState,
  flow?: (line: string, owner: MdxHeadingContainer[]) => boolean,
): {
  line: string;
  owner: MdxHeadingContainer[];
  lazy: boolean;
  sameParagraph: boolean;
} {
  let line = expandHeadingIndentation(source);
  const owner: MdxHeadingContainer[] = [];
  for (const frame of state.containers) {
    if (frame.kind === "quote") {
      const prefix = /^ *>[ \t]?/.exec(line);
      if (!prefix) break;
      line = line.slice(prefix[0].length);
    } else {
      if ((/^ */.exec(line)?.[0].length ?? 0) < frame.indent) break;
      line = line.slice(frame.indent);
    }
    owner.push(frame);
  }
  const paragraph = state.paragraph;
  const leavesOwner = paragraph && !sameHeadingOwner(owner, paragraph.owner);
  const lazy = Boolean(
    leavesOwner && owner.every((frame, index) => frame === paragraph.owner[index]) &&
      hasHeadingContent(line, true) && !startsInterruptingBlock(line, true, flow?.(line, owner)) &&
      headingListMarker(line, true) === null,
  );
  if (lazy && paragraph) {
    return { line, owner: paragraph.owner, lazy: true, sameParagraph: true };
  }
  const interruptsParagraph = paragraph !== undefined && sameHeadingOwner(owner, paragraph.owner);
  for (;;) {
    const quote = /^ *>[ \t]?/.exec(line);
    if (quote) {
      owner.push({ kind: "quote" });
      line = line.slice(quote[0].length);
      continue;
    }
    const marker = headingListMarker(line, true);
    if (!marker || isThematicBreak(line, true)) break;
    const remaining = line.slice(marker[0].length);
    const empty = !hasHeadingContent(remaining, true);
    const markerText = line.replace(/^[ \t]*/, "");
    if (
      interruptsParagraph &&
      (empty || /^\d/.test(markerText) && !/^1[.)]/.test(markerText))
    ) break;
    const spacing = marker[1] ?? "";
    const indent = marker[0].length - spacing.length + (empty ? 1 : Math.max(1, spacing.length));
    owner.push({ kind: "list", indent, empty });
    line = line.slice(indent);
  }
  return {
    line,
    owner,
    lazy: false,
    sameParagraph: paragraph !== undefined && sameHeadingOwner(owner, paragraph.owner),
  };
}

function mdxHeadingText(
  owner: MdxHeadingContainer[],
  previous: MdxHeadingParagraph | undefined,
  content: string,
): MdxHeadingParagraph {
  const lines = previous?.kind === "text" ? previous.lines : [];
  lines.push(content);
  return { owner, kind: "text", lines };
}

/** MDX's disabled indented-code rule needs explicit per-container ownership. */
function findFirstMdxH1(markdown: string): string | undefined {
  const body = markdown.replaceAll("\0", "\ufffd").replace(
    /^---\n(?:---|[\s\S]*?\n---)(?:\n|$)/,
    "",
  );
  const lines = body.split("\n");
  const state: MdxHeadingState = { containers: [] };
  let definitionThrough = -1;
  let mdxThrough = -1;
  let sourceOffset = 0;
  for (const [index, source] of lines.entries()) {
    const lineOffset = sourceOffset;
    sourceOffset += source.length + 1;
    if (lineOffset < mdxThrough || index <= definitionThrough) continue;
    if (state.fence) {
      const content = readHeadingOwnedLine(source, state.fence.owner);
      if (content !== undefined) {
        state.containers = state.fence.owner;
        const closing = /^(`{3,}|~{3,})[ \t]*$/.exec(content.replace(/^[ \t]*/, ""))?.[1];
        if (
          closing && closing[0] === state.fence.marker[0] &&
          closing.length >= state.fence.marker.length
        ) state.fence = undefined;
        continue;
      }
      state.fence = undefined;
      state.paragraph = undefined;
    }
    if (!hasHeadingContent(source, true)) {
      state.paragraph = undefined;
      // Blank lines may omit list indentation, but cannot omit a quote prefix.
      // Keep only list ancestors before the first unmatched quote.
      const quote = state.containers.findIndex((frame) => frame.kind === "quote");
      if (quote >= 0) state.containers = state.containers.slice(0, quote);
      const lastContainer = state.containers.at(-1);
      if (lastContainer?.kind === "list" && lastContainer.empty) {
        state.containers = state.containers.slice(0, -1);
      }
      continue;
    }
    const flowAt = (cursor: number, line: string, owner: MdxHeadingContainer[]): boolean => {
      const content = line.replace(/^[ \t]*/, "");
      return startsMdxHeadingRegion(content) &&
        mdxHeadingRegion(lines, cursor, content, owner).kind === "flow";
    };
    const parsed = mdxHeadingLine(source, state, (line, owner) => flowAt(index, line, owner));
    state.containers = parsed.owner;
    const line = parsed.line;
    for (const [depth, frame] of parsed.owner.entries()) {
      if (
        frame.kind === "list" &&
        (hasHeadingContent(line, true) || depth < parsed.owner.length - 1)
      ) frame.empty = false;
    }
    const structural = line.replace(/^[ \t]*/, "");
    const start = lineOffset + (source.match(/^[ \t]*/)?.[0].length ?? 0);
    if (!state.paragraph && /^(?:export|import) /.test(source)) {
      mdxThrough = mdxExpressionEnd(body, start, true);
      continue;
    }
    if (startsMdxHeadingRegion(structural)) {
      const region = mdxHeadingRegion(lines, index, structural, parsed.owner);
      definitionThrough = region.through;
      if (region.kind === "flow") state.paragraph = undefined;
      else {
        const previous = parsed.sameParagraph ? state.paragraph : undefined;
        state.paragraph = mdxHeadingText(parsed.owner, previous, region.text);
      }
      continue;
    }
    const fence = !parsed.lazy && markdownFenceStart(structural);
    if (fence) {
      state.fence = { owner: parsed.owner, marker: fence };
      state.paragraph = undefined;
      continue;
    }
    const previous = parsed.sameParagraph ? state.paragraph : undefined;
    if (!previous || previous.kind === "definition") {
      const continuations = new Map<number, ReturnType<typeof mdxHeadingLine>>();
      const readContinuation = (cursor: number): ReturnType<typeof mdxHeadingLine> | undefined => {
        if (cursor >= lines.length) return undefined;
        let next = continuations.get(cursor);
        if (!next) {
          next = mdxHeadingLine(lines[cursor] ?? "", {
            containers: parsed.owner,
            paragraph: { owner: parsed.owner, kind: "definition", lines: [] },
          }, (line, owner) => flowAt(cursor, line, owner));
          continuations.set(cursor, next);
        }
        return sameHeadingOwner(next.owner, parsed.owner) ? next : undefined;
      };
      const length = headingDefinitionLines(
        lines,
        index,
        0,
        line,
        0,
        previous?.kind === "definition",
        true,
        (cursor) => readContinuation(cursor)?.line,
        (cursor, line) =>
          !readContinuation(cursor)?.lazy &&
          interruptsDefinition(line, true, flowAt(cursor, line, parsed.owner)),
      );
      if (length) {
        definitionThrough = index + length - 1;
        state.paragraph = { owner: parsed.owner, kind: "definition", lines: [] };
        continue;
      }
    }
    const atx = /^#{1,6}(?:[ \t]+(.*))?$/.exec(structural);
    if (atx) {
      if (!parsed.owner.length && /^#(?:[ \t]|$)/.test(structural)) {
        const content = atx[1] ?? "";
        return /^#+[ \t]*$/.test(content) ? "" : content.replace(/[ \t]+#+[ \t]*$/, "").trim();
      }
      state.paragraph = undefined;
      continue;
    }
    if (previous?.kind === "text" && !parsed.lazy && /^(?:=+|-+)[ \t]*$/.test(structural)) {
      if (!parsed.owner.length && structural.startsWith("=")) return previous.lines.join(" ");
      state.paragraph = undefined;
      continue;
    }
    if (isThematicBreak(line, true) || !hasHeadingContent(line, true)) {
      state.paragraph = undefined;
      continue;
    }
    state.paragraph = mdxHeadingText(parsed.owner, previous, line.trim());
  }
  return undefined;
}

/** Reference definitions contribute no text to a quoted Setext heading. */
function hasQuotedSetextText(ownedLines: { text: string; lazy: boolean }[]): boolean {
  const lines = ownedLines.map((line) => line.text);
  let offset = 0;
  while (offset < lines.length) {
    // Fully matched lines have Markdown indentation semantics. Lazy lines keep
    // their literal indentation, which cannot introduce another definition.
    if (ownedLines[offset]?.lazy && /^[ \t]/.test(lines[offset] ?? "")) return true;
    const count = headingDefinitionLines(
      lines,
      offset,
      0,
      lines[offset],
      0,
      offset > 0,
      false,
      undefined,
      (index, line) => !ownedLines[index]?.lazy && interruptsDefinition(line, false),
    );
    if (!count) return true;
    offset += count;
  }
  return false;
}

/** The first top-level H1 outside code, HTML blocks, and leading YAML frontmatter. */
function findFirstH1(markdown: string, mdx = false): string | undefined {
  if (mdx) return findFirstMdxH1(markdown);
  let fence: string | undefined;
  let htmlEnd: RegExp | "blank" | undefined;
  let quotedBlockOwner: MdxHeadingContainer[] | undefined;
  let blockIndent = 0;
  let paragraphOpen = false;
  let rootParagraph: string[] = [];
  let indentedCode = false;
  let emptyItem = false;
  let setextEligible = false;
  let quoteContainers: { indents: number[]; emptyItem: boolean }[] = [];
  let quoteRootIndents: number[] = [];
  let quoteParagraph: {
    owners: number[][];
    lines: { text: string; lazy: boolean }[];
  } | undefined;
  let definitionThrough = -1;
  let referenceParagraph: { indents: number[] } | undefined;
  const indents: number[] = [];
  const body = markdown.replaceAll("\0", "\ufffd").replace(
    /^---\n(?:---|[\s\S]*?\n---)(?:\n|$)/,
    "",
  );
  const lines = body.split("\n");
  for (const [lineIndex, sourceLine] of lines.entries()) {
    const raw = expandHeadingIndentation(sourceLine);
    if (!paragraphOpen) {
      rootParagraph = [];
      quoteParagraph = undefined;
    }
    if (!hasHeadingContent(raw, false) && emptyItem) {
      indents.pop();
      emptyItem = false;
    }
    if (lineIndex <= definitionThrough) continue;
    if (!hasHeadingContent(raw, false)) {
      quoteParagraph = undefined;
      quoteContainers = [];
    }
    if (
      quoteParagraph && !/^ {0,3}>/.test(raw) &&
      (startsInterruptingBlock(raw) || /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(raw))
    ) {
      quoteParagraph = undefined;
      paragraphOpen = false;
    }
    let container = headingContainerLine(
      raw,
      indents,
      Boolean(fence || htmlEnd),
      paragraphOpen,
      quoteParagraph !== undefined,
    );
    // Container ownership expires before any leaf reader can return early,
    // including reference definitions that contribute no paragraph text.
    if (
      container.startsItem || indents.length !== quoteRootIndents.length ||
      indents.some((indent, index) => indent !== quoteRootIndents[index])
    ) {
      quoteContainers = [];
      quoteParagraph = undefined;
    }
    if (!quoteParagraph && !/^ {0,3}>/.test(container.line)) quoteContainers = [];
    const referenceIndents = referenceParagraph?.indents;
    if (
      referenceIndents &&
      (container.startsItem || indents.length !== referenceIndents.length ||
        indents.some((indent, index) => indent !== referenceIndents[index]))
    ) {
      referenceParagraph = undefined;
      paragraphOpen = false;
    }
    let line = container.line;
    if (container.startsItem) {
      paragraphOpen = false;
      emptyItem = container.emptyItem;
    } else if (hasHeadingContent(raw, false)) emptyItem = false;
    let containerIndent = indents.at(-1) ?? 0;
    const quotedLine = quotedBlockOwner
      ? readHeadingOwnedLine(raw, quotedBlockOwner, false)
      : undefined;
    const continuedQuote = quotedLine !== undefined;
    if (continuedQuote) line = quotedLine;
    if (
      (htmlEnd || fence) && !continuedQuote &&
      (quotedBlockOwner !== undefined ||
        hasHeadingContent(raw, false) && containerIndent < blockIndent)
    ) {
      htmlEnd = undefined;
      fence = undefined;
      quotedBlockOwner = undefined;
      paragraphOpen = false;
      container = headingContainerLine(raw, indents, false, false, false);
      line = container.line;
      containerIndent = indents.at(-1) ?? 0;
      emptyItem = container.emptyItem;
    }
    if (htmlEnd) {
      if (htmlEnd === "blank" ? !hasHeadingContent(line, false) : htmlEnd.test(line)) {
        htmlEnd = undefined;
        quotedBlockOwner = undefined;
        paragraphOpen = false;
      }
      continue;
    }
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) {
        fence = undefined;
        quotedBlockOwner = undefined;
        paragraphOpen = false;
      }
      continue;
    }
    if (!paragraphOpen || referenceParagraph) {
      const definitionLength = headingDefinitionLines(
        lines,
        lineIndex,
        containerIndent,
        line,
        indents.at(-2) ?? 0,
        referenceParagraph !== undefined,
      );
      if (definitionLength) {
        definitionThrough = lineIndex + definitionLength - 1;
        // Definitions belong to their paragraph for interruption rules, but
        // contribute no visible text eligible for a Setext heading.
        referenceParagraph = { indents: [...indents] };
        paragraphOpen = true;
        setextEligible = false;
        continue;
      }
    }
    // A reference-only paragraph has no text for Setext conversion. A short
    // underline remains text; a thematic break still closes the paragraph.
    const referenceUnderline = referenceParagraph !== undefined &&
      /^ {0,3}(?:=+|-+)[ \t]*$/.test(line) && !isThematicBreak(line);
    referenceParagraph = undefined;
    const quote = /^ {0,3}>[ \t]?(.*)$/.exec(line);
    if (quote) {
      rootParagraph = [];
      // Lists survive their paragraphs, including blank lines, headings and code.
      // Reuse the normal container reader at each explicitly matched quote depth.
      if (
        container.startsItem || indents.length !== quoteRootIndents.length ||
        indents.some((indent, index) => indent !== quoteRootIndents[index])
      ) {
        quoteContainers = [];
        quoteParagraph = undefined;
      }
      quoteRootIndents = [...indents];
      let content = line;
      let quoteDepth = 0;
      let startsQuotedItem = false;
      let lazyQuote = false;
      let matchedAncestors = Boolean(quoteParagraph);
      while (/^ {0,3}>/.test(content)) {
        content = content.replace(/^ {0,3}>[ \t]?/, "");
        const frame = quoteContainers[quoteDepth] ?? { indents: [], emptyItem: false };
        const previousIndents = [...frame.indents];
        if (!hasHeadingContent(content, false) && frame.emptyItem) {
          frame.indents.pop();
          frame.emptyItem = false;
        }
        const quoteLists = frame.indents;
        const owner = quoteParagraph?.owners[quoteDepth];
        const continues = matchedAncestors && Boolean(owner) && !startsQuotedItem;
        const nestedContainer = headingContainerLine(
          content,
          quoteLists,
          false,
          continues,
          quoteDepth + 1 < (quoteParagraph?.owners.length ?? 0),
        );
        if (nestedContainer.startsItem) frame.emptyItem = nestedContainer.emptyItem;
        else if (hasHeadingContent(content, false)) frame.emptyItem = false;
        quoteContainers[quoteDepth] = frame;
        matchedAncestors &&= owner !== undefined && owner.length === quoteLists.length &&
          owner.every((indent, index) => indent === quoteLists[index]);
        quoteDepth += 1;
        // Lazy content retains its physical indentation. Missing list prefixes
        // cannot expose a new quote, fence or thematic break; complete HTML
        // tags follow the content renderer's owned-block handling below.
        content = nestedContainer.lazy ? content : nestedContainer.line;
        lazyQuote ||= nestedContainer.lazy;
        startsQuotedItem ||= nestedContainer.startsItem;
        if (
          nestedContainer.startsItem || previousIndents.length !== quoteLists.length ||
          previousIndents.some((indent, index) => indent !== quoteLists[index])
        ) quoteContainers.length = quoteDepth;
      }
      const continuesParagraph = matchedAncestors && !startsQuotedItem &&
        quoteDepth <= (quoteParagraph?.owners.length ?? 0);
      if (!continuesParagraph) quoteContainers.length = quoteDepth;
      const blockOwner: MdxHeadingContainer[] = [];
      if (containerIndent) blockOwner.push({ kind: "list", indent: containerIndent, empty: false });
      for (const frame of quoteContainers.slice(0, quoteDepth)) {
        blockOwner.push({ kind: "quote" });
        const indent = frame.indents.at(-1) ?? 0;
        if (indent) blockOwner.push({ kind: "list", indent, empty: false });
      }
      const quoteFence = markdownFenceStart(content);
      // Match the content renderer: a complete tag on a lazy container line
      // opens an owned HTML block instead of extending its text paragraph.
      const quoteHtml = markdownHtmlBlockEnd(
        content,
        !continuesParagraph || lazyQuote || quoteDepth < (quoteParagraph?.owners.length ?? 0),
      );
      if (quoteFence) {
        fence = quoteFence;
        quotedBlockOwner = blockOwner;
        blockIndent = containerIndent;
        paragraphOpen = false;
        quoteParagraph = undefined;
        continue;
      }
      if (quoteHtml) {
        if (quoteHtml === "blank" || !quoteHtml.test(content)) htmlEnd = quoteHtml;
        quotedBlockOwner = htmlEnd ? blockOwner : undefined;
        blockIndent = containerIndent;
        paragraphOpen = false;
        quoteParagraph = undefined;
        continue;
      }
      indentedCode = false;
      const previous = continuesParagraph ? quoteParagraph : undefined;
      // Missing list indentation or unmatched quote descendants are lazy text,
      // so an underline there cannot end a paragraph in another container.
      const quotedUnderline = previous?.owners.length === quoteDepth && !lazyQuote &&
        /^ {0,3}(?:=+|-+)[ \t]*$/.test(content);
      const completesSetext = quotedUnderline && hasQuotedSetextText(previous.lines);
      if (
        !completesSetext && hasHeadingContent(content, false) &&
        (continuesParagraph || !/^ {4}/.test(content)) &&
        (quotedUnderline || !startsInterruptingBlock(content))
      ) {
        quoteParagraph = previous ?? {
          owners: quoteContainers.slice(0, quoteDepth).map((frame) => [...frame.indents]),
          lines: [],
        };
        quoteParagraph.lines.push({
          text: content,
          lazy: lazyQuote || quoteDepth < quoteParagraph.owners.length,
        });
      } else {
        quoteParagraph = undefined;
        quoteContainers.length = quoteDepth;
      }
      paragraphOpen = Boolean(quoteParagraph);
      setextEligible = false;
      continue;
    }
    if (!quoteParagraph) quoteContainers = [];
    // A lazy line can retain an ancestor container, but missing indentation must not
    // be stripped as if that ancestor actually continued (notably nested list HTML).
    const blockEnd = markdownHtmlBlockEnd(
      container.lazy
        ? raw.slice(
          (/^ */.exec(raw)?.[0].length ?? 0) >= (indents.at(-2) ?? 0) ? indents.at(-2) ?? 0 : 0,
        )
        : line,
      !paragraphOpen || container.lazy || quoteParagraph !== undefined,
    );
    if (blockEnd) {
      indentedCode = false;
      const lazyQuoteHtml = markdownHtmlBlockEnd(line, false) === undefined
        ? quoteParagraph
        : undefined;
      if (lazyQuoteHtml) {
        quotedBlockOwner = [];
        if (containerIndent) {
          quotedBlockOwner.push({ kind: "list", indent: containerIndent, empty: false });
        }
        for (const owner of lazyQuoteHtml.owners) {
          quotedBlockOwner.push({ kind: "quote" });
          const indent = owner.at(-1) ?? 0;
          if (indent) quotedBlockOwner.push({ kind: "list", indent, empty: false });
        }
      }
      blockIndent = lazyQuoteHtml ? containerIndent + 1 : containerIndent;
      quoteParagraph = undefined;
      if (blockEnd === "blank" || !blockEnd.test(line)) htmlEnd = blockEnd;
      paragraphOpen = false;
      continue;
    }
    const fenceLine = line;
    const opening = markdownFenceStart(fenceLine);
    if (!container.lazy && opening) {
      fence = opening;
      quoteParagraph = undefined;
      indentedCode = false;
      blockIndent = containerIndent;
      paragraphOpen = false;
      continue;
    }
    if (hasHeadingContent(raw, false)) {
      indentedCode = !paragraphOpen && /^ {4}/.test(line);
    }
    const headingLine = line;
    const atx = /^ {0,3}#(?:[ \t]+(.*))?$/.exec(raw);
    if (atx && containerIndent === 0) {
      const content = atx[1] ?? "";
      return /^#+[ \t]*$/.test(content) ? "" : content.replace(/[ \t]+#+[ \t]*$/, "").trim();
    }
    const paragraphLine = container.lazy ? raw : line;
    if (
      paragraphOpen && setextEligible && !container.lazy && containerIndent === 0 &&
      !quoteParagraph && rootParagraph.length && /^ {0,3}=+[ \t]*$/.test(headingLine)
    ) return rootParagraph.join(" ");
    paragraphOpen = !indentedCode && hasHeadingContent(line, false) &&
      !(paragraphOpen && setextEligible && !container.lazy && !quoteParagraph &&
        /^ {0,3}(?:=+|-+)[ \t]*$/.test(headingLine)) &&
      (referenceUnderline ||
        !/^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)/.test(
          paragraphLine,
        ));
    setextEligible = paragraphOpen && !/^ {0,3}>/.test(raw);
    if (paragraphOpen && !quoteParagraph && containerIndent === 0) {
      rootParagraph.push(paragraphLine.trim());
    } else rootParagraph = [];
    if (paragraphOpen && quoteParagraph) {
      quoteParagraph.lines.push({ text: paragraphLine, lazy: true });
    }
  }
  return undefined;
}

const MAX_TITLE_SLUG_LENGTH = 80;

/** A short slug from a title, without a leading list number such as "20. ". */
function slugifyTitle(title: string): string {
  const slug = slugifyKnowledgeValue(title.replace(/^\d+[.)]\s+/, ""))
    .slice(0, MAX_TITLE_SLUG_LENGTH).replace(/-+$/, "") || "document";
  const portable = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)
    ? `${slug}-document`
    : slug;
  return escapeReservedKnowledgeSlug(portable);
}

interface KnowledgeTitleAllocation {
  observed: Map<number, string | undefined>;
  sources: Map<string, number>;
  candidates: Map<string, Set<number>>;
  next: number;
  owners: Map<number, string | undefined>;
  discoveryComplete: boolean;
}

function observeKnowledgeCandidate(
  state: KnowledgeTitleAllocation,
  attempt: number,
  owner: string | undefined,
  occupied = true,
) {
  const prior = state.owners.get(attempt);
  if (prior !== undefined && prior !== owner) {
    const candidates = state.candidates.get(prior);
    candidates?.delete(attempt);
    if (state.sources.get(prior) === attempt) {
      state.sources.delete(prior);
      if (candidates?.size) {
        let earliest = Infinity;
        for (const candidate of candidates) earliest = Math.min(earliest, candidate);
        state.sources.set(prior, earliest);
      }
    }
    if (!candidates?.size) state.candidates.delete(prior);
  }
  if (owner !== undefined) {
    const candidates = state.candidates.get(owner) ?? new Set<number>();
    candidates.add(attempt);
    state.candidates.set(owner, candidates);
  }
  state.owners.set(attempt, owner);
  if (occupied) state.observed.set(attempt, owner);
  if (owner !== undefined && attempt < (state.sources.get(owner) ?? Infinity)) {
    state.sources.set(owner, attempt);
  }
  while (state.observed.has(state.next)) state.next += 1;
}

/** Nonstandard extension spellings retain a separate internal identity, never a path. */
function knowledgeCandidateKey(fileName: string): string {
  return fileName.endsWith(".md") ? fileName.slice(0, -3) : `\0${fileName}`;
}

function knowledgeCandidateFileName(candidate: string): string {
  return candidate.startsWith("\0") ? candidate.slice(1) : `${candidate}.md`;
}

// Bound process-local publication observations without retaining allocation sessions.
const knowledgePublicationVersions = new Map<string, symbol>();

function knowledgePublicationVersion(outputDir: string, changed = false): symbol {
  const key = resolve(outputDir);
  const version = (!changed && knowledgePublicationVersions.get(key)) || Symbol();
  knowledgePublicationVersions.delete(key);
  knowledgePublicationVersions.set(key, version);
  if (knowledgePublicationVersions.size > 1024) {
    const oldest = knowledgePublicationVersions.keys().next().value;
    if (oldest !== undefined) knowledgePublicationVersions.delete(oldest);
  }
  return version;
}

interface KnowledgeDirectoryAllocation {
  publicationVersion?: symbol;
  invalidated?: boolean;
  titles: Map<string, KnowledgeTitleAllocation>;
  tail: Promise<void>;
  listing?: Map<string, Map<string, Deno.DirEntry>>;
  sourceOwners?: Map<string, string | undefined>;
  sourceCandidates?: Map<string, Set<string>>;
  relativeLegacyNames?: Set<string>;
  ambiguousResourceNames?: Set<string>;
}

function invalidateKnowledgeDirectory(directory: KnowledgeDirectoryAllocation): void {
  directory.titles.clear();
  directory.listing = undefined;
  directory.sourceOwners = undefined;
  directory.sourceCandidates = undefined;
  directory.relativeLegacyNames = undefined;
  directory.ambiguousResourceNames = undefined;
  directory.invalidated = false;
}

/** Invocation-local observations only; never share this across ingestion runs. */
export class KnowledgeAllocationSession {
  private readonly directories = new Map<string, KnowledgeDirectoryAllocation>();

  private async enqueue<T>(
    outputDir: string,
    write: (directory: KnowledgeDirectoryAllocation) => Promise<T>,
  ): Promise<T> {
    let directory = this.directories.get(outputDir);
    if (!directory) {
      directory = { titles: new Map(), tail: Promise.resolve() };
      this.directories.set(outputDir, directory);
    }
    const allocation = directory;
    const result = allocation.tail.then(() => write(allocation));
    allocation.tail = result.then(() => undefined, () => undefined);
    return await result;
  }

  async allocate<T>(
    outputDir: string,
    slug: string,
    write: (
      state: KnowledgeTitleAllocation,
      siblings: () => Promise<Deno.DirEntry[]>,
      recordWrite: (candidate: string, owner: string) => void,
      selectedSlug: string,
      cachedOwner: (candidate: string) => { owner: string | undefined } | undefined,
      publishedCandidate?: string,
      selectedOutputName?: string,
    ) => Promise<T>,
    identity?: {
      owners: string[][];
      localPath?: string;
      hints?: () => Promise<SourceOutputHint[]>;
      readOwner: (candidate: string) => Promise<string | undefined>;
    },
    guard?: (write: () => Promise<T>) => Promise<T>,
  ): Promise<T> {
    return await this.enqueue(outputDir, async (directory) => {
      const allocate = async () => {
        const version = knowledgePublicationVersion(outputDir);
        if (directory.invalidated || directory.publicationVersion !== version) {
          invalidateKnowledgeDirectory(directory);
        }
        directory.publicationVersion = version;
        const loadListing = async () => {
          if (directory.listing) return directory.listing;
          const families = new Map<string, Map<string, Deno.DirEntry>>();
          let entries: Deno.DirEntry[];
          try {
            entries = await Array.fromAsync(Deno.readDir(outputDir));
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
            entries = [];
          }
          for (const entry of entries) {
            if (
              !entry.name.toLowerCase().endsWith(".md") ||
              !isKnowledgeSourceOutputCandidate(entry.name.slice(0, -3))
            ) continue;
            const stem = entry.name.slice(0, -3);
            const names = [stem];
            const suffix = /^(.*)-([1-9]\d*)$/.exec(stem);
            if (
              suffix && suffix[1] !== undefined && Number.isSafeInteger(Number(suffix[2])) &&
              Number(suffix[2]) >= 2
            ) names.push(suffix[1]);
            for (const name of names) {
              const family = families.get(name) ?? new Map<string, Deno.DirEntry>();
              family.set(entry.name, entry);
              families.set(name, family);
            }
          }
          directory.listing = families;
          return families;
        };
        const recordCandidate = (candidate: string, owner: string) => {
          const fileName = knowledgeCandidateFileName(candidate);
          const stem = fileName.slice(0, -3);
          const prior = directory.sourceOwners?.get(candidate);
          if (prior !== undefined && prior !== owner) {
            directory.sourceCandidates?.get(prior)?.delete(candidate);
          }
          directory.sourceOwners?.set(candidate, owner);
          const legacyName = relativeLegacyLocalName(owner);
          if (legacyName !== undefined) directory.relativeLegacyNames?.add(legacyName);
          const resourceName = ambiguousRelativeResourceName(owner);
          if (resourceName !== undefined) directory.ambiguousResourceNames?.add(resourceName);
          if (directory.sourceCandidates) {
            const candidates = directory.sourceCandidates.get(owner) ?? new Set<string>();
            candidates.add(candidate);
            directory.sourceCandidates.set(owner, candidates);
          }
          const exactState = candidate.startsWith("\0")
            ? directory.titles.get(candidate)
            : undefined;
          if (exactState) {
            observeKnowledgeCandidate(exactState, 1, owner, exactState.observed.has(1));
          }
          const families: Array<{ name: string; attempt: number }> = [{
            name: stem,
            attempt: 1,
          }];
          const suffix = /^(.*)-([1-9]\d*)$/.exec(stem);
          if (
            suffix?.[1] !== undefined && Number.isSafeInteger(Number(suffix[2])) &&
            Number(suffix[2]) >= 2
          ) {
            families.push({ name: suffix[1], attempt: Number(suffix[2]) });
          }
          const entry: Deno.DirEntry = {
            name: fileName,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
          for (const family of families) {
            if (directory.listing) {
              const entries = directory.listing.get(family.name) ??
                new Map<string, Deno.DirEntry>();
              entries.set(entry.name, entry);
              directory.listing.set(family.name, entries);
            }
            const affected = candidate.startsWith("\0")
              ? undefined
              : directory.titles.get(family.name);
            if (affected) {
              observeKnowledgeCandidate(
                affected,
                family.attempt,
                owner,
                affected.observed.has(family.attempt),
              );
            }
          }
        };
        let publishedCandidate: string | undefined;
        let selectedOutputName: string | undefined;
        if (identity && identity.owners.length) {
          if (!directory.sourceOwners) {
            const owners = new Map<string, string | undefined>();
            const names = new Map<string, Deno.DirEntry>();
            for (const family of (await loadListing()).values()) {
              for (const [name, entry] of family) names.set(name, entry);
            }
            for (const [name, entry] of names) {
              if (entry.isFile && !entry.isSymlink) {
                const candidate = knowledgeCandidateKey(name);
                owners.set(candidate, await identity.readOwner(candidate));
              }
            }
            directory.sourceOwners = owners;
            directory.sourceCandidates = new Map();
            directory.relativeLegacyNames = new Set();
            directory.ambiguousResourceNames = new Set();
            for (const [name, owner] of owners) {
              const legacyName = relativeLegacyLocalName(owner);
              if (legacyName !== undefined) directory.relativeLegacyNames.add(legacyName);
              const resourceName = ambiguousRelativeResourceName(owner);
              if (resourceName !== undefined) directory.ambiguousResourceNames.add(resourceName);
              if (owner === undefined) continue;
              const candidates = directory.sourceCandidates.get(owner) ?? new Set<string>();
              candidates.add(name);
              directory.sourceCandidates.set(owner, candidates);
            }
          }
          const published = new Map<string, string>();
          for (const hint of await identity.hints?.() ?? []) {
            const candidate = hint.fileName === undefined
              ? hint.candidate
              : knowledgeCandidateKey(hint.fileName);
            if (await identity.readOwner(candidate) === hint.owner) {
              recordCandidate(candidate, hint.owner);
              published.set(hint.owner, candidate);
            }
          }
          // A compatible exact-path writer can migrate an ambiguous document between
          // allocations. Re-read only matching cached candidates before refusing.
          if (identity.localPath !== undefined && isAbsolute(identity.localPath)) {
            const name = basename(identity.localPath);
            if (
              directory.relativeLegacyNames?.has(name) ||
              directory.ambiguousResourceNames?.has(name)
            ) {
              for (const [candidate, owner] of directory.sourceOwners ?? []) {
                const cachedPositive = owner !== undefined &&
                  identity.owners.some((group) => group.includes(owner));
                if (
                  !cachedPositive && relativeLegacyLocalName(owner) !== name &&
                  ambiguousRelativeResourceName(owner) !== name
                ) continue;
                const current = await identity.readOwner(candidate);
                if (current === owner) continue;
                if (current !== undefined) recordCandidate(candidate, current);
                else {
                  if (owner !== undefined) {
                    directory.sourceCandidates?.get(owner)?.delete(candidate);
                  }
                  directory.sourceOwners?.set(candidate, undefined);
                }
              }
              directory.relativeLegacyNames?.delete(name);
              directory.ambiguousResourceNames?.delete(name);
              for (const owner of directory.sourceOwners?.values() ?? []) {
                if (relativeLegacyLocalName(owner) === name) {
                  directory.relativeLegacyNames?.add(name);
                }
                if (ambiguousRelativeResourceName(owner) === name) {
                  directory.ambiguousResourceNames?.add(name);
                }
              }
            }
          }
          const knownOwner = identity.owners.some((group) =>
            group.some((owner) => (directory.sourceCandidates?.get(owner)?.size ?? 0) > 0)
          );
          if (
            identity.localPath !== undefined && isAbsolute(identity.localPath) && !knownOwner &&
            directory.relativeLegacyNames?.has(basename(identity.localPath))
          ) {
            throw new Error(
              "Cannot establish local knowledge ownership from a relative legacy source. " +
                "Verify the existing document and use --slug to migrate its explicit output path.",
            );
          }
          if (
            identity.localPath !== undefined && isAbsolute(identity.localPath) && !knownOwner &&
            directory.ambiguousResourceNames?.has(basename(identity.localPath))
          ) {
            throw new Error(
              "Cannot establish knowledge ownership from an ambiguous relative resource. " +
                "Verify the existing document and use --slug to migrate its explicit output path.",
            );
          }
          ownerSelection: for (const group of identity.owners) {
            const matches = [
              ...new Set(
                group.flatMap((owner) => [...(directory.sourceCandidates?.get(owner) ?? [])]),
              ),
            ];
            if (!matches.length) continue;
            const attempt = (name: string) => {
              if (name === slug) return 1;
              const tail = name.startsWith(slug + "-") ? name.slice(slug.length + 1) : "";
              return /^[1-9]\d*$/.test(tail) && Number.isSafeInteger(Number(tail)) &&
                  Number(tail) >= 2
                ? Number(tail)
                : Infinity;
            };
            const preferred = new Set(group.flatMap((owner) => {
              const candidate = published.get(owner);
              return candidate === undefined ? [] : [candidate];
            }));
            matches.sort((a, b) =>
              Number(preferred.has(b)) - Number(preferred.has(a)) ||
              attempt(a) - attempt(b) || a.localeCompare(b)
            );
            for (const candidate of matches) {
              const current = await identity.readOwner(candidate);
              if (current === undefined || !group.includes(current)) {
                const prior = directory.sourceOwners.get(candidate);
                if (prior !== undefined) directory.sourceCandidates?.get(prior)?.delete(candidate);
                directory.sourceOwners.set(candidate, current);
                if (current !== undefined) {
                  const candidates = directory.sourceCandidates?.get(current) ?? new Set<string>();
                  candidates.add(candidate);
                  directory.sourceCandidates?.set(current, candidates);
                }
                continue;
              }
              if (candidate.startsWith("\0")) {
                selectedOutputName = knowledgeCandidateFileName(candidate);
                slug = selectedOutputName.slice(0, -3);
                publishedCandidate = slug;
              } else {
                if (!Number.isFinite(attempt(candidate))) slug = candidate;
                if (preferred.has(candidate)) publishedCandidate = candidate;
              }
              break ownerSelection;
            }
          }
        }
        const stateKey = selectedOutputName === undefined
          ? slug
          : knowledgeCandidateKey(selectedOutputName);
        let state = directory.titles.get(stateKey);
        if (!state) {
          state = {
            observed: new Map(),
            sources: new Map(),
            candidates: new Map(),
            next: 1,
            owners: new Map(),
            discoveryComplete: false,
          };
          directory.titles.set(stateKey, state);
        }
        return write(
          state,
          async () =>
            [...((await loadListing()).get(slug)?.values() ?? [])].filter((entry) =>
              selectedOutputName === undefined
                ? entry.name.endsWith(".md")
                : entry.name === selectedOutputName
            ),
          (candidate, owner) => {
            if (directory.publicationVersion !== knowledgePublicationVersion(outputDir)) {
              directory.invalidated = true;
            }
            directory.publicationVersion = knowledgePublicationVersion(outputDir, true);
            recordCandidate(
              selectedOutputName !== undefined && candidate === slug
                ? knowledgeCandidateKey(selectedOutputName)
                : candidate,
              owner,
            );
          },
          slug,
          (candidate) => {
            const key = selectedOutputName !== undefined && candidate === slug
              ? knowledgeCandidateKey(selectedOutputName)
              : candidate;
            return directory.sourceOwners?.has(key)
              ? { owner: directory.sourceOwners.get(key) }
              : undefined;
          },
          publishedCandidate,
          selectedOutputName,
        );
      };
      try {
        return await (guard ? guard(allocate) : allocate());
      } catch (error) {
        // A failed writer can still have published before reporting its failure.
        directory.publicationVersion = knowledgePublicationVersion(outputDir, true);
        invalidateKnowledgeDirectory(directory);
        throw error;
      }
    });
  }

  /** Exact-path writers may replace any observed identity, even when they fail. */
  async directWrite<T>(outputDir: string, write: () => Promise<T>): Promise<T> {
    return await this.enqueue(outputDir, async (directory) => {
      try {
        return await write();
      } finally {
        directory.publicationVersion = knowledgePublicationVersion(outputDir, true);
        invalidateKnowledgeDirectory(directory);
      }
    });
  }
}

/** Keep allocation callers on the shared, generation-aware claim protocol. */
const acquireKnowledgeCandidate = acquireKnowledgeTargetOutputClaim;

/** A relative legacy origin has no recorded working directory and cannot prove ownership. */
function relativeLegacyLocalName(owner: string | undefined): string | undefined {
  if (owner === undefined) return undefined;
  const value: unknown = JSON.parse(owner);
  if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== "string") return undefined;
  if (value[0] === "legacy-local") return isAbsolute(value[1]) ? undefined : basename(value[1]);
  if (value[0] !== "sourceKey") return undefined;
  let key: unknown;
  try {
    key = JSON.parse(value[1]);
  } catch {
    return undefined;
  }
  return Array.isArray(key) && key.length === 2 && key[0] === "local" &&
      typeof key[1] === "string" && !isAbsolute(key[1])
    ? basename(key[1])
    : undefined;
}

/** An untyped relative resource cannot establish its original local working directory. */
function ambiguousRelativeResourceName(owner: string | undefined): string | undefined {
  if (owner === undefined) return undefined;
  const value: unknown = JSON.parse(owner);
  if (
    !Array.isArray(value) || value.length !== 2 || value[0] !== "resource" ||
    typeof value[1] !== "string" || isAbsolute(value[1]) ||
    /^[a-z][a-z\d+.-]*:/i.test(value[1])
  ) return undefined;
  const path = normalize(value[1]).replaceAll("\\", "/");
  return basename(path);
}

function knowledgeOwnerFromContent(path: string, content: string): string | undefined {
  const metadata = inspectOkfDocument(path, content).metadata;
  const storedKey = readKnowledgeIngestSourceKey(metadata);
  const generated = metadata.generated;
  if (generated !== null && typeof generated === "object" && "source_key" in generated) {
    return storedKey === undefined ? undefined : JSON.stringify(["sourceKey", storedKey]);
  }
  if (metadata.resource === undefined) {
    const local = readProvableLegacyLocalKnowledgeSource(metadata);
    return local === undefined ? undefined : JSON.stringify(["legacy-local", local]);
  }
  const legacyGenerated = generated !== null && typeof generated === "object" &&
    "by" in generated && typeof generated.by === "string" &&
    /^veryfront\/\d/.test(generated.by);
  return legacyGenerated && typeof metadata.resource === "string"
    ? JSON.stringify(["resource", metadata.resource])
    : undefined;
}

/** Exact paths share candidate reservations but deliberately permit sequential replacement. */
async function writeExactKnowledgeOutput(
  outputDir: string,
  path: string,
  content: string | Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<void> {
  signal?.throwIfAborted();
  const name = relative(outputDir, path).replaceAll("\\", "/");
  // Markdown shares its stem with default allocation. NUL cannot occur in a filename,
  // so asset claims cannot collide with any Markdown stem, including extensionless assets.
  const candidate = name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : `\0asset\0${name}`;
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const claim = await acquireKnowledgeTargetOutputClaim(
    outputDir,
    candidate,
    name,
    await computeHash(JSON.stringify(["exact-path", name])),
    await computeHashBytes(bytes),
  );
  if (claim.kind === "busy") throw new Error(`Knowledge output is busy or reserved: ${name}`);
  const stage = join(dirname(claim.path), `${claim.generation}.output`);
  try {
    signal?.throwIfAborted();
    await claim.validateTarget();
    let mode: number | null = null;
    try {
      const existing = await Deno.lstat(path);
      if (!existing.isFile || existing.isSymlink) {
        throw new Error(`Knowledge output is not a regular file: ${name}`);
      }
      mode = existing.mode;
    } catch (error) {
      if (!isMissingKnowledgeOutput(error)) throw error;
    }
    await Deno.writeFile(stage, bytes, {
      createNew: true,
      signal,
      ...(mode === null ? {} : { mode: mode & 0o777 }),
    });
    if (mode !== null) await Deno.chmod(stage, mode & 0o777);
    signal?.throwIfAborted();
    await claim.validateTarget();
    await Deno.rename(stage, path);
    // Automatic allocation only discovers top-level Markdown documents. Publish the
    // same ownership hint for exact writers so already-primed sessions see them.
    if (
      typeof content === "string" && name.toLowerCase().endsWith(".md") && !name.includes("/") &&
      isKnowledgeSourceOutputCandidate(candidate)
    ) {
      const owner = knowledgeOwnerFromContent(name, content);
      if (owner !== undefined) {
        await withKnowledgeSourceClaim(
          outputDir,
          owner,
          signal,
          (index) => index.record(owner, candidate, name),
        );
      }
    }
  } finally {
    try {
      await Deno.remove(stage).catch((error) => {
        if (!isMissingKnowledgeOutput(error)) throw error;
      });
    } finally {
      await releaseKnowledgeTargetOutputClaim(claim);
    }
  }
}

/** Re-read every reuse candidate; cached conflicts only avoid redundant probes. */
async function writeKnowledgeFile(
  outputDir: string,
  slug: string,
  identity: { resource: string; sourceKey?: string; localPath?: string; inputPath: string },
  markdown: string,
  signal: AbortSignal | undefined,
  session: KnowledgeAllocationSession,
): Promise<{ slug: string; path: string }> {
  const publicationHash = await computeHash(markdown);
  const sourceIdentity = (resource: string, sourceKey?: string) =>
    JSON.stringify(
      sourceKey === undefined ? ["resource", resource] : ["sourceKey", sourceKey],
    );
  const source = sourceIdentity(identity.resource, identity.sourceKey);
  // A bare relative resource does not record whether it came from disk or an
  // upload. Only an absolute origin can prove ownership without a typed key.
  const legacySource = sourceIdentity(identity.resource);
  const provableLegacyResource = isAbsolute(identity.resource) ||
    /^[a-z][a-z\d+.-]*:/i.test(identity.resource);
  const legacyOwners = identity.sourceKey === undefined || provableLegacyResource
    ? [legacySource]
    : [];
  let localPath = identity.sourceKey === undefined ? identity.localPath : undefined;
  if (identity.sourceKey !== undefined) {
    try {
      const key: unknown = JSON.parse(identity.sourceKey);
      if (
        Array.isArray(key) && key.length === 2 && key[0] === "local" &&
        typeof key[1] === "string"
      ) localPath = normalize(key[1]);
    } catch { /* Opaque typed keys still retain their exact identity. */ }
  }
  const legacyLocalSource = localPath === undefined
    ? undefined
    : JSON.stringify(["legacy-local", localPath]);
  const matchesOwner = (owner: string | undefined) =>
    owner === source || (provableLegacyResource && owner === legacySource) ||
    (legacyLocalSource !== undefined && owner === legacyLocalSource);
  const reservationOwner = await computeHash(source);

  const canonicalSource = localPath !== undefined
    ? JSON.stringify(["local", localPath])
    : identity.sourceKey === undefined
    ? JSON.stringify(["local-input", normalize(identity.inputPath)])
    : source;
  const globalIdentity = identity.sourceKey !== undefined || localPath !== undefined;
  let sourceIndex: SourceOutputIndex;
  return await session.allocate(
    outputDir,
    slug,
    async (
      state,
      listSiblings,
      recordWrite,
      selectedSlug,
      cachedOwner,
      publishedCandidate,
      selectedOutputName,
    ) => {
      slug = selectedSlug;
      const observe = (attempt: number, owner: string | undefined, occupied = true) =>
        observeKnowledgeCandidate(state, attempt, owner, occupied);
      const forgetAbsent = (attempt: number) => {
        observe(attempt, undefined);
        state.observed.delete(attempt);
        state.owners.delete(attempt);
        state.next = Math.min(state.next, attempt);
      };
      const inspectPath = async (path: string) => {
        try {
          const value = await inspectLink(path, { bigint: true });
          const stage = value.isFile() && !value.isSymbolicLink() && value.nlink === 2n
            ? await readProvenKnowledgeOutputStage(outputDir, basename(path).slice(0, -3))
            : undefined;
          return {
            reusable: value.isFile() && !value.isSymbolicLink() &&
              (value.nlink === 1n || stage !== undefined),
            stage,
          };
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new Deno.errors.NotFound();
          }
          throw error;
        }
      };
      const reusablePath = async (path: string, recover = false) => {
        const inspected = await inspectPath(path);
        if (recover && inspected.stage) {
          // This call is only made while holding the candidate reservation.
          await Deno.remove(inspected.stage.stagePath);
          const fresh = await inspectLink(path, { bigint: true });
          return fresh.isFile() && !fresh.isSymbolicLink() && fresh.nlink === 1n;
        }
        return inspected.reusable;
      };
      // Sibling ownership is a snapshot for this ingestion run. Selected paths are always reread.
      const discover = async (attempt: number, path: string) => {
        signal?.throwIfAborted();
        try {
          const name = basename(path).slice(0, -3);
          const claimPath = await knowledgeOutputClaimPath(outputDir, name);
          try {
            if (await readKnowledgeClaimOwner(claimPath) === reservationOwner) {
              throw new Error(`Knowledge output is busy or reserved: ${name}.md`);
            }
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
          const cached = cachedOwner(name);
          if (cached !== undefined) {
            observe(attempt, cached.owner, false);
            return;
          }
          if (!(await inspectPath(path)).reusable) {
            observe(attempt, undefined, false);
            return;
          }
          observe(attempt, knowledgeOwnerFromContent(path, await Deno.readTextFile(path)), false);
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) forgetAbsent(attempt);
          else if (
            error instanceof Deno.errors.PermissionDenied ||
            (error instanceof Error && "code" in error &&
              (error.code === "EACCES" || error.code === "EPERM"))
          ) {
            observe(attempt, undefined, false);
          } else throw error;
        }
      };
      if (!state.discoveryComplete) {
        const siblings: Array<{ attempt: number; path: string }> = [];
        for (const entry of await listSiblings()) {
          if (!entry.isFile || entry.isSymlink) continue;
          const suffix =
            entry.name.startsWith(`${slug}-`) && entry.name.toLowerCase().endsWith(".md")
              ? entry.name.slice(slug.length + 1, -3)
              : undefined;
          const attempt = entry.name.slice(0, -3) === slug
            ? 1
            : suffix && /^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(Number(suffix)) &&
                Number(suffix) >= 2
            ? Number(suffix)
            : undefined;
          if (attempt !== undefined) {
            siblings.push({ attempt, path: join(outputDir, entry.name) });
          }
        }
        siblings.sort((a, b) => a.attempt - b.attempt);
        for (const sibling of siblings) await discover(sibling.attempt, sibling.path);
        state.discoveryComplete = true;
      }
      const preferredCandidate = () => {
        const publishedAttempt = publishedCandidate === slug
          ? 1
          : publishedCandidate?.startsWith(slug + "-")
          ? Number(publishedCandidate.slice(slug.length + 1))
          : undefined;
        const publishedOwner = publishedAttempt === undefined
          ? undefined
          : state.owners.get(publishedAttempt);
        const typed = identity.sourceKey === undefined ? undefined : state.sources.get(source);
        if (typed !== undefined) return publishedOwner === source ? publishedAttempt : typed;
        if (publishedAttempt !== undefined && matchesOwner(publishedOwner)) return publishedAttempt;
        const resourceOwner = identity.sourceKey === undefined || provableLegacyResource
          ? state.sources.get(legacySource)
          : undefined;
        const localOwner = legacyLocalSource === undefined
          ? undefined
          : state.sources.get(legacyLocalSource);
        if (resourceOwner === undefined) return localOwner;
        return localOwner === undefined ? resourceOwner : Math.min(resourceOwner, localOwner);
      };
      const firstCandidate = preferredCandidate() ?? state.next;
      for (let attempt = firstCandidate;; attempt += 1) {
        signal?.throwIfAborted();
        if (!Number.isSafeInteger(attempt) || attempt < 1) {
          throw new Error(`Knowledge output suffix exhausted: ${slug}.md`);
        }
        const observed = state.owners.get(attempt);
        if (observed !== undefined && !matchesOwner(observed)) continue;
        const remember = (owner: string | undefined) => {
          observe(attempt, owner);
        };
        const candidate = attempt === 1 ? slug : `${slug}-${attempt}`;
        const path = join(
          outputDir,
          selectedOutputName !== undefined && attempt === 1
            ? selectedOutputName
            : `${candidate}.md`,
        );
        const priorOwner = state.owners.get(attempt);
        const reselectLostHint = () => {
          if (!matchesOwner(priorOwner)) return false;
          const fallback = preferredCandidate();
          if (fallback === undefined || fallback === attempt) return false;
          attempt = fallback - 1;
          return true;
        };
        const inspectOwner = (content: string) => {
          const owner = knowledgeOwnerFromContent(path, content);
          remember(owner);
          return {
            matches: matchesOwner(owner),
            keyed: owner !== undefined && owner !== legacySource,
          };
        };
        signal?.throwIfAborted();
        const lock = await acquireKnowledgeCandidate(
          outputDir,
          candidate,
          basename(path),
          reservationOwner,
          publicationHash,
        );
        if (lock.kind === "busy") {
          if (
            (identity.sourceKey !== undefined && state.sources.get(source) === attempt) ||
            lock.owner === reservationOwner ||
            lock.owner === undefined
          ) {
            throw new Error(`Knowledge output is busy or reserved: ${candidate}.md`);
          }
          continue;
        }
        try {
          signal?.throwIfAborted();
          let existing: string;
          try {
            if (!await reusablePath(path, true)) {
              remember(undefined);
              reselectLostHint();
              continue;
            }
            existing = await Deno.readTextFile(path);
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
            forgetAbsent(attempt);
            if (reselectLostHint()) continue;
            try {
              const owner = knowledgeOwnerFromContent(path, markdown);
              if (globalIdentity && owner !== undefined) {
                await sourceIndex.record(owner, candidate, basename(path));
              }
              signal?.throwIfAborted();
              await publishKnowledgeOutput({
                path,
                claim: lock,
                content: markdown,
                signal,
                publication: { kind: "create" },
              });
              remember(source);
              recordWrite(candidate, source);
              return { slug: candidate, path };
            } catch (writeError) {
              if (!(writeError instanceof Deno.errors.AlreadyExists)) throw writeError;
              // Noncooperating writers and dangling links still require a winner re-read.
              try {
                if (!await reusablePath(path, true)) {
                  remember(undefined);
                  reselectLostHint();
                  continue;
                }
                existing = await Deno.readTextFile(path);
              } catch (readError) {
                if (!(readError instanceof Deno.errors.NotFound)) throw readError;
                remember(undefined);
                continue;
              }
            }
          }
          if (!await reusablePath(path, true)) {
            remember(undefined);
            reselectLostHint();
            continue;
          }
          if (!inspectOwner(existing).matches) {
            reselectLostHint();
            continue;
          }
          signal?.throwIfAborted();
          const owner = knowledgeOwnerFromContent(path, markdown);
          if (globalIdentity && owner !== undefined) {
            await sourceIndex.record(owner, candidate, basename(path));
          }
          signal?.throwIfAborted();
          const published = await publishKnowledgeOutput({
            path,
            claim: lock,
            content: markdown,
            signal,
            publication: {
              kind: "replace",
              validate: async () => {
                if (!await reusablePath(path, true)) return false;
                const current = await Deno.readTextFile(path);
                return current === existing && inspectOwner(current).matches;
              },
            },
          });
          if (!published) {
            remember(undefined);
            reselectLostHint();
            continue;
          }
          remember(source);
          recordWrite(candidate, source);
          return { slug: candidate, path };
        } finally {
          await releaseKnowledgeTargetOutputClaim(lock);
        }
      }
    },
    {
      localPath,
      hints: () =>
        sourceIndex.read([
          source,
          ...legacyOwners,
          ...(legacyLocalSource === undefined ? [] : [legacyLocalSource]),
        ]),
      owners: !globalIdentity
        ? []
        : identity.sourceKey === undefined
        ? [[...legacyOwners, ...(legacyLocalSource === undefined ? [] : [legacyLocalSource])]]
        : [[source], [
          ...legacyOwners,
          ...(legacyLocalSource === undefined ? [] : [legacyLocalSource]),
        ]],
      readOwner: async (candidate) => {
        signal?.throwIfAborted();
        const path = join(outputDir, knowledgeCandidateFileName(candidate));
        try {
          const stat = await inspectLink(path, { bigint: true });
          if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
          if (stat.nlink !== 1n) {
            if (stat.nlink !== 2n) return undefined;
            const stage = await readProvenKnowledgeOutputStage(
              outputDir,
              knowledgeCandidateFileName(candidate).slice(0, -3),
            );
            return stage === undefined ? undefined : knowledgeOwnerFromContent(path, stage.content);
          }
          return knowledgeOwnerFromContent(path, await Deno.readTextFile(path));
        } catch (error) {
          if (
            error instanceof Deno.errors.NotFound ||
            error instanceof Deno.errors.PermissionDenied ||
            (error instanceof Error && "code" in error &&
              ["ENOENT", "EACCES", "EPERM"].includes(String(error.code)))
          ) return undefined;
          throw error;
        }
      },
    },
    (allocate) =>
      withKnowledgeSourceClaim(outputDir, canonicalSource, signal, async (index) => {
        sourceIndex = index;
        return await allocate();
      }),
  );
}

function validateOkfBundleRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0)
    .join("/");
  if (
    !normalized || normalized.startsWith("/") || normalized.startsWith("../") ||
    normalized === ".." || normalized.split("/").includes("..")
  ) {
    throw new Error(`Invalid OKF bundle path: ${path}`);
  }
  return normalized;
}

function validateOkfDocumentRelativePath(path: string): string {
  const normalized = validateOkfBundleRelativePath(path);
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error(`OKF bundle mode only inspects Markdown documents: ${path}`);
  }
  return normalized;
}

function validateOkfCompanionRelativePath(path: string): string {
  return validateOkfBundleRelativePath(path);
}

export function isOkfTextCompanionPath(path: string): boolean {
  return isTextKnowledgeCompanionPath(path);
}

export function isOkfTextCompanion(path: string, bytes: Uint8Array): boolean {
  if (!isOkfTextCompanionPath(path)) return false;
  if (extname(path)) return true;
  try {
    decodeOkfUtf8(path, bytes);
    return !bytes.includes(0);
  } catch {
    return false;
  }
}

export function validateOkfTextCompanionBytes(path: string, bytes: Uint8Array): void {
  decodeOkfUtf8(path, bytes);
}

function decodeOkfUtf8(relativePath: string, bytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(
      `OKF bundle file is not valid UTF-8 and cannot be uploaded through text knowledge storage: ${relativePath}`,
    );
  }

  const reencoded = new TextEncoder().encode(decoded);
  if (reencoded.byteLength !== bytes.byteLength) {
    throw new Error(
      `OKF bundle file is not stable UTF-8 text and cannot be uploaded through text knowledge storage: ${relativePath}`,
    );
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== reencoded[index]) {
      throw new Error(
        `OKF bundle file is not stable UTF-8 text and cannot be uploaded through text knowledge storage: ${relativePath}`,
      );
    }
  }
  return decoded;
}

function okfDocumentKind(kind: "concept" | "index" | "log"):
  | "okf_concept"
  | "okf_index"
  | "okf_log" {
  if (kind === "index") return "okf_index";
  if (kind === "log") return "okf_log";
  return "okf_concept";
}

function okfDocumentSummary(kind: "concept" | "index" | "log"): string {
  if (kind === "index") return "Preserved OKF reserved index document.";
  if (kind === "log") return "Preserved OKF reserved log document.";
  return "Preserved OKF concept document.";
}

async function preserveOkfCompanion(input: {
  filePath: string;
  outputDir: string;
  relativePath: string;
  signal?: AbortSignal;
  sourceReference?: string;
}): Promise<KnowledgeParserResult> {
  const relativePath = validateOkfCompanionRelativePath(input.relativePath);
  input.signal?.throwIfAborted();
  const bytes = await Deno.readFile(input.filePath);
  input.signal?.throwIfAborted();
  if (isOkfTextCompanion(relativePath, bytes)) validateOkfTextCompanionBytes(relativePath, bytes);
  if (relativePath.toLowerCase().endsWith(".md")) {
    const source = decodeOkfUtf8(relativePath, bytes);
    const inspected = inspectOkfDocument(relativePath, source);
    // A reference does not demote canonical documents. Unknown explicit types
    // remain OKF types. Otherwise the explicit artifact role preserves its bytes,
    // even when its contents resemble malformed YAML frontmatter.
    if (
      inspected.kind !== "concept" || "type" in inspected.metadata ||
      "okf_version" in inspected.metadata
    ) return await preserveOkfDocument(input);
  }
  const outputPath = join(input.outputDir, ...relativePath.split("/"));
  await Deno.mkdir(dirname(outputPath), { recursive: true });
  input.signal?.throwIfAborted();
  await writeExactKnowledgeOutput(input.outputDir, outputPath, bytes, input.signal);
  return {
    success: true,
    source_path: input.filePath,
    source_filename: basename(input.filePath),
    source_type: "okf_companion",
    storage_kind: isOkfTextCompanion(relativePath, bytes) ? undefined : "binary",
    slug: slugifyKnowledgeValue(relativePath.replace(/\.[^.]+$/i, "")),
    sandbox_output_path: outputPath,
    suggested_project_path: `knowledge/${relativePath}`,
    description: "OKF companion asset",
    title: titleizeFilename(relativePath),
    summary: "Preserved referenced OKF companion asset.",
    stats: { bytes: bytes.byteLength },
    warnings: [],
  };
}

async function preserveOkfDocument(input: {
  filePath: string;
  outputDir: string;
  relativePath: string;
  sourceReference?: string;
  signal?: AbortSignal;
}): Promise<KnowledgeParserResult> {
  const relativePath = validateOkfDocumentRelativePath(input.relativePath);
  input.signal?.throwIfAborted();
  const source = decodeOkfUtf8(relativePath, await Deno.readFile(input.filePath));
  input.signal?.throwIfAborted();
  // The BOM stays in the preserved bytes; only envelope inspection ignores it.
  const inspected = inspectOkfDocument(relativePath, source.replace(/^\uFEFF/, ""));
  if (!inspected.envelopeConforms) {
    const details = inspected.diagnostics.map((diagnostic) => diagnostic.message).join(" ");
    throw new Error(`OKF document failed diagnostics for ${relativePath}: ${details}`);
  }
  const outputPath = join(input.outputDir, ...relativePath.split("/"));
  await Deno.mkdir(dirname(outputPath), { recursive: true });
  input.signal?.throwIfAborted();
  await writeExactKnowledgeOutput(input.outputDir, outputPath, source, input.signal);
  const title = typeof inspected.metadata.title === "string" && inspected.metadata.title.trim()
    ? inspected.metadata.title
    : titleizeFilename(relativePath);
  return {
    success: true,
    source_path: input.filePath,
    source_filename: basename(input.filePath),
    source_type: "okf_markdown",
    slug: slugifyKnowledgeValue(relativePath.replace(/\.md$/i, "")),
    sandbox_output_path: outputPath,
    suggested_project_path: `knowledge/${relativePath}`,
    description: inspected.kind === "concept"
      ? "OKF concept document"
      : `OKF ${inspected.kind} document`,
    title,
    summary: okfDocumentSummary(inspected.kind),
    stats: {
      characters: source.length,
      metadata_keys: Object.keys(inspected.metadata).length,
      okf_kind: inspected.kind,
    },
    warnings: [],
    document_kind: okfDocumentKind(inspected.kind),
    okf: {
      path: relativePath,
      envelope_conforms: inspected.envelopeConforms,
      diagnostics: inspected.diagnostics,
      metadata: inspected.metadata,
    },
  };
}

function tableToMarkdown(rows: string[][]): string {
  if (!rows.length) return "";

  const maxColumns = Math.max(...rows.map((row) => row.length));
  if (maxColumns === 0) return "";

  const normalized = rows.map((row) =>
    Array.from(
      { length: maxColumns },
      (_, index) => (row[index] ?? "").replaceAll("|", String.raw`\|`).replaceAll("\n", " ").trim(),
    )
  );
  const [header = [], ...body] = normalized;
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: maxColumns }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

async function parseCsvLike(path: string, delimiter: "," | "\t"): Promise<ParserOutput> {
  const raw = await Deno.readTextFile(path);
  const lines = raw.split("\n").filter((line) => line.trim());
  if (!lines.length) {
    return { content: "_Empty file._", stats: { rows: 0, columns: 0 }, warnings: [] };
  }

  const parseLine = delimiter === ","
    ? parseCsvLine
    : (line: string) => line.split("\t").map((value) => value.trim());
  const header = parseLine(lines[0] ?? "");
  const data = lines.slice(1).map(parseLine);
  const limitedRows = [header, ...data.slice(0, 200)];
  const warnings = data.length > 200
    ? [`Truncated ${data.length - 200} rows from markdown output`]
    : [];

  const parts = [
    `**Rows:** ${data.length} | **Columns:** ${header.length}`,
    "",
    tableToMarkdown(limitedRows),
  ];
  if (data.length > 200) {
    parts.push(`\n_...and ${data.length - 200} more rows (truncated)._`);
  }

  return {
    content: parts.join("\n").trim(),
    stats: { rows: data.length, columns: header.length },
    warnings,
  };
}

async function parseText(path: string): Promise<ParserOutput> {
  const content = cleanText(await Deno.readTextFile(path), /\.mdx?$/i.test(path));
  return {
    content,
    stats: { characters: content.length, lines: content ? content.split("\n").length : 0 },
    warnings: [],
  };
}

async function parseJson(path: string): Promise<ParserOutput> {
  const raw = await Deno.readTextFile(path);
  const data = JSON.parse(raw) as unknown;

  if (
    Array.isArray(data) && data.length > 0 && data[0] != null && typeof data[0] === "object" &&
    !Array.isArray(data[0])
  ) {
    const first = data[0] as Record<string, unknown>;
    const headers = Object.keys(first);
    const rows = data.slice(0, 200).map((entry) => {
      const record = entry != null && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      return headers.map((header) => String(record[header] ?? ""));
    });
    const warnings = data.length > 200
      ? [`Truncated ${data.length - 200} records from markdown output`]
      : [];
    const parts = [
      `**Records:** ${data.length} | **Fields:** ${headers.length}`,
      "",
      tableToMarkdown([headers, ...rows]),
    ];
    if (data.length > 200) {
      parts.push(`\n_...and ${data.length - 200} more records (truncated)._`);
    }
    return {
      content: parts.join("\n").trim(),
      stats: { records: data.length, fields: headers.length },
      warnings,
    };
  }

  const rendered = JSON.stringify(data, null, 2);
  return {
    content: `${CODE_FENCE}json\n${rendered}\n${CODE_FENCE}`,
    stats: { top_level_type: Array.isArray(data) ? "list" : typeof data },
    warnings: [],
  };
}

async function parseWithKreuzberg(
  path: string,
  deps: ResolvedRunKnowledgeParsersDeps,
): Promise<ParserOutput> {
  const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "application/octet-stream";
  const content = cleanText(
    await deps.extractDocumentText({
      filePath: path,
      mimeType,
      onProgress: deps.onProgress,
      signal: deps.signal,
    }),
    true,
  );
  return {
    content: content || "_No extractable text found in document._",
    stats: {
      characters: content.length,
      lines: content ? content.split("\n").length : 0,
      engine: "kreuzberg",
    },
    warnings: [],
  };
}

function selectParserDefinition(path: string): ParserDefinition {
  const extension = extname(path).toLowerCase();
  const name = basename(path).toLowerCase();

  if (extension === ".csv" || extension === ".tsv") {
    const delimiter = extension === ".tsv" ? "\t" : ",";
    return {
      sourceType: extension.slice(1),
      parse: (filePath) => parseCsvLike(filePath, delimiter),
    };
  }

  if (extension === ".txt" || extension === ".md" || extension === ".mdx") {
    return { sourceType: extension.slice(1), parse: parseText };
  }

  if (extension === ".json") {
    return { sourceType: "json", parse: parseJson };
  }

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return { sourceType: extension.slice(1), parse: parseText };
  }

  if (!extension && TEXT_FILE_NAMES.has(name)) {
    return { sourceType: "text", parse: parseText };
  }

  if (extension in MIME_BY_EXTENSION) {
    return {
      sourceType: extension.slice(1),
      parse: (filePath, deps) => parseWithKreuzberg(filePath, deps),
    };
  }

  throw new Error(`Unsupported file type: ${extension || name}`);
}

function buildSummary(sourceType: string, stats: Record<string, unknown>): string {
  if (stats.engine === "kreuzberg") {
    return `Extracted ${sourceType.toUpperCase()} text with Kreuzberg (${
      stats.characters ?? 0
    } chars).`;
  }
  if (sourceType === "csv" || sourceType === "tsv") {
    return `Parsed ${stats.rows ?? 0} rows across ${stats.columns ?? 0} columns.`;
  }
  if (sourceType === "json") {
    if ("records" in stats) {
      return `Parsed ${stats.records ?? 0} record(s) across ${stats.fields ?? 0} fields.`;
    }
    return `Converted JSON (${stats.top_level_type ?? "object"}) to markdown.`;
  }
  return `Converted document to markdown (${stats.characters ?? 0} chars).`;
}

async function defaultExtractDocumentText(
  input: {
    filePath: string;
    mimeType: string;
    onProgress?: DocumentExtractionProgress;
    signal?: AbortSignal;
  },
): Promise<string> {
  input.signal?.throwIfAborted();
  const bytes = await Deno.readFile(input.filePath);
  input.signal?.throwIfAborted();
  const { KreuzbergDocumentExtractor } = await importFirstPartyExtensionModule<
    DocumentKreuzbergExtensionModule
  >(
    "ext-document-kreuzberg",
    "@veryfront/ext-document-kreuzberg",
  );
  input.signal?.throwIfAborted();
  const extractor = new KreuzbergDocumentExtractor();
  return await extractor.extractInWorker(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    input.mimeType,
    { onProgress: input.onProgress, signal: input.signal },
  );
}

export async function runKnowledgeParser(
  input: KnowledgeParserInput & { outputDir: string },
  deps: RunKnowledgeParsersDeps = {},
): Promise<KnowledgeParserResult> {
  const { outputDir, ...file } = input;
  const [result] = await runKnowledgeParsers({ files: [file], outputDir }, deps);

  if (!result) {
    throw new Error("knowledge ingest parser returned no results");
  }

  return result;
}

export async function runKnowledgeParsers(input: {
  files: KnowledgeParserInput[];
  outputDir: string;
}, deps: RunKnowledgeParsersDeps = {}): Promise<KnowledgeParserResult[]> {
  deps.signal?.throwIfAborted();
  if (!input.files.length) {
    return [];
  }

  const parserDeps: ResolvedRunKnowledgeParsersDeps = {
    extractDocumentText: deps.extractDocumentText ?? defaultExtractDocumentText,
    onProgress: deps.onProgress,
    signal: deps.signal,
  };

  deps.signal?.throwIfAborted();
  await Deno.mkdir(input.outputDir, { recursive: true });
  const allocationSession = deps.allocationSession ?? new KnowledgeAllocationSession();
  const results: KnowledgeParserResult[] = [];

  function preserveOkfFile(file: KnowledgeParserInput): Promise<KnowledgeParserResult> {
    return file.okfRelativePath!.toLowerCase().endsWith(".md") && file.okfRole !== "companion"
      ? preserveOkfDocument({
        filePath: file.filePath,
        outputDir: input.outputDir,
        relativePath: file.okfRelativePath!,
        signal: deps.signal,
        sourceReference: file.sourceReference,
      })
      : preserveOkfCompanion({
        filePath: file.filePath,
        outputDir: input.outputDir,
        relativePath: file.okfRelativePath!,
        signal: deps.signal,
        sourceReference: file.sourceReference,
      });
  }
  function throwParserFailure(error: unknown): never {
    deps.signal?.throwIfAborted();
    if (error instanceof Error && error.message.startsWith("knowledge ingest parser failed")) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`knowledge ingest parser failed: ${message}`);
  }
  for (const file of input.files) {
    try {
      deps.signal?.throwIfAborted();
      const stat = await Deno.stat(file.filePath);
      if (!stat.isFile) {
        throw new Error(`File not found: ${file.filePath}`);
      }

      deps.signal?.throwIfAborted();
      if (file.okfRelativePath !== undefined) {
        const preserve = allocationSession.directWrite(
          input.outputDir,
          () => preserveOkfFile(file),
        );
        results.push(await preserve);
        continue;
      }

      const definition = selectParserDefinition(file.filePath);
      const parsed = await definition.parse(file.filePath, parserDeps);
      deps.signal?.throwIfAborted();
      const content = cleanText(
        parsed.content,
        definition.sourceType === "md" || definition.sourceType === "mdx" ||
          parsed.stats.engine === "kreuzberg",
      );
      const fileName = file.sourceName ?? basename(file.filePath);
      const extension = extname(fileName);
      const stem = (extension ? fileName.slice(0, -extension.length) : fileName).trim() ||
        fileName;
      const description = file.description ?? `Parsed from ${fileName}`;
      // Only Markdown output has headings; in code and plain text `#` starts a comment.
      const isMarkdown = definition.sourceType === "md" || definition.sourceType === "mdx" ||
        parsed.stats.engine === "kreuzberg";
      const heading = isMarkdown
        ? findFirstH1(content, definition.sourceType === "mdx")
        : undefined;
      const title = heading || stem;
      const sourceReference = file.sourceReference ?? (file.resource === undefined &&
          file.sourceKey === undefined && file.sourceKind !== "upload"
        ? normalize(file.filePath)
        : fileName);
      const resource = file.resource ?? sourceReference;
      const localReference = file.sourceReference ?? resource;
      const localPath = file.sourceKind !== "upload" &&
          normalize(resource) === normalize(file.filePath) &&
          normalize(localReference) === normalize(file.filePath)
        ? normalizeProvableLegacyLocalKnowledgePath(localReference, true)
        : undefined;
      const markdown = [
        buildFrontmatter({
          title,
          description,
          resource,
          sourceKey: file.sourceKey,
          tags: (file.sourceKind === undefined
              ? sourceReference.startsWith("uploads/")
              : file.sourceKind === "upload")
            ? ["upload", definition.sourceType]
            : [definition.sourceType],
          source: fileName,
          sourceType: definition.sourceType,
        }),
        "",
        ...(heading !== undefined ? [] : [`# ${title}`, ""]),
        content,
        "",
      ].join("\n");

      deps.signal?.throwIfAborted();
      const preferredSlug = file.slug ?? slugifyTitle(title);
      let slug: string;
      let outputPath: string;
      if (file.slug) {
        slug = file.slug;
        outputPath = join(input.outputDir, `${slug}.md`);
        await allocationSession.directWrite(
          input.outputDir,
          () => writeExactKnowledgeOutput(input.outputDir, outputPath, markdown, deps.signal),
        );
      } else {
        ({ slug, path: outputPath } = await writeKnowledgeFile(
          input.outputDir,
          preferredSlug,
          { resource, sourceKey: file.sourceKey, localPath, inputPath: file.filePath },
          markdown,
          deps.signal,
          allocationSession,
        ));
      }
      results.push({
        success: true,
        source_path: file.filePath,
        source_filename: basename(file.filePath),
        source_type: definition.sourceType,
        slug,
        preferred_slug: preferredSlug,
        sandbox_output_path: outputPath,
        suggested_project_path: `knowledge/${
          relative(input.outputDir, outputPath).replaceAll("\\", "/")
        }`,
        description,
        title,
        summary: buildSummary(definition.sourceType, parsed.stats),
        stats: parsed.stats,
        warnings: parsed.warnings,
        document_kind: "generated",
      });
    } catch (error) {
      throwParserFailure(error);
    }
  }

  return results;
}
