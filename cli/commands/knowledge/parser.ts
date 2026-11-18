import { basename, dirname, extname, join } from "veryfront/platform/path";
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
  readKnowledgeIngestSourceKey,
} from "./command-helpers.ts";
import { isTextKnowledgeCompanionPath } from "./source-policy.ts";

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

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function markdownFenceStart(line: string): string | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match || match[1]?.startsWith("`") && match[2]?.includes("`")) return undefined;
  return match[1];
}

function startsInterruptingBlock(line: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-+*][ \t]+\S|1[.)][ \t]+\S)/.test(line) ||
    isThematicBreak(line) || markdownFenceStart(line) !== undefined ||
    markdownHtmlBlockEnd(line, false) !== undefined;
}

function expandHeadingIndentation(raw: string): string {
  return raw.replace(/^(?:[ \t]*>|[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))*[ \t]*/, (prefix) => {
    let width = 0;
    let expanded = "";
    for (const character of prefix) {
      const count = character === "\t" ? 4 - width % 4 : 1;
      expanded += character === "\t" ? " ".repeat(count) : character;
      width += count;
    }
    return expanded;
  });
}

/** Track only positively identified list containers; ordinary indentation is not a container. */
function headingContainerLine(
  raw: string,
  indents: number[],
  insideBlock: boolean,
  paragraphOpen: boolean,
): { line: string; startsItem: boolean; lazy: boolean; emptyItem: boolean } {
  const line = expandHeadingIndentation(raw);
  const indentation = /^ */.exec(line)?.[0].length ?? 0;
  if (
    indents.length && indentation < (indents.at(-1) ?? 0) &&
    /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(
      line.slice(Math.min(indents.at(-2) ?? 0, indentation)),
    )
  ) paragraphOpen = false;
  const lazy = indentation < (indents.at(-1) ?? 0) && paragraphOpen && !insideBlock &&
    Boolean(line.trim()) &&
    !startsInterruptingBlock(line.slice(Math.min(indents.at(-2) ?? 0, indentation)));
  if (line.trim() && !lazy) {
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
        !content.slice(marker[0].length).trim())
    ) break;
    const spacing = marker[1] ?? "";
    emptyItem = !content.slice(marker[0].length).trim();
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
function interruptsDefinition(line: string): boolean {
  return startsInterruptingBlock(line) || /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
}

function headingDefinitionLines(
  lines: string[],
  start: number,
  containerIndent = 0,
  firstLine?: string,
  parentIndent = 0,
  continuedParagraph = false,
): number {
  const readLine = (index: number): string => {
    const line = expandHeadingIndentation(lines[index] ?? "");
    const indentation = /^ */.exec(line)?.[0].length ?? 0;
    return line.slice(Math.min(indentation, containerIndent));
  };
  // An outdented sibling starts in the last matched container, not in the
  // unmatched item's paragraph. Do not consume its marker as a destination.
  const leavesContainer = (index: number): boolean => {
    const line = expandHeadingIndentation(lines[index] ?? "");
    const indentation = /^ */.exec(line)?.[0].length ?? 0;
    return indentation < containerIndent &&
      /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(
        line.slice(Math.min(parentIndent, indentation)),
      );
  };
  let offset = start;
  let first = firstLine ?? readLine(offset);
  if (!continuedParagraph && /^ {4}/.test(first)) return 0;
  let label = /^[ \t]*\[(?:\\.|[^\]\\]){1,999}\]:[ \t]*/.exec(first);
  while (!label && /^[ \t]*\[/.test(first) && !first.includes("]") && first.length <= 1002) {
    offset += 1;
    const next = readLine(offset);
    if (leavesContainer(offset) || !next.trim() || interruptsDefinition(next)) return 0;
    first += "\n" + next;
    label = /^[ \t]*\[(?:\\.|[^\]\\]){1,999}\]:[ \t]*/.exec(first);
  }
  if (!label || !/\S/.test(label[0].slice(label[0].indexOf("[") + 1, label[0].lastIndexOf("]")))) {
    return 0;
  }
  let rest = first.slice(label[0].length);
  if (!rest) {
    offset += 1;
    const continuation = readLine(offset);
    if (leavesContainer(offset) || interruptsDefinition(continuation)) return 0;
    rest = continuation.trimStart();
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
    while (cursor < rest.length && !/\s/.test(rest[cursor] ?? "")) {
      const character = rest[cursor];
      if (character === "\\") cursor += 1;
      else if (character === "(") depth += 1;
      else if (character === ")" && --depth < 0) return 0;
      cursor += 1;
    }
    if (!cursor || depth !== 0) return 0;
  }
  const destinationEnd = offset;
  const remainder = rest.slice(cursor);
  if (remainder && !/^[ \t]/.test(remainder)) return 0;
  rest = remainder.trimStart();
  if (!rest) {
    const next = readLine(offset + 1);
    if (leavesContainer(offset + 1) || !/^[ \t]*["'(]/.test(next)) {
      return destinationEnd - start + 1;
    }
    offset += 1;
    rest = next.trimStart();
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
        return rest.slice(cursor + 1).trim() ? titleFallback : offset - start + 1;
      } else if (opening === "(" && character === "(") return 0;
      cursor += 1;
    }
    offset += 1;
    rest = readLine(offset);
    if (leavesContainer(offset) || !rest.trim() || interruptsDefinition(rest)) return titleFallback;
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
    if (identifier) {
      const afterAsi = statementScopes.has(closers.length) &&
        /[\r\n]/.test(source.slice(previousEnd, cursor)) &&
        (!mdxCanStartExpression(previous) || previous === "return" || previous === "yield");
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
        const statementBlock =
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

/** The first top-level H1 outside code, HTML blocks, and leading YAML frontmatter. */
function findFirstH1(markdown: string, mdx = false): string | undefined {
  let fence: string | undefined;
  let htmlEnd: RegExp | "blank" | undefined;
  let blockQuoteDepth = 0;
  let quotedListIndent = 0;
  let blockIndent = 0;
  let paragraphOpen = false;
  let rootParagraph: string[] = [];
  let indentedCode = false;
  let emptyItem = false;
  let setextEligible = false;
  let quoteParagraph = false;
  let quoteParagraphDepth = 0;
  let definitionThrough = -1;
  let referenceParagraph = false;
  let mdxThrough = -1;
  let sourceOffset = 0;
  const indents: number[] = [];
  const body = markdown.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "");
  const lines = body.split("\n");
  for (const [lineIndex, sourceLine] of lines.entries()) {
    const lineOffset = sourceOffset;
    sourceOffset += sourceLine.length + 1;
    const raw = expandHeadingIndentation(sourceLine);
    if (!paragraphOpen) rootParagraph = [];
    if (mdx && lineOffset < mdxThrough) continue;
    if (!raw.trim() && emptyItem) {
      indents.pop();
      emptyItem = false;
    }
    if (lineIndex <= definitionThrough) continue;
    if (!raw.trim()) quoteParagraph = false;
    if (
      quoteParagraph && !/^ {0,3}>/.test(raw) &&
      (startsInterruptingBlock(raw) || /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(raw))
    ) {
      quoteParagraph = false;
      paragraphOpen = false;
    }
    let container = headingContainerLine(
      raw,
      indents,
      Boolean(fence || htmlEnd),
      paragraphOpen,
    );
    if (mdx && !fence && !htmlEnd) {
      const start = lineOffset + (sourceLine.match(/^[ \t]*/)?.[0].length ?? 0);
      const value = body.slice(start);
      if (!paragraphOpen && /^(?:export|import) /.test(sourceLine)) {
        mdxThrough = mdxExpressionEnd(body, start, true);
        paragraphOpen = false;
        continue;
      }
      if (
        value.startsWith("{") ||
        /^<\/?(?:[\p{ID_Start}_$][\p{ID_Continue}$.:_-]*|>)/u.test(value)
      ) {
        const region = mdxLineRegion(body, start);
        mdxThrough = region.end;
        if (region.kind === "flow") {
          paragraphOpen = false;
          quoteParagraph = false;
          quoteParagraphDepth = 0;
        } else {
          const ending = body.indexOf("\n", region.end);
          mdxThrough = ending < 0 ? body.length : ending;
          const content = body.slice(lineOffset, mdxThrough).replace(/\s*\n\s*/g, " ").trim();
          if (!paragraphOpen) rootParagraph = [];
          paragraphOpen = true;
          setextEligible = true;
          referenceParagraph = false;
          if (!quoteParagraph && !indents.length) rootParagraph.push(content);
          else rootParagraph = [];
        }
        continue;
      }
    }
    let line = container.line;
    if (container.startsItem) {
      paragraphOpen = false;
      emptyItem = container.emptyItem;
    } else if (raw.trim()) emptyItem = false;
    let containerIndent = indents.at(-1) ?? 0;
    let quotedLine = line;
    let continuedQuoteDepth = 0;
    while (continuedQuoteDepth < blockQuoteDepth && /^ {0,3}>/.test(quotedLine)) {
      quotedLine = quotedLine.replace(/^ {0,3}>[ \t]?/, "");
      continuedQuoteDepth += 1;
    }
    const quoteIndent = /^ */.exec(quotedLine)?.[0].length ?? 0;
    const continuedQuote = blockQuoteDepth > 0 && continuedQuoteDepth === blockQuoteDepth &&
      (!quotedLine.trim() || quoteIndent >= quotedListIndent);
    if (continuedQuote) line = quotedLine.slice(Math.min(quoteIndent, quotedListIndent));
    if (
      (htmlEnd || fence) && !continuedQuote &&
      (blockQuoteDepth > 0 || raw.trim() && containerIndent < blockIndent)
    ) {
      htmlEnd = undefined;
      fence = undefined;
      blockQuoteDepth = 0;
      paragraphOpen = false;
      container = headingContainerLine(raw, indents, false, false);
      line = container.line;
      containerIndent = indents.at(-1) ?? 0;
      emptyItem = container.emptyItem;
    }
    if (htmlEnd) {
      if (htmlEnd === "blank" ? !line.trim() : htmlEnd.test(line)) {
        htmlEnd = undefined;
        blockQuoteDepth = 0;
        paragraphOpen = false;
      }
      continue;
    }
    if (fence) {
      if (mdx) line = line.trimStart();
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) {
        fence = undefined;
        blockQuoteDepth = 0;
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
        referenceParagraph,
      );
      if (definitionLength) {
        definitionThrough = lineIndex + definitionLength - 1;
        // Definitions belong to their paragraph for interruption rules, but
        // contribute no visible text eligible for a Setext heading.
        referenceParagraph = true;
        paragraphOpen = true;
        setextEligible = false;
        continue;
      }
    }
    referenceParagraph = false;
    const quote = /^ {0,3}>[ \t]?(.*)$/.exec(line);
    if (quote) {
      rootParagraph = [];
      let content = quote[1] ?? "";
      let quoteDepth = 1;
      while (/^ {0,3}>/.test(content)) {
        content = content.replace(/^ {0,3}>[ \t]?/, "");
        quoteDepth += 1;
      }
      const quoteLists: number[] = [];
      let continuesParagraph: boolean = quoteParagraph && quoteDepth <= quoteParagraphDepth;
      const quotedContainer = headingContainerLine(content, quoteLists, false, continuesParagraph);
      content = quotedContainer.line;
      let startsQuotedItem = quotedContainer.startsItem;
      if (startsQuotedItem) continuesParagraph = false;
      // Quotes and lists can alternate; laziness belongs to the innermost paragraph.
      while (/^ {0,3}>/.test(content)) {
        content = content.replace(/^ {0,3}>[ \t]?/, "");
        quoteDepth += 1;
        continuesParagraph = quoteParagraph && quoteDepth <= quoteParagraphDepth &&
          !startsQuotedItem;
        const nestedContainer = headingContainerLine(content, [], false, continuesParagraph);
        content = nestedContainer.line;
        startsQuotedItem ||= nestedContainer.startsItem;
        if (startsQuotedItem) continuesParagraph = false;
      }
      const quoteFence = markdownFenceStart(content);
      const quoteHtml = mdx ? undefined : markdownHtmlBlockEnd(content, !quoteParagraph);
      if (quoteFence) {
        fence = quoteFence;
        blockQuoteDepth = quoteDepth;
        quotedListIndent = quoteLists.at(-1) ?? 0;
        paragraphOpen = false;
        quoteParagraph = false;
        continue;
      }
      if (quoteHtml) {
        if (quoteHtml === "blank" || !quoteHtml.test(content)) htmlEnd = quoteHtml;
        blockQuoteDepth = htmlEnd ? quoteDepth : 0;
        quotedListIndent = quoteLists.at(-1) ?? 0;
        paragraphOpen = false;
        quoteParagraph = false;
        continue;
      }
      indentedCode = false;
      quoteParagraph = Boolean(content.trim()) &&
        (mdx || continuesParagraph || !/^ {4}/.test(content)) && !startsInterruptingBlock(content);
      quoteParagraphDepth = quoteParagraph
        ? continuesParagraph ? Math.max(quoteParagraphDepth, quoteDepth) : quoteDepth
        : 0;
      paragraphOpen = quoteParagraph;
      setextEligible = false;
      continue;
    }
    // A lazy line can retain an ancestor container, but missing indentation must not
    // be stripped as if that ancestor actually continued (notably nested list HTML).
    const blockEnd = mdx ? undefined : markdownHtmlBlockEnd(
      container.lazy
        ? raw.slice(
          (/^ */.exec(raw)?.[0].length ?? 0) >= (indents.at(-2) ?? 0) ? indents.at(-2) ?? 0 : 0,
        )
        : line,
      !paragraphOpen,
    );
    if (blockEnd) {
      indentedCode = false;
      blockIndent = quoteParagraph && markdownHtmlBlockEnd(line, false) === undefined
        ? containerIndent + 1
        : containerIndent;
      quoteParagraph = false;
      if (blockEnd === "blank" || !blockEnd.test(line)) htmlEnd = blockEnd;
      paragraphOpen = false;
      continue;
    }
    const fenceLine = mdx ? line.trimStart() : line;
    const opening = markdownFenceStart(fenceLine);
    if (!container.lazy && opening) {
      fence = opening;
      quoteParagraph = false;
      indentedCode = false;
      blockIndent = containerIndent;
      paragraphOpen = false;
      continue;
    }
    if (raw.trim()) {
      indentedCode = !mdx && !paragraphOpen && /^ {4}/.test(line);
    }
    const headingLine = mdx ? line.trimStart() : line;
    const atx = /^ {0,3}#(?:[ \t]+(.*))?$/.exec(mdx ? raw.trimStart() : raw);
    if (atx && containerIndent === 0) {
      const content = atx[1] ?? "";
      return /^#+[ \t]*$/.test(content) ? "" : content.replace(/[ \t]+#+[ \t]*$/, "").trim();
    }
    const paragraphLine = container.lazy ? raw : line;
    if (
      paragraphOpen && setextEligible && !container.lazy && containerIndent === 0 &&
      !quoteParagraph && rootParagraph.length && /^ {0,3}=+[ \t]*$/.test(headingLine)
    ) return rootParagraph.join(" ");
    paragraphOpen = !indentedCode && Boolean(line.trim()) &&
      !(paragraphOpen && setextEligible && !container.lazy && !quoteParagraph &&
        /^ {0,3}(?:=+|-+)[ \t]*$/.test(headingLine)) &&
      !/^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)/.test(
        paragraphLine,
      );
    setextEligible = paragraphOpen && !/^ {0,3}>/.test(raw);
    if (paragraphOpen && !quoteParagraph && containerIndent === 0) {
      rootParagraph.push(paragraphLine.trim());
    } else rootParagraph = [];
  }
  return undefined;
}

const MAX_TITLE_SLUG_LENGTH = 80;

/** A short slug from a title, without a leading list number such as "20. ". */
function slugifyTitle(title: string): string {
  const slug = slugifyKnowledgeValue(title.replace(/^\d+[.)]\s+/, ""))
    .slice(0, MAX_TITLE_SLUG_LENGTH).replace(/-+$/, "") || "document";
  return escapeReservedKnowledgeSlug(slug);
}

/**
 * Write `<slug>.md`, adding `-2`, `-3` when that name holds another source's document.
 * A file that already holds the same generated source is rewritten under its name.
 */
async function writeKnowledgeFile(
  outputDir: string,
  slug: string,
  identity: { resource: string; sourceKey?: string },
  markdown: string,
  signal?: AbortSignal,
): Promise<{ slug: string; path: string }> {
  for (let attempt = 1;; attempt += 1) {
    const candidate = attempt === 1 ? slug : `${slug}-${attempt}`;
    const path = join(outputDir, `${candidate}.md`);
    let existing: string;
    try {
      existing = await Deno.readTextFile(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      try {
        await Deno.writeTextFile(path, markdown, { createNew: true, signal });
        return { slug: candidate, path };
      } catch (writeError) {
        if (!(writeError instanceof Deno.errors.AlreadyExists)) throw writeError;
        // Re-read the winner once; a dangling link or deleted winner cannot be reused.
        try {
          existing = await Deno.readTextFile(path);
        } catch (readError) {
          if (!(readError instanceof Deno.errors.NotFound)) throw readError;
          continue;
        }
      }
    }
    const metadata = inspectOkfDocument(path, existing).metadata;
    const storedKey = readKnowledgeIngestSourceKey(metadata);
    const sameSource = storedKey !== undefined || identity.sourceKey !== undefined
      ? storedKey === identity.sourceKey
      : metadata.resource === identity.resource;
    if (sameSource) {
      await Deno.writeTextFile(path, markdown, { signal });
      return { slug: candidate, path };
    }
  }
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
  await Deno.writeFile(outputPath, bytes, { signal: input.signal });
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
  await Deno.writeTextFile(outputPath, source, { signal: input.signal });
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
        const preserve = preserveOkfFile(file);
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
      const sourceReference = file.sourceReference ?? fileName;
      const resource = file.resource ?? sourceReference;
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
        await Deno.writeTextFile(outputPath, markdown, { signal: deps.signal });
      } else {
        ({ slug, path: outputPath } = await writeKnowledgeFile(
          input.outputDir,
          preferredSlug,
          { resource, sourceKey: file.sourceKey },
          markdown,
          deps.signal,
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
        suggested_project_path: `knowledge/${slug}.md`,
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
