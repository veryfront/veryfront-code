#!/usr/bin/env -S deno run --allow-read
import { decodeNamedCharacterReference } from "decode-named-character-reference";

/**
 * Public docs quality validator.
 *
 * Checks published docs and the public README for style and boundary issues
 * that are easy to regress during generation or sync.
 */

const ROOT = Deno.cwd();

interface PublicDocIssue {
  path: string;
  line: number;
  message: string;
  text: string;
}

interface Rule {
  pattern: RegExp;
  message: string;
}

/**
 * The directories veryfront-docs copies into its published `docs/code/` tree.
 * Its sync workflow copies exactly these four and nothing else, so a relative
 * link out of one of them resolves inside this repository but 404s on the
 * published site. `docs/architecture/` is private implementation notes, which
 * makes that particular leak a boundary violation as well as a broken link.
 */
const SYNCED_DOC_DIRS = [
  "docs/getting-started",
  "docs/guides",
  "docs/concepts",
  "docs/api-reference",
];

const PUBLIC_DOC_ROOTS = ["README.md", ...SYNCED_DOC_DIRS];

/**
 * The sync deletes the `README.md` at the root of each synced directory, so
 * those files never reach the published site and may keep pointing readers of
 * this repository at private notes.
 */
const UNSYNCED_README_PATHS = SYNCED_DOC_DIRS.map((dir) => `${dir}/README.md`);

/**
 * A raw anchor is a working link and has to clear the same boundary. Quoted
 * attributes and JSX expressions can appear in either document syntax;
 * CommonMark also permits unquoted values, which the scan accepts only in
 * Markdown mode. A genuinely dynamic JSX attribute has no literal to check.
 */
const HTML_DESTINATION_ATTRIBUTE_SOURCE =
  /(?:^|\s)(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{))/;
const MARKDOWN_UNQUOTED_DESTINATION_ATTRIBUTE_SOURCE =
  /(?:^|[ \t\r\n])(?:href|src)(?:[ \t]*=[ \t]*|[ \t]*(?:\r\n|\r|\n)[ \t]*=[ \t]*|[ \t]*=[ \t]*(?:\r\n|\r|\n)[ \t]*)((?!\{)[^\s"'`=<>]+)(?=[ \t\r\n>])/;
const RAW_HTML_BLOCK_TAG_SOURCE =
  /^<(pre|script|style|textarea)(?=[\t\n\f\r />]|$)/i;
const RAW_HTML_BLOCK_END_SOURCE = /<\/(?:pre|script|style|textarea)>/i;
const PROCESSING_INSTRUCTION_HTML_BLOCK_SOURCE = /^<\?/;
const PROCESSING_INSTRUCTION_HTML_BLOCK_END_SOURCE = /\?>/;
const DECLARATION_HTML_BLOCK_SOURCE = /^<![A-Za-z]/;
const DECLARATION_HTML_BLOCK_END_SOURCE = />/;
const CDATA_HTML_BLOCK_SOURCE = /^<!\[CDATA\[/;
const CDATA_HTML_BLOCK_END_SOURCE = /\]\]>/;
const BLANK_LINE_TERMINATED_HTML_BLOCK_TAG_SOURCE =
  /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\t\n\f\r />]|$)/i;
const HTML_BLOCK_TAG_NAME_SOURCE = "[A-Za-z][A-Za-z0-9-]*";
const HTML_BLOCK_ATTRIBUTE_NAME_SOURCE = "[A-Za-z_:][A-Za-z0-9_.:-]*";
const HTML_BLOCK_ATTRIBUTE_VALUE_SOURCE =
  "(?:[^\\s\"'=<>`]+|'[^']*'|\"[^\"]*\")";
const COMMONMARK_HTML_TAG_SOURCE = new RegExp(
  `^<(?:${HTML_BLOCK_TAG_NAME_SOURCE}(?:[\\t\\n\\f\\r ]+${HTML_BLOCK_ATTRIBUTE_NAME_SOURCE}(?:[\\t\\n\\f\\r ]*=[\\t\\n\\f\\r ]*${HTML_BLOCK_ATTRIBUTE_VALUE_SOURCE})?)*[\\t\\n\\f\\r ]*\\/?|\\/${HTML_BLOCK_TAG_NAME_SOURCE}[\\t\\n\\f\\r ]*)>`,
);
const COMPLETE_HTML_BLOCK_TAG_LINE_SOURCE = new RegExp(
  `^<(?:${HTML_BLOCK_TAG_NAME_SOURCE}(?:[ \\t]+${HTML_BLOCK_ATTRIBUTE_NAME_SOURCE}(?:[ \\t]*=[ \\t]*${HTML_BLOCK_ATTRIBUTE_VALUE_SOURCE})?)*[ \\t]*\\/?|\\/${HTML_BLOCK_TAG_NAME_SOURCE}[ \\t]*)>[ \\t\\r]*$`,
);
const URI_AUTOLINK_SOURCE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g;
const BARE_AUTOLINK_SOURCE = /https?:\/\/[^\s<>"']+/gi;
const MAX_MARKDOWN_DESTINATION_PARENTHESIS_DEPTH = 32;
type DestinationSyntax =
  | "markdown"
  | "autolink"
  | "html-attribute"
  | "javascript-string";
type DocumentSyntax = "markdown" | "mdx";
/** Any origin works: only the resolved path is read back out. */
const RESOLUTION_ORIGIN = "https://docs.invalid";
const VERYFRONT_DOCS_HOSTNAME = "veryfront.com";
const VERYFRONT_CODE_DOCS_PREFIX = "/docs/code/";
const VERYFRONT_SITE_CODE_PREFIX = "/code/";
const JAVASCRIPT_SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

function isPublishedPage(target: string): boolean {
  // The sync deletes the section README before publishing, so a link to one
  // 404s exactly like a link out of the tree.
  if (
    UNSYNCED_README_PATHS.includes(target) ||
    UNSYNCED_README_PATHS.some((path) => target === path.slice(0, -3))
  ) return false;
  return SYNCED_DOC_DIRS.some((dir) =>
    target === dir || target.startsWith(`${dir}/`)
  );
}

export function publishedTargetCandidates(target: string): string[] {
  if (!isPublishedPage(target)) return [];
  const directoryRoute = target.endsWith("/");
  const path = target.replace(/\/$/, "");
  return [
    ...(directoryRoute ? [] : [path, `${path}.md`, `${path}.mdx`]),
    `${path}/index.md`,
    `${path}/index.mdx`,
  ];
}

export function publishedTargetExists(
  target: string,
  stat: (path: string) => { readonly isFile: boolean } = Deno.statSync,
): boolean {
  for (const candidate of publishedTargetCandidates(target)) {
    try {
      const entry = stat(`${ROOT}/${candidate}`);
      if (entry.isFile) return true;
    } catch {
      // Try the next published-route spelling.
    }
  }
  return false;
}

function decodeMarkdownCharacterReferences(href: string): string {
  return href.replace(
    /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]+));/g,
    (reference, decimal: string, hexadecimal: string, named: string) => {
      if (named !== undefined) {
        const decoded = decodeNamedCharacterReference(named);
        return decoded === false ? reference : decoded;
      }
      const codePoint = Number.parseInt(
        decimal ?? hexadecimal,
        decimal ? 10 : 16,
      );
      if (
        !Number.isInteger(codePoint) || codePoint <= 0 ||
        codePoint > 0x10ffff ||
        codePoint >= 0xd800 && codePoint <= 0xdfff
      ) return "\uFFFD";
      return String.fromCodePoint(codePoint);
    },
  );
}

function decodeMarkdownBackslashEscapes(href: string): string {
  return href.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
}

function decodeJavaScriptStringLiteral(value: string): string | undefined {
  let decoded = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined) return undefined;
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (value[index + 1] === "\n") index++;
      continue;
    }
    if (escaped === "x") {
      const hexadecimal = value.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hexadecimal)) return undefined;
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 2;
      continue;
    }
    if (escaped === "u") {
      if (value[index + 1] === "{") {
        const end = value.indexOf("}", index + 2);
        const hexadecimal = end === -1 ? "" : value.slice(index + 2, end);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hexadecimal)) return undefined;
        const codePoint = Number.parseInt(hexadecimal, 16);
        if (codePoint > 0x10ffff) return undefined;
        decoded += String.fromCodePoint(codePoint);
        index = end;
        continue;
      }
      const hexadecimal = value.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) return undefined;
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 4;
      continue;
    }
    if (escaped === "0") {
      if (/^[0-9]$/.test(value[index + 1] ?? "")) return undefined;
      decoded += "\0";
      continue;
    }
    if (/^[1-9]$/.test(escaped)) return undefined;
    decoded += JAVASCRIPT_SIMPLE_ESCAPES[escaped] ?? escaped;
  }
  return decoded;
}

function decodeUrlComponentTolerantly(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (encoded) => {
    let decoded = "";
    for (let start = 0; start < encoded.length;) {
      // A UTF-8 code point occupies at most four bytes, so no successful
      // decoding boundary requires retrying the full remaining suffix.
      let end = Math.min(encoded.length, start + 4 * 3);
      let consumed = false;
      for (; end > start; end -= 3) {
        try {
          decoded += decodeURIComponent(encoded.slice(start, end));
          start = end;
          consumed = true;
          break;
        } catch {
          // Try a shorter complete UTF-8 sequence.
        }
      }
      if (!consumed) {
        decoded += encoded.slice(start, start + 3);
        start += 3;
      }
    }
    return decoded;
  });
}

function decodeUrlPathForRepositoryMatch(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (encoded) => {
    const decoded = decodeUrlComponentTolerantly(encoded);
    return /^[A-Za-z0-9._~-]+$/.test(decoded) ? decoded : encoded;
  });
}

function normalizeRepositoryPath(pathname: string): string {
  const decoded = decodeUrlComponentTolerantly(pathname);
  const slashPath = decoded.replaceAll("\\", "/");
  const segments: string[] = [];
  for (const segment of slashPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return slashPath.endsWith("/") && normalized !== ""
    ? `${normalized}/`
    : normalized;
}

/**
 * Resolve a destination the way a browser does, then read back the path.
 *
 * Hand-rolling this over `/` segments misses every spelling of a traversal a
 * reader's browser still follows: `..\architecture\` (a special scheme treats
 * a backslash as a separator), `.%2e/` (a percent-encoded dot segment is still
 * a dot segment), and a trailing `?query` that leaves the path unchanged.
 * Returns undefined when the destination is not a resolvable path.
 */
function resolveDocumentationTarget(
  fromPath: string,
  rawHref: string,
  syntax: DestinationSyntax,
): string | undefined {
  const withCharacterReferences = syntax === "markdown" ||
      syntax === "html-attribute"
    ? decodeMarkdownCharacterReferences(rawHref)
    : rawHref;
  const href = syntax === "markdown"
    ? decodeMarkdownBackslashEscapes(withCharacterReferences)
    : withCharacterReferences;
  if (href.startsWith("#")) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(href, `${RESOLUTION_ORIGIN}/${fromPath}`);
  } catch {
    return undefined;
  }
  const normalizedPathname = `/${normalizeRepositoryPath(resolved.pathname)}`;
  let pathname: string;
  if (
    (resolved.protocol === "http:" || resolved.protocol === "https:") &&
    resolved.hostname === VERYFRONT_DOCS_HOSTNAME && resolved.port === ""
  ) {
    const prefix = normalizedPathname.startsWith(VERYFRONT_CODE_DOCS_PREFIX)
      ? VERYFRONT_CODE_DOCS_PREFIX
      : normalizedPathname.startsWith(VERYFRONT_SITE_CODE_PREFIX)
      ? VERYFRONT_SITE_CODE_PREFIX
      : undefined;
    if (prefix === undefined) {
      return undefined;
    }
    pathname = `/docs/${normalizedPathname.slice(prefix.length)}`;
  } else if (
    resolved.origin === RESOLUTION_ORIGIN &&
    /^[\/\\]/.test(href) &&
    normalizedPathname.startsWith(VERYFRONT_CODE_DOCS_PREFIX)
  ) {
    pathname = `/docs/${
      normalizedPathname.slice(VERYFRONT_CODE_DOCS_PREFIX.length)
    }`;
  } else if (
    resolved.origin === RESOLUTION_ORIGIN &&
    /^[\/\\]/.test(href) &&
    normalizedPathname.startsWith(VERYFRONT_SITE_CODE_PREFIX)
  ) {
    pathname = `/docs/${
      normalizedPathname.slice(VERYFRONT_SITE_CODE_PREFIX.length)
    }`;
  } else {
    if (resolved.origin !== RESOLUTION_ORIGIN || /^[\/\\]/.test(href)) {
      return undefined;
    }
    pathname = normalizedPathname;
  }
  return normalizeRepositoryPath(pathname);
}

function markdownCodeSpanEndAt(
  text: string,
  start: number,
): number | undefined {
  if (text[start] !== "`" || isBackslashEscaped(text, start)) return undefined;
  let length = 1;
  while (text[start + length] === "`") length++;
  const limit = paragraphBreakStart(text, start + length) ?? text.length;
  let cursor = start + length;
  while (cursor < limit) {
    const candidate = text.indexOf("`", cursor);
    if (candidate === -1 || candidate >= limit) return undefined;
    let candidateLength = 1;
    while (text[candidate + candidateLength] === "`") candidateLength++;
    if (candidateLength === length) return candidate + length;
    cursor = candidate + candidateLength;
  }
  return undefined;
}

function afterMarkdownLabel(text: string, start: number): number | undefined {
  if (text[start] !== "[") return undefined;
  let cursor = start + 1;
  let depth = 1;
  while (cursor < text.length && depth > 0) {
    const lineEnd = lineEndingEnd(text, cursor);
    if (lineEnd !== undefined) {
      let nextLineEnd = lineEnd;
      while (
        nextLineEnd < text.length && text[nextLineEnd] !== "\n" &&
        text[nextLineEnd] !== "\r"
      ) nextLineEnd++;
      if (text.slice(lineEnd, nextLineEnd).trim() === "") return undefined;
      cursor = lineEnd;
      continue;
    }
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += lineEndingEnd(text, cursor + 1) === undefined ? 2 : 1;
      continue;
    }
    const inlineHtmlEnd = commonMarkInlineHtmlEnd(text, cursor);
    if (inlineHtmlEnd !== undefined) {
      cursor = inlineHtmlEnd;
      continue;
    }
    const codeSpanEnd = markdownCodeSpanEndAt(text, cursor);
    if (codeSpanEnd !== undefined) {
      cursor = codeSpanEnd;
      continue;
    }
    if (text[cursor] === "[") depth++;
    if (text[cursor] === "]") depth--;
    cursor++;
  }
  return depth === 0 ? cursor : undefined;
}

function isBackslashEscaped(text: string, offset: number): boolean {
  let backslashes = 0;
  while (offset > backslashes && text[offset - backslashes - 1] === "\\") {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

type BlockContainerToken =
  | { type: "quote" }
  | {
    type: "list";
    indentation: number;
    leadingIndentation: number;
    marker: "ordered" | "unordered";
    delimiter: "." | ")" | "-" | "+" | "*";
    start?: number;
  };

function columnWidth(text: string): number {
  let column = 0;
  for (const character of text) {
    column += character === "\t" ? 4 - column % 4 : 1;
  }
  return column;
}

function blockContent(
  text: string,
  lineStart: number,
): { start: number; containers: BlockContainerToken[] } {
  let cursor = lineStart;
  const containers: BlockContainerToken[] = [];
  while (true) {
    const containerStart = cursor;
    let indentation = 0;
    while (indentation < 3) {
      if (text[cursor] === " ") {
        cursor++;
        indentation++;
        continue;
      }
      if (text[cursor] === "\t") {
        const width = 4 - indentation % 4;
        if (indentation + width > 3) break;
        cursor++;
        indentation += width;
        continue;
      }
      break;
    }
    if (text[cursor] === ">") {
      containers.push({ type: "quote" });
      cursor++;
      if (text[cursor] === " " || text[cursor] === "\t") cursor++;
      continue;
    }
    if (
      (text[cursor] === "-" || text[cursor] === "+" || text[cursor] === "*") &&
      (text[cursor + 1] === " " || text[cursor + 1] === "\t")
    ) {
      const delimiter = text[cursor] as "-" | "+" | "*";
      cursor += 2;
      containers.push({
        type: "list",
        indentation: columnWidth(text.slice(containerStart, cursor)),
        leadingIndentation: indentation,
        marker: "unordered",
        delimiter,
      });
      continue;
    }
    const ordered = text.slice(cursor).match(/^\d{1,9}[.)][ \t]/);
    if (ordered) {
      cursor += ordered[0].length;
      containers.push({
        type: "list",
        indentation: columnWidth(text.slice(containerStart, cursor)),
        leadingIndentation: indentation,
        marker: "ordered",
        delimiter: ordered[0].at(-2) as "." | ")",
        start: Number.parseInt(ordered[0], 10),
      });
      continue;
    }
    return { start: cursor, containers };
  }
}

function blockContentStart(text: string, lineStart: number): number {
  return blockContent(text, lineStart).start;
}

function blockContainerContentStart(
  text: string,
  lineStart: number,
  lineEnd: number,
  containers: readonly BlockContainerToken[],
): number | undefined {
  if (containers.length === 0) return lineStart;
  if (text.slice(lineStart, lineEnd).trim() === "") {
    return containers.every((container) => container.type === "list")
      ? lineEnd
      : undefined;
  }

  let cursor = lineStart;
  for (const container of containers) {
    if (container.type === "quote") {
      let indentation = 0;
      while (indentation < 3 && text[cursor] === " ") {
        cursor++;
        indentation++;
      }
      if (text[cursor] !== ">") return undefined;
      cursor++;
      if (text[cursor] === " " || text[cursor] === "\t") cursor++;
      continue;
    }

    let indentation = 0;
    while (indentation < container.indentation) {
      if (text[cursor] === " ") {
        cursor++;
        indentation++;
      } else if (text[cursor] === "\t") {
        cursor++;
        indentation += 4 - indentation % 4;
      } else return undefined;
    }
  }
  return cursor;
}

function allowsFollowingIndentedCode(line: string): boolean {
  return /^(?:#{1,6}(?:[ \t]+|$)|(?:=+|-+)[ \t]*$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/
    .test(line);
}

function blockQuoteContentStart(text: string, lineStart: number): number {
  let cursor = lineStart;
  let indentation = 0;
  while (indentation < 3 && text[cursor] === " ") {
    cursor++;
    indentation++;
  }
  if (text[cursor] !== ">") return lineStart;

  while (text[cursor] === ">") {
    cursor++;
    if (text[cursor] === " " || text[cursor] === "\t") cursor++;
    let nested = cursor;
    let nestedIndentation = 0;
    while (nestedIndentation < 3 && text[nested] === " ") {
      nested++;
      nestedIndentation++;
    }
    if (text[nested] !== ">") break;
    cursor = nested;
  }
  return cursor;
}

interface Range {
  start: number;
  end: number;
}

function markdownCodeRanges(text: string): Range[] {
  const blockRanges: Range[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let canStartIndentedCode = true;
  let indentedCode = false;
  let listContentIndent: number | undefined;
  let fence:
    | {
      marker: "`" | "~";
      length: number;
      start: number;
      containers: BlockContainerToken[];
    }
    | undefined;

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineEnd = offset + line.length;
    const nextOffset = offset + rawLine.length + 1;
    const content = blockContent(text, offset);
    const blockLine = text.slice(content.start, lineEnd);
    const possibleFence = blockLine.match(/^( {0,3})(`{3,}|~{3,})/);
    const fenceMatch = possibleFence &&
        (possibleFence[2]![0] === "~" ||
          !blockLine.slice(possibleFence[0].length).includes("`"))
      ? possibleFence
      : null;
    const inheritedContentStart = fence === undefined
      ? undefined
      : blockContainerContentStart(
        text,
        offset,
        lineEnd,
        fence.containers,
      );
    if (fence && inheritedContentStart === undefined) {
      blockRanges.push({ start: fence.start, end: offset });
      fence = undefined;
      canStartIndentedCode = true;
      indentedCode = false;
    }
    if (fence) {
      const fencedBlockLine = text.slice(inheritedContentStart, lineEnd);
      const closing = fencedBlockLine.match(
        /^( {0,3})(`{3,}|~{3,})[ \t]*$/,
      );
      if (
        closing && closing[2]![0] === fence.marker &&
        closing[2]!.length >= fence.length
      ) {
        blockRanges.push({ start: fence.start, end: lineEnd });
        fence = undefined;
        canStartIndentedCode = true;
        indentedCode = false;
      }
    } else if (fenceMatch) {
      const marker = fenceMatch[2]![0];
      if (marker !== "`" && marker !== "~") {
        offset = nextOffset;
        continue;
      }
      fence = {
        marker,
        length: fenceMatch[2]!.length,
        start: offset,
        containers: content.containers,
      };
      canStartIndentedCode = true;
      indentedCode = false;
    } else {
      const containerLine = text.slice(
        blockQuoteContentStart(text, offset),
        lineEnd,
      );
      const listItem = containerLine.match(
        /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]{1,4})/,
      );
      if (listItem) {
        listContentIndent = listItem[1]!.length +
          containerLine.slice(listItem[1]!.length).search(/[ \t]/) +
          listItem[2]!.length;
      } else if (containerLine.trim() !== "") {
        const indentation = containerLine.match(/^[ \t]*/)?.[0].replaceAll(
          "\t",
          "    ",
        ).length ?? 0;
        if (
          listContentIndent !== undefined && indentation < listContentIndent
        ) {
          listContentIndent = undefined;
        }
      }
      const indentation = containerLine.match(/^[ \t]*/)?.[0].replaceAll(
        "\t",
        "    ",
      ).length ?? 0;
      const blank = containerLine.trim() === "";
      const sufficientlyIndented = !blank &&
        indentation >= (listContentIndent ?? 0) + 4;
      if (sufficientlyIndented && (canStartIndentedCode || indentedCode)) {
        blockRanges.push({ start: offset, end: lineEnd });
        indentedCode = true;
      } else if (blank) {
        canStartIndentedCode = true;
      } else {
        canStartIndentedCode = allowsFollowingIndentedCode(blockLine);
        indentedCode = false;
      }
    }
    offset = nextOffset;
  }
  if (fence) blockRanges.push({ start: fence.start, end: text.length });

  const inlineRanges: Range[] = [];
  let blockIndex = 0;
  for (let cursor = 0; cursor < text.length;) {
    while (
      blockIndex < blockRanges.length &&
      blockRanges[blockIndex]!.end <= cursor
    ) blockIndex++;
    const block = blockRanges[blockIndex];
    if (block && block.start <= cursor) {
      cursor = block.end;
      continue;
    }
    if (text[cursor] !== "`" || isBackslashEscaped(text, cursor)) {
      cursor++;
      continue;
    }

    let length = 1;
    while (text[cursor + length] === "`") length++;
    const paragraphLimit = paragraphBreakStart(text, cursor + length) ??
      text.length;
    const limit = Math.min(
      paragraphLimit,
      blockRanges[blockIndex]?.start ?? text.length,
    );
    let search = cursor + length;
    let closing: number | undefined;
    let searchBlockIndex = blockIndex;
    while (search < limit) {
      const candidate = text.indexOf("`", search);
      if (candidate === -1 || candidate >= limit) break;
      while (
        searchBlockIndex < blockRanges.length &&
        blockRanges[searchBlockIndex]!.end <= candidate
      ) searchBlockIndex++;
      const candidateBlock = blockRanges[searchBlockIndex];
      if (candidateBlock && candidateBlock.start <= candidate) {
        search = candidateBlock.end;
        continue;
      }
      let candidateLength = 1;
      while (text[candidate + candidateLength] === "`") candidateLength++;
      if (
        candidateLength === length
      ) {
        closing = candidate;
        break;
      }
      search = candidate + candidateLength;
    }
    if (closing === undefined) {
      cursor += length;
      continue;
    }
    inlineRanges.push({ start: cursor, end: closing + length });
    cursor = closing + length;
  }

  return [...blockRanges, ...inlineRanges].sort((left, right) =>
    left.start - right.start
  );
}

function isInsideRange(ranges: readonly Range[], offset: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle]!;
    if (offset < range.start) high = middle - 1;
    else if (offset >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

interface MdxSyntaxRanges {
  readonly comments: Range[];
  readonly expressions: Range[];
  readonly strings: Range[];
}

interface JavaScriptSignificantToken {
  readonly end: number;
  readonly kind: "other" | "regex";
}

interface JavaScriptScannedToken {
  readonly end: number;
  readonly kind: "literal" | "other" | "regex" | "trivia";
  readonly string?: Range;
}

function quotedRangeEnd(
  text: string,
  start: number,
  quote: '"' | "'" | "`",
): number | undefined {
  if (quote === "`") return javaScriptTemplateEnd(text, start);
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    if (text[cursor] === "\\") cursor++;
    else if (text[cursor] === quote) return cursor + 1;
  }
  return undefined;
}

function javaScriptTemplateEnd(
  text: string,
  start: number,
): number | undefined {
  let cursor = start + 1;
  while (cursor < text.length) {
    if (text[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (text[cursor] === "`") return cursor + 1;
    if (text.startsWith("${", cursor)) {
      const interpolationEnd = javaScriptTemplateInterpolationEnd(text, cursor);
      if (interpolationEnd === undefined) return undefined;
      cursor = interpolationEnd;
      continue;
    }
    cursor++;
  }
  return undefined;
}

function javaScriptTemplateInterpolationEnd(
  text: string,
  start: number,
): number | undefined {
  let depth = 1;
  let cursor = start + 2;
  let previousSignificantToken: JavaScriptSignificantToken | undefined;
  while (cursor < text.length) {
    const token = javaScriptTokenAt(
      text,
      cursor,
      previousSignificantToken,
    );
    if (token === undefined) return undefined;
    if (token.kind === "trivia") {
      cursor = token.end;
      continue;
    }
    previousSignificantToken = {
      end: token.end,
      kind: token.kind === "regex" ? "regex" : "other",
    };
    if (token.kind !== "other") {
      cursor = token.end;
      continue;
    }
    const character = text[cursor]!;
    if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return cursor + 1;
    cursor = token.end;
  }
  return undefined;
}

function javaScriptCommentEnd(text: string, start: number): number | undefined {
  if (text[start] !== "/" || start + 1 >= text.length) return undefined;
  const marker = text[start + 1];
  if (marker === "/") {
    const newline = text.indexOf("\n", start + 2);
    return newline === -1 ? text.length : newline;
  }
  if (marker !== "*") return undefined;

  const closing = text.indexOf("*/", start + 2);
  return closing === -1 ? undefined : closing + 2;
}

function skipJavaScriptTrivia(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor]!)) {
      cursor++;
      continue;
    }
    const commentEnd = javaScriptCommentEnd(text, cursor);
    if (commentEnd === undefined) break;
    cursor = commentEnd;
  }
  return cursor;
}

function hasTemplateInterpolation(value: string): boolean {
  for (let cursor = 0; cursor < value.length; cursor++) {
    if (value[cursor] === "\\") cursor++;
    else if (value.startsWith("${", cursor)) return true;
  }
  return false;
}

function staticJsxStringExpression(
  text: string,
  start: number,
): { readonly value: string; readonly offset: number } | undefined {
  let cursor = skipJavaScriptTrivia(text, start);
  let parentheses = 0;
  while (text[cursor] === "(") {
    parentheses++;
    cursor = skipJavaScriptTrivia(text, cursor + 1);
  }

  const quote = text[cursor];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  const literalEnd = quotedRangeEnd(text, cursor, quote);
  if (literalEnd === undefined) return undefined;
  const value = text.slice(cursor + 1, literalEnd - 1);
  if (quote === "`" && hasTemplateInterpolation(value)) return undefined;
  const offset = cursor + 1;

  cursor = skipJavaScriptTrivia(text, literalEnd);
  while (parentheses > 0 && text[cursor] === ")") {
    parentheses--;
    cursor = skipJavaScriptTrivia(text, cursor + 1);
  }
  if (parentheses !== 0 || text[cursor] !== "}") return undefined;
  return { value, offset };
}

function mdxExpressionAt(
  text: string,
  start: number,
): { readonly expression: Range; readonly strings: Range[] } | undefined {
  const strings: Range[] = [];
  let depth = 1;
  let cursor = start + 1;
  let previousSignificantToken: JavaScriptSignificantToken | undefined;
  while (cursor < text.length) {
    const token = javaScriptTokenAt(
      text,
      cursor,
      previousSignificantToken,
    );
    if (token === undefined) return undefined;
    if (token.string !== undefined) strings.push(token.string);
    if (token.kind === "trivia") {
      cursor = token.end;
      continue;
    }
    previousSignificantToken = {
      end: token.end,
      kind: token.kind === "regex" ? "regex" : "other",
    };
    if (token.kind !== "other") {
      cursor = token.end;
      continue;
    }
    const character = text[cursor]!;
    if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      return { expression: { start, end: cursor + 1 }, strings };
    }
    cursor = token.end;
  }
  return undefined;
}

function mdxSyntaxRanges(
  text: string,
  codeRanges: readonly Range[],
): MdxSyntaxRanges {
  const comments: Range[] = [];
  const expressions: Range[] = [];
  const strings: Range[] = [];
  let codeIndex = 0;
  let cursor = 0;
  while (cursor < text.length) {
    while (
      codeIndex < codeRanges.length && codeRanges[codeIndex]!.end <= cursor
    ) codeIndex++;
    const codeRange = codeRanges[codeIndex];
    if (codeRange && codeRange.start <= cursor) {
      cursor = codeRange.end;
      continue;
    }

    if (
      text.startsWith("{/*", cursor) &&
      !isBackslashEscaped(text, cursor)
    ) {
      const commentEnd = javaScriptCommentEnd(text, cursor + 1);
      if (commentEnd !== undefined) {
        const expressionEnd = skipJavaScriptTrivia(text, commentEnd);
        if (text[expressionEnd] === "}") {
          const end = expressionEnd + 1;
          comments.push({ start: cursor, end });
          cursor = end;
          continue;
        }
      }
    }
    if (text[cursor] !== "{" || isBackslashEscaped(text, cursor)) {
      cursor++;
      continue;
    }

    const expression = mdxExpressionAt(text, cursor);
    if (expression === undefined) {
      cursor++;
      continue;
    }
    expressions.push(expression.expression);
    strings.push(...expression.strings);
    cursor = expression.expression.end;
  }
  return { comments, expressions, strings };
}

function maskRanges(text: string, ranges: readonly Range[]): string {
  let masked = "";
  let cursor = 0;
  for (const range of ranges) {
    masked += text.slice(cursor, range.start);
    masked += text.slice(range.start, range.end).replace(/[^\r\n]/g, " ");
    cursor = range.end;
  }
  return masked + text.slice(cursor);
}

function mdxEsmMayStart(text: string, lineStart: number): boolean {
  if (lineStart === 0) return true;
  const previousEnd = text[lineStart - 2] === "\r"
    ? lineStart - 2
    : lineStart - 1;
  const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
  const previousLine = text.slice(previousStart, previousEnd);
  return previousLine.trim() === "" ||
    allowsFollowingIndentedCode(previousLine) ||
    /^( {0,3})(`{3,}|~{3,})[ \t]*$/.test(previousLine);
}

interface JavaScriptBalance {
  readonly delimiters: string[];
  quote: '"' | "'" | undefined;
  blockComment: boolean;
  templateEnd: number;
  previousSignificantToken: JavaScriptSignificantToken | undefined;
  valid: boolean;
}

function javaScriptRegexEnd(line: string, start: number): number | undefined {
  let characterClass = false;
  for (let cursor = start + 1; cursor < line.length; cursor++) {
    if (line[cursor] === "\n" || line[cursor] === "\r") return undefined;
    if (line[cursor] === "\\") {
      if (line[cursor + 1] === "\n" || line[cursor + 1] === "\r") {
        return undefined;
      }
      cursor++;
      continue;
    }
    if (line[cursor] === "[") characterClass = true;
    else if (line[cursor] === "]") characterClass = false;
    else if (line[cursor] === "/" && !characterClass) {
      cursor++;
      while (/[A-Za-z]/.test(line[cursor] ?? "")) cursor++;
      return cursor;
    }
  }
  return undefined;
}

const JAVASCRIPT_REGEX_PREFIX_KEYWORDS: ReadonlySet<string> = new Set([
  "return",
  "case",
  "throw",
  "default",
  "typeof",
  "void",
  "delete",
  "in",
  "instanceof",
  "new",
]);

function javaScriptRegexMayStart(
  text: string,
  previousSignificantToken: JavaScriptSignificantToken | undefined,
): boolean {
  if (previousSignificantToken === undefined) return true;
  if (previousSignificantToken.kind === "regex") return false;
  const end = previousSignificantToken.end;

  if ("=(:,![{;?&|+*%/^~<>-".includes(text[end - 1]!)) return true;

  let wordStart = end;
  while (wordStart > 0 && /[A-Za-z]/.test(text[wordStart - 1]!)) wordStart--;
  const keyword = text.slice(wordStart, end);
  if (!JAVASCRIPT_REGEX_PREFIX_KEYWORDS.has(keyword)) return false;

  return wordStart === 0 ||
    !/[A-Za-z0-9_$.#]/.test(text[wordStart - 1]!);
}

function javaScriptTokenAt(
  text: string,
  start: number,
  previousSignificantToken: JavaScriptSignificantToken | undefined,
): JavaScriptScannedToken | undefined {
  const commentEnd = javaScriptCommentEnd(text, start);
  if (commentEnd !== undefined) {
    return { end: commentEnd, kind: "trivia" };
  }

  const character = text[start]!;
  if (/\s/.test(character)) return { end: start + 1, kind: "trivia" };

  if (character === '"' || character === "'" || character === "`") {
    const end = quotedRangeEnd(text, start, character);
    return end === undefined
      ? undefined
      : { end, kind: "literal", string: { start, end } };
  }

  if (
    character === "/" &&
    javaScriptRegexMayStart(text, previousSignificantToken)
  ) {
    const end = javaScriptRegexEnd(text, start);
    if (end !== undefined) return { end, kind: "regex" };
  }

  return { end: start + 1, kind: "other" };
}

function scanJavaScriptLine(
  text: string,
  lineStart: number,
  lineEnd: number,
  state: JavaScriptBalance,
): void {
  const closers: Readonly<Record<string, string>> = {
    ")": "(",
    "]": "[",
    "}": "{",
  };
  for (
    let cursor = Math.max(lineStart, state.templateEnd);
    cursor < lineEnd;
    cursor++
  ) {
    const character = text[cursor]!;
    if (state.blockComment) {
      if (text.startsWith("*/", cursor)) {
        state.blockComment = false;
        cursor++;
      }
      continue;
    }
    if (state.quote !== undefined) {
      if (character === "\\") cursor++;
      else if (character === state.quote) {
        state.quote = undefined;
        state.previousSignificantToken = { end: cursor + 1, kind: "other" };
      }
      continue;
    }
    if (text.startsWith("//", cursor)) break;
    if (text.startsWith("/*", cursor)) {
      state.blockComment = true;
      cursor++;
      continue;
    }
    if (character === "`") {
      const templateEnd = javaScriptTemplateEnd(text, cursor);
      if (templateEnd === undefined) {
        state.valid = false;
        return;
      }
      state.previousSignificantToken = { end: templateEnd, kind: "other" };
      state.templateEnd = templateEnd;
      cursor = templateEnd - 1;
      continue;
    }
    if (character === '"' || character === "'") {
      state.quote = character;
      continue;
    }
    if (
      character === "/" &&
      javaScriptRegexMayStart(text, state.previousSignificantToken)
    ) {
      const regexEnd = javaScriptRegexEnd(text, cursor);
      if (regexEnd !== undefined) {
        state.previousSignificantToken = { end: regexEnd, kind: "regex" };
        cursor = regexEnd - 1;
        continue;
      }
    }
    if (/\s/.test(character)) continue;
    state.previousSignificantToken = { end: cursor + 1, kind: "other" };
    if (character === "(" || character === "[" || character === "{") {
      state.delimiters.push(character);
      continue;
    }
    const opener = closers[character];
    if (opener === undefined) continue;
    if (state.delimiters.at(-1) !== opener) {
      state.valid = false;
      return;
    }
    state.delimiters.pop();
  }
}

function mdxEsmRangeEnd(text: string, start: number): number | undefined {
  const state: JavaScriptBalance = {
    delimiters: [],
    quote: undefined,
    blockComment: false,
    templateEnd: start,
    previousSignificantToken: undefined,
    valid: true,
  };
  for (let lineStart = start; lineStart <= text.length;) {
    const next = text.indexOf("\n", lineStart);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (
      lineStart > start && line.trim() === "" &&
      state.delimiters.length === 0 && state.quote === undefined &&
      !state.blockComment && state.templateEnd <= lineStart
    ) return lineStart;

    scanJavaScriptLine(text, lineStart, lineEnd, state);
    if (!state.valid) return undefined;
    if (next === -1) {
      return state.delimiters.length === 0 && state.quote === undefined &&
          !state.blockComment
        ? text.length
        : undefined;
    }
    lineStart = next + 1;
  }
  return undefined;
}

function mdxEsmRanges(
  text: string,
  ignoredRanges: readonly Range[],
): Range[] {
  const ranges: Range[] = [];
  for (let lineStart = 0; lineStart < text.length;) {
    const next = text.indexOf("\n", lineStart);
    const lineEnd = next === -1 ? text.length : next;
    if (isInsideRange(ignoredRanges, lineStart)) {
      if (next === -1) break;
      lineStart = next + 1;
      continue;
    }

    const line = text.slice(lineStart, lineEnd);
    if (
      /^(?:import|export)\b/.test(line) &&
      mdxEsmMayStart(text, lineStart)
    ) {
      const rangeEnd = mdxEsmRangeEnd(text, lineStart);
      if (rangeEnd !== undefined) {
        ranges.push({ start: lineStart, end: rangeEnd });
        lineStart = rangeEnd;
        continue;
      }
    }
    if (next === -1) break;
    lineStart = next + 1;
  }
  return ranges;
}

function yamlFrontmatterRanges(text: string): Range[] {
  const openingEnd = text.startsWith("---\r\n")
    ? 5
    : text.startsWith("---\n")
    ? 4
    : undefined;
  if (openingEnd === undefined) return [];

  for (let lineStart = openingEnd; lineStart < text.length;) {
    const next = text.indexOf("\n", lineStart);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (line === "---") {
      return [{
        start: 0,
        end: next === -1 ? text.length : next + 1,
      }];
    }
    if (next === -1) break;
    lineStart = next + 1;
  }
  return [];
}

function htmlCommentBlockMayStart(text: string, start: number): boolean {
  const lineStart = Math.max(
    text.lastIndexOf("\n", start - 1),
    text.lastIndexOf("\r", start - 1),
  ) + 1;
  return blockContentStart(text, lineStart) === start;
}

function htmlCommentRanges(
  text: string,
  ignoredRanges: readonly Range[],
): Range[] {
  const ranges: Range[] = [];
  for (let start = 0; start < text.length;) {
    start = text.indexOf("<!--", start);
    if (start === -1) break;
    if (
      isInsideRange(ignoredRanges, start) ||
      isBackslashEscaped(text, start)
    ) {
      start += 4;
      continue;
    }
    const closing = text.indexOf("-->", start + 4);
    if (closing === -1 && !htmlCommentBlockMayStart(text, start)) {
      start += 4;
      continue;
    }
    const end = closing === -1 ? text.length : closing + 3;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function ignoredDestinationRanges(
  text: string,
  syntax: DocumentSyntax,
  hasFrontmatter: boolean,
): {
  readonly ignored: Range[];
  readonly code: Range[];
  readonly htmlComments: Range[];
  readonly expressions: Range[];
  readonly strings: Range[];
} {
  const frontmatterRanges = hasFrontmatter ? yamlFrontmatterRanges(text) : [];
  const codeRanges = markdownCodeRanges(maskRanges(text, frontmatterRanges));
  const mdxRanges = syntax === "mdx"
    ? mdxSyntaxRanges(
      text,
      mergeRanges([...frontmatterRanges, ...codeRanges]),
    )
    : { comments: [], expressions: [], strings: [] };
  const esmRanges = syntax === "mdx"
    ? mdxEsmRanges(
      text,
      mergeRanges([
        ...frontmatterRanges,
        ...codeRanges,
        ...mdxRanges.comments,
        ...mdxRanges.expressions,
      ]),
    )
    : [];
  const baseIgnoredRanges = mergeRanges([
    ...frontmatterRanges,
    ...codeRanges,
    ...mdxRanges.comments,
    ...esmRanges,
  ]);
  const preliminaryTagRanges = htmlTagRanges(
    text,
    baseIgnoredRanges,
    mdxRanges.expressions,
    mdxRanges.strings,
  );
  const htmlComments = syntax === "markdown"
    ? htmlCommentRanges(
      text,
      mergeRanges([...baseIgnoredRanges, ...preliminaryTagRanges]),
    )
    : [];
  return {
    ignored: mergeRanges([...baseIgnoredRanges, ...htmlComments]),
    code: codeRanges,
    htmlComments,
    expressions: mdxRanges.expressions,
    strings: mdxRanges.strings,
  };
}

function followsClosedHtmlCommentBlock(
  text: string,
  lineStart: number,
  htmlComments: readonly Range[],
): boolean {
  const previousEnd = text[lineStart - 2] === "\r"
    ? lineStart - 2
    : lineStart - 1;
  for (const range of htmlComments) {
    if (
      range.end > previousEnd ||
      text.slice(range.end, previousEnd).trim() !== ""
    ) continue;
    const openingLineStart = text.lastIndexOf("\n", range.start - 1) + 1;
    const openingContentStart = blockContentStart(text, openingLineStart);
    if (/^ {0,3}$/.test(text.slice(openingContentStart, range.start))) {
      return true;
    }
  }
  return false;
}

function followsCompletedHtmlBlock(
  lineStart: number,
  htmlBlocks: readonly Range[],
): boolean {
  return htmlBlocks.some((range) => range.end === lineStart);
}

interface TagSyntaxScan {
  readonly end: number | undefined;
  readonly topLevelOffsets: ReadonlySet<number>;
}

function scanTagSyntax(
  text: string,
  start: number,
): TagSyntaxScan {
  const topLevelOffsets = new Set<number>();
  let quote: '"' | "'" | undefined;
  let quoteUsesJavaScriptEscapes = false;
  let expressionDepth = 0;
  let previousSignificantToken: JavaScriptSignificantToken | undefined;
  for (let cursor = start; cursor < text.length; cursor++) {
    const character = text[cursor]!;
    if (quote !== undefined) {
      if (quoteUsesJavaScriptEscapes && character === "\\") cursor++;
      else if (character === quote) {
        quote = undefined;
        if (expressionDepth > 0) {
          previousSignificantToken = { end: cursor + 1, kind: "other" };
        }
        quoteUsesJavaScriptEscapes = false;
      }
      continue;
    }
    const commentEnd = expressionDepth > 0
      ? javaScriptCommentEnd(text, cursor)
      : undefined;
    if (commentEnd !== undefined) {
      cursor = commentEnd - 1;
      continue;
    }
    if (
      expressionDepth > 0 && character === "/" &&
      javaScriptRegexMayStart(text, previousSignificantToken)
    ) {
      const regexEnd = javaScriptRegexEnd(text, cursor);
      if (regexEnd !== undefined) {
        previousSignificantToken = { end: regexEnd, kind: "regex" };
        cursor = regexEnd - 1;
        continue;
      }
    }
    if (expressionDepth === 0) {
      topLevelOffsets.add(cursor);
      if (character === ">") {
        return { end: cursor + 1, topLevelOffsets };
      }
    }
    if (character === "`" && expressionDepth > 0) {
      const templateEnd = javaScriptTemplateEnd(text, cursor);
      if (templateEnd !== undefined) {
        previousSignificantToken = { end: templateEnd, kind: "other" };
        cursor = templateEnd - 1;
        continue;
      }
    }
    if (expressionDepth > 0 && /\s/.test(character)) continue;
    if (expressionDepth > 0 || character === "{") {
      previousSignificantToken = { end: cursor + 1, kind: "other" };
    }
    if (character === '"' || character === "'") {
      quote = character;
      quoteUsesJavaScriptEscapes = expressionDepth > 0;
    } else if (character === "{") expressionDepth++;
    else if (character === "}" && expressionDepth > 0) expressionDepth--;
  }
  return { end: undefined, topLevelOffsets };
}

function commonMarkHtmlTagEnd(text: string, start: number): number | undefined {
  if (text[start] !== "<" || !/[A-Za-z/]/.test(text[start + 1] ?? "")) {
    return undefined;
  }
  const match = COMMONMARK_HTML_TAG_SOURCE.exec(text.slice(start));
  return match === null ? undefined : start + match[0].length;
}

function commonMarkInlineHtmlEnd(
  text: string,
  start: number,
): number | undefined {
  const tagEnd = commonMarkHtmlTagEnd(text, start);
  if (tagEnd !== undefined) return tagEnd;

  let delimiter: string | undefined;
  if (text.startsWith("<!--", start)) delimiter = "-->";
  else if (text.startsWith("<?", start)) delimiter = "?>";
  else if (text.startsWith("<![CDATA[", start)) delimiter = "]]>";
  else if (/^<![A-Za-z]+[\t\n\f\r ]/.test(text.slice(start))) {
    delimiter = ">";
  }
  if (delimiter === undefined) return undefined;
  const closing = text.indexOf(delimiter, start + 2);
  return closing === -1 ? undefined : closing + delimiter.length;
}

function mdxJsxNameEnd(text: string, start: number): number | undefined {
  if (!/[A-Za-z_$]/.test(text[start] ?? "")) return undefined;
  let cursor = start + 1;
  while (/[A-Za-z0-9_$:.-]/.test(text[cursor] ?? "")) cursor++;
  return cursor;
}

function mdxJsxTagEnd(text: string, start: number): number | undefined {
  if (text[start] !== "<") return undefined;
  let cursor = mdxJsxNameEnd(text, start + 1);
  if (cursor === undefined) return undefined;

  while (cursor < text.length) {
    const attributeSeparatorStart = cursor;
    while (/[\t\n\f\r ]/.test(text[cursor] ?? "")) cursor++;
    if (text.startsWith("/>", cursor)) return cursor + 2;
    if (text[cursor] === ">") return cursor + 1;
    if (cursor === attributeSeparatorStart) return undefined;
    if (text[cursor] === "{") {
      const expression = mdxExpressionAt(text, cursor);
      if (expression === undefined) return undefined;
      const spreadStart = skipJavaScriptTrivia(text, cursor + 1);
      if (!text.startsWith("...", spreadStart)) return undefined;
      cursor = expression.expression.end;
      continue;
    }

    const nameEnd = mdxJsxNameEnd(text, cursor);
    if (nameEnd === undefined) return undefined;
    cursor = nameEnd;
    while (/[\t\n\f\r ]/.test(text[cursor] ?? "")) cursor++;
    if (text[cursor] !== "=") continue;
    cursor++;
    while (/[\t\n\f\r ]/.test(text[cursor] ?? "")) cursor++;
    const quote = text[cursor];
    if (quote === '"' || quote === "'") {
      const closing = text.indexOf(quote, cursor + 1);
      if (closing === -1) return undefined;
      cursor = closing + 1;
      continue;
    }
    if (text[cursor] !== "{") return undefined;
    const expression = mdxExpressionAt(text, cursor);
    if (expression === undefined) return undefined;
    cursor = expression.expression.end;
  }
  return undefined;
}

function htmlTagRanges(
  text: string,
  ignoredRanges: readonly Range[],
  expressionRanges: readonly Range[] = [],
  stringRanges: readonly Range[] = [],
): Range[] {
  const ranges: Range[] = [];
  for (let start = 0; start < text.length;) {
    start = text.indexOf("<", start);
    if (start === -1) break;
    if (
      isInsideRange(stringRanges, start) ||
      (isInsideRange(ignoredRanges, start) &&
        !isInsideRange(expressionRanges, start)) ||
      isBackslashEscaped(text, start) ||
      !/[A-Za-z]/.test(text[start + 1] ?? "") ||
      /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(text.slice(start + 1))
    ) {
      start++;
      continue;
    }

    const commonMarkEnd = commonMarkHtmlTagEnd(text, start);
    const mdxJsxEnd = mdxJsxTagEnd(text, start);
    const tagEnd = commonMarkEnd === undefined
      ? mdxJsxEnd
      : mdxJsxEnd === undefined
      ? commonMarkEnd
      : Math.max(commonMarkEnd, mdxJsxEnd);
    if (tagEnd !== undefined) {
      ranges.push({ start, end: tagEnd });
      start = tagEnd;
    } else start++;
  }
  return ranges;
}

interface RawHtmlBlockBodyRanges {
  readonly markdown: Range[];
  readonly rawText: Range[];
  readonly blocks: Range[];
}

/**
 * CommonMark HTML blocks render Markdown-shaped text as raw HTML.
 *
 * Type-1 blocks (`script`, `style`, `pre`, and `textarea`) end at their closing
 * tag. Type-3 through type-5 blocks end at their matching delimiter. Type-6
 * and type-7 blocks end at the next blank line. Every block ends at its
 * container exit or the end of the document.
 */
function rawHtmlBlockBodyRanges(
  text: string,
  tagRanges: readonly Range[],
  ignoredRanges: readonly Range[],
): RawHtmlBlockBodyRanges {
  const tagsByStart = new Map(tagRanges.map((range) => [range.start, range]));
  const markdown: Range[] = [];
  const rawText: Range[] = [];
  const blocks: Range[] = [];
  for (let lineStart = 0; lineStart < text.length;) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const content = blockContent(text, lineStart);
    const blockLine = text.slice(content.start, lineEnd);
    const insideHtmlBlock = markdown.some((range) =>
      content.start >= range.start && content.start < range.end
    );
    const ignored = isInsideRange(ignoredRanges, content.start);
    const rawTextOpening = ignored
      ? null
      : blockLine.match(RAW_HTML_BLOCK_TAG_SOURCE);
    const terminatedRawHtmlBlockEnd = ignored
      ? undefined
      : terminatedRawHtmlBlockEndPattern(blockLine);
    const typeSixOpening = !ignored &&
      BLANK_LINE_TERMINATED_HTML_BLOCK_TAG_SOURCE.test(blockLine);
    const typeSevenMayStart = followsCompletedHtmlBlock(lineStart, blocks) ||
      referenceDefinitionMayStart(text, lineStart, undefined);
    const blankLineTerminated = rawTextOpening === null &&
      terminatedRawHtmlBlockEnd === undefined &&
      !insideHtmlBlock &&
      (typeSixOpening ||
        !ignored && typeSevenMayStart &&
          COMPLETE_HTML_BLOCK_TAG_LINE_SOURCE.test(blockLine));
    if (
      rawTextOpening === null && terminatedRawHtmlBlockEnd === undefined &&
      !blankLineTerminated
    ) {
      if (newline === -1) break;
      lineStart = newline + 1;
      continue;
    }

    let end = text.length;
    for (let currentLineStart = lineStart; currentLineStart < text.length;) {
      const currentNewline = text.indexOf("\n", currentLineStart);
      const currentLineEnd = currentNewline === -1
        ? text.length
        : currentNewline;
      const currentContentStart = blockContainerContentStart(
        text,
        currentLineStart,
        currentLineEnd,
        content.containers,
      );
      if (currentLineStart !== lineStart && currentContentStart === undefined) {
        end = currentLineStart;
        break;
      }
      const currentLine = text.slice(currentLineStart, currentLineEnd);
      if (rawTextOpening === null && terminatedRawHtmlBlockEnd === undefined) {
        if (
          currentLineStart !== lineStart &&
          text.slice(currentContentStart, currentLineEnd).trim() === ""
        ) {
          end = currentLineStart;
          break;
        }
      } else {
        const endPattern = terminatedRawHtmlBlockEnd ??
          RAW_HTML_BLOCK_END_SOURCE;
        if (endPattern.test(currentLine)) {
          end = currentNewline === -1 ? text.length : currentNewline + 1;
          break;
        }
      }
      if (currentNewline === -1) break;
      currentLineStart = currentNewline + 1;
    }
    blocks.push({ start: lineStart, end });
    const range = {
      start: tagsByStart.get(content.start)?.end ?? content.start,
      end,
    };
    markdown.push(range);
    if (
      terminatedRawHtmlBlockEnd !== undefined ||
      rawTextOpening !== null && rawTextOpening[1]!.toLowerCase() !== "pre"
    ) {
      rawText.push(range);
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return {
    markdown: mergeRanges(markdown),
    rawText: mergeRanges(rawText),
    blocks,
  };
}

function terminatedRawHtmlBlockEndPattern(
  blockLine: string,
): RegExp | undefined {
  if (PROCESSING_INSTRUCTION_HTML_BLOCK_SOURCE.test(blockLine)) {
    return PROCESSING_INSTRUCTION_HTML_BLOCK_END_SOURCE;
  }
  if (DECLARATION_HTML_BLOCK_SOURCE.test(blockLine)) {
    return DECLARATION_HTML_BLOCK_END_SOURCE;
  }
  if (CDATA_HTML_BLOCK_SOURCE.test(blockLine)) {
    return CDATA_HTML_BLOCK_END_SOURCE;
  }
  return undefined;
}

function topLevelTagOffsets(tag: string): ReadonlySet<number> {
  return scanTagSyntax(tag, 0).topLevelOffsets;
}

function nextLineEndingStart(text: string, start: number): number | undefined {
  const match = /[\r\n]/.exec(text.slice(start));
  return match === null ? undefined : start + match.index;
}

function referenceTitleEnd(
  text: string,
  start: number,
  containers: readonly BlockContainerToken[],
): number | undefined {
  const opener = text[start];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== '"' && opener !== "'" && opener !== "(") return undefined;

  let cursor = start + 1;
  while (cursor < text.length) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      if (text[cursor + 1] === "\n" || text[cursor + 1] === "\r") {
        cursor++;
        continue;
      }
      cursor += 2;
      continue;
    }
    if (text[cursor] === closer) {
      cursor++;
      while (text[cursor] === " " || text[cursor] === "\t") cursor++;
      return cursor >= text.length || text[cursor] === "\n" ||
          text[cursor] === "\r"
        ? cursor
        : undefined;
    }
    if (text[cursor] === "\n" || text[cursor] === "\r") {
      const lineStart = lineEndingEnd(text, cursor);
      if (lineStart === undefined) return undefined;
      const lineEnd = nextLineEndingStart(text, lineStart) ?? text.length;
      const contentStart = blockContainerContentStart(
        text,
        lineStart,
        lineEnd,
        containers,
      );
      if (contentStart === undefined) return undefined;
      let significant = contentStart;
      while (text[significant] === " " || text[significant] === "\t") {
        significant++;
      }
      if (significant >= lineEnd) return undefined;
      cursor = contentStart;
      continue;
    }
    cursor++;
  }
  return undefined;
}

function referenceDefinitionTailEnd(
  text: string,
  start: number,
  containers: readonly BlockContainerToken[],
): number | undefined {
  let cursor = start;
  let hasSeparation = false;
  while (text[cursor] === " " || text[cursor] === "\t") {
    hasSeparation = true;
    cursor++;
  }
  if (cursor >= text.length) return cursor;
  if (text[cursor] !== "\n" && text[cursor] !== "\r") {
    return hasSeparation
      ? referenceTitleEnd(text, cursor, containers)
      : undefined;
  }

  const destinationLineEnd = cursor;
  const titleLineStart = lineEndingEnd(text, cursor);
  if (titleLineStart === undefined) return destinationLineEnd;
  const titleLineEnd = nextLineEndingStart(text, titleLineStart) ?? text.length;
  const contentStart = blockContainerContentStart(
    text,
    titleLineStart,
    titleLineEnd,
    containers,
  );
  if (contentStart === undefined) return destinationLineEnd;
  cursor = contentStart;
  while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  return referenceTitleEnd(text, cursor, containers) ?? destinationLineEnd;
}

function sameBlockContainer(
  left: BlockContainerToken,
  right: BlockContainerToken,
): boolean {
  return left.type === "quote" && right.type === "quote" ||
    left.type === "list" && right.type === "list" &&
      left.leadingIndentation === right.leadingIndentation &&
      left.marker === right.marker && left.delimiter === right.delimiter;
}

function sameBlockContainers(
  left: readonly BlockContainerToken[],
  right: readonly BlockContainerToken[],
): boolean {
  return left.length === right.length &&
    left.every((container, index) =>
      sameBlockContainer(container, right[index]!)
    );
}

function referenceDefinitionMayStart(
  text: string,
  lineStart: number,
  previousReferenceEnd: number | undefined,
): boolean {
  const followsReference = previousReferenceEnd === lineStart - 1 ||
    previousReferenceEnd === lineStart - 2 && text[lineStart - 2] === "\r";
  if (lineStart === 0 || followsReference) return true;

  const previousEnd = text[lineStart - 2] === "\r"
    ? lineStart - 2
    : lineStart - 1;
  const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
  const previousLine = text.slice(
    blockContentStart(text, previousStart),
    previousEnd,
  );
  if (previousLine.trim() === "") return true;

  const currentContainers = blockContent(text, lineStart).containers;
  const previousContainers = blockContent(text, previousStart).containers;
  const currentLeaf = currentContainers.at(-1);
  const currentParents = currentContainers.slice(0, -1);
  const previousLeaf = previousContainers.at(-1);
  const previousParents = previousContainers.slice(0, -1);
  const sameOrderedList = currentLeaf?.type === "list" &&
    currentLeaf.marker === "ordered" && previousLeaf?.type === "list" &&
    previousLeaf.marker === "ordered" &&
    currentLeaf.leadingIndentation === previousLeaf.leadingIndentation &&
    currentLeaf.delimiter === previousLeaf.delimiter &&
    sameBlockContainers(currentParents, previousParents);
  const leavesPreviousContainer = currentLeaf?.type === "list" &&
    currentLeaf.leadingIndentation === 0 &&
    !sameBlockContainers(currentParents, previousContainers);
  const startsListItem = currentLeaf?.type === "list" &&
    (currentLeaf.marker === "unordered" || currentLeaf.start === 1 ||
      sameOrderedList || leavesPreviousContainer);

  let commonContainers = 0;
  while (
    commonContainers < currentContainers.length &&
    commonContainers < previousContainers.length &&
    sameBlockContainer(
      currentContainers[commonContainers]!,
      previousContainers[commonContainers]!,
    )
  ) commonContainers++;
  const startsBlockQuote = currentLeaf?.type === "quote" &&
    currentContainers.slice(commonContainers).some((container) =>
      container.type === "quote"
    );

  return startsListItem || startsBlockQuote ||
    allowsFollowingIndentedCode(previousLine) ||
    /^( {0,3})(`{3,}|~{3,})[ \t]*$/.test(previousLine);
}

/**
 * A reference definition starting at `lineStart`. CommonMark lets the
 * destination sit on the line after the label, so the run of whitespace after
 * the colon may cross one newline but not a blank line, which ends the
 * definition.
 */
function referenceDestinationAt(
  text: string,
  lineStart: number,
):
  | (Destination & {
    label: string;
    labelStart: number;
    definitionEnd: number;
  })
  | undefined {
  const content = blockContent(text, lineStart);
  const labelStart = content.start;
  if (
    isBackslashEscaped(text, labelStart) || text[labelStart + 1] === "^"
  ) return undefined;
  const afterLabel = afterMarkdownLabel(text, labelStart);
  if (afterLabel === undefined || text[afterLabel] !== ":") return undefined;
  const label = text.slice(labelStart + 1, afterLabel - 1);
  if (!isValidReferenceLabel(label)) return undefined;

  let cursor = afterLabel + 1;
  let newlines = 0;
  while (/\s/.test(text[cursor] ?? "")) {
    if (text[cursor] !== "\n") {
      cursor++;
      continue;
    }
    if (++newlines > 1) return undefined;
    cursor = blockContentStart(text, cursor + 1);
  }
  const wrapped = text[cursor] === "<";
  if (wrapped) cursor++;
  const destinationStart = cursor;
  if (wrapped) {
    while (
      cursor < text.length && text[cursor] !== ">" &&
      text[cursor] !== "\n" && text[cursor] !== "\r"
    ) {
      if (text[cursor] === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (text[cursor] === "<") return undefined;
      cursor++;
    }
  } else {
    const destinationEnd = bareMarkdownDestinationEnd(text, cursor);
    if (destinationEnd === undefined) return undefined;
    cursor = destinationEnd;
  }
  const destinationEnd = cursor;
  if (wrapped) {
    if (text[cursor] !== ">") return undefined;
    cursor++;
  }
  const definitionEnd = wrapped || destinationEnd > destinationStart
    ? referenceDefinitionTailEnd(text, cursor, content.containers)
    : undefined;
  return definitionEnd === undefined ? undefined : {
    href: text.slice(destinationStart, destinationEnd),
    offset: destinationStart,
    syntax: "markdown",
    label,
    labelStart,
    definitionEnd,
  };
}

function normalizeReferenceLabel(label: string): string {
  return label
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")
    .replace(/[ \t\r\n]+/g, " ")
    .toLowerCase()
    .toUpperCase();
}

function isValidReferenceLabel(label: string): boolean {
  if ([...label].length > 999 || normalizeReferenceLabel(label) === "") {
    return false;
  }
  for (let cursor = 0; cursor < label.length; cursor++) {
    if (label[cursor] === "\\" && cursor + 1 < label.length) {
      cursor++;
      continue;
    }
    if (label[cursor] === "[" || label[cursor] === "]") return false;
  }
  return true;
}

function afterInlineLink(text: string, start: number): number | undefined {
  if (text[start] !== "(") return undefined;
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    const character = text[cursor]!;
    if (character === "\\") {
      cursor++;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") depth++;
    else if (character === ")") {
      if (depth === 0) return cursor + 1;
      depth--;
    }
  }
  return undefined;
}

interface ReferenceUsage {
  readonly label: string;
  readonly range: Range;
  readonly image: boolean;
  readonly description: Range;
}

function usedReferences(
  text: string,
  ignoredRanges: readonly Range[],
  definitionStarts: ReadonlySet<number>,
): { readonly labels: Set<string>; readonly usages: ReferenceUsage[] } {
  const labels = new Set<string>();
  const usages: ReferenceUsage[] = [];
  for (let start = 0; start < text.length; start++) {
    if (
      text[start] !== "[" || definitionStarts.has(start) ||
      isInsideRange(ignoredRanges, start) || isBackslashEscaped(text, start) ||
      text[start + 1] === "^"
    ) continue;
    const linkStart = start;
    const image = isImageLabel(text, start);
    const afterText = afterMarkdownLabel(text, start);
    if (afterText === undefined) continue;
    if (
      text[afterText] === "(" &&
      markdownInlineDestinationAt(text, start) !== undefined
    ) {
      continue;
    }

    const textLabel = text.slice(start + 1, afterText - 1);
    let label = textLabel;
    if (text[afterText] === "[") {
      const afterReference = afterMarkdownLabel(text, afterText);
      if (afterReference === undefined) continue;
      const explicit = text.slice(afterText + 1, afterReference - 1);
      if (explicit !== "") label = explicit;
      start = afterReference - 1;
    } else {
      start = afterText - 1;
    }
    if (!isValidReferenceLabel(label)) continue;
    const normalized = normalizeReferenceLabel(label);
    labels.add(normalized);
    usages.push({
      label: normalized,
      range: { start: linkStart, end: start + 1 },
      image,
      description: { start: linkStart + 1, end: afterText - 1 },
    });
  }
  return { labels, usages };
}

/** A link destination and where it starts, so an issue can name its line. */
export interface Destination {
  href: string;
  offset: number;
  syntax: DestinationSyntax;
}

function recordDestination(
  found: Destination[],
  offsets: Set<number>,
  destination: Destination,
): void {
  found.push(destination);
  offsets.add(destination.offset);
}

function trimBareAutolink(rawHref: string): string {
  const bracketBoundary = rawHref.search(/\](?=[([])/);
  let end = bracketBoundary === -1 ? rawHref.length : bracketBoundary;
  while (end > 0) {
    const href = rawHref.slice(0, end);
    const characterReference = href.match(/&[A-Za-z]+;$/);
    if (characterReference) {
      end -= characterReference[0].length;
      continue;
    }
    if (/[!*,.:;?_~]/.test(rawHref[end - 1] ?? "")) {
      end--;
      continue;
    }
    if (rawHref[end - 1] === "]") {
      end--;
      continue;
    }
    if (rawHref[end - 1] === ")") {
      const openings = href.split("(").length - 1;
      const closings = href.split(")").length - 1;
      if (closings > openings) {
        end--;
        continue;
      }
    }
    break;
  }
  return rawHref.slice(0, end);
}

function lineEndingEnd(text: string, start: number): number | undefined {
  if (text[start] === "\n") return start + 1;
  if (text[start] !== "\r") return undefined;
  return text[start + 1] === "\n" ? start + 2 : start + 1;
}

function paragraphBreakStart(text: string, start: number): number | undefined {
  const match = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/.exec(
    text.slice(start),
  );
  return match === null ? undefined : start + match.index;
}

function markdownWhitespaceEnd(
  text: string,
  start: number,
): number | undefined {
  let cursor = start;
  let lineEndings = 0;
  while (/\s/.test(text[cursor] ?? "")) {
    const lineEnd = lineEndingEnd(text, cursor);
    if (lineEnd !== undefined) {
      if (++lineEndings > 1) return undefined;
      cursor = lineEnd;
    } else cursor++;
  }
  return cursor;
}

function markdownDestinationCloses(text: string, start: number): boolean {
  let cursor = markdownWhitespaceEnd(text, start);
  if (cursor === undefined) return false;
  if (text[cursor] === ")") return true;

  const opener = text[cursor];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== '"' && opener !== "'" && opener !== "(") return false;
  cursor++;
  while (cursor < text.length) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      if (text[cursor + 1] !== "\n" && text[cursor + 1] !== "\r") {
        cursor += 2;
        continue;
      }
    }
    const nextLineStart = lineEndingEnd(text, cursor);
    if (nextLineStart !== undefined) {
      let nextLineEnd = nextLineStart;
      while (
        nextLineEnd < text.length && text[nextLineEnd] !== "\n" &&
        text[nextLineEnd] !== "\r"
      ) nextLineEnd++;
      if (text.slice(nextLineStart, nextLineEnd).trim() === "") return false;
      cursor = nextLineStart;
      continue;
    }
    if (text[cursor] === closer) break;
    cursor++;
  }
  if (text[cursor] !== closer) return false;
  cursor = markdownWhitespaceEnd(text, cursor + 1);
  if (cursor === undefined) return false;
  return text[cursor] === ")";
}

function markdownDestinationStart(
  text: string,
  start: number,
): number | undefined {
  return markdownWhitespaceEnd(text, start);
}

function bareMarkdownDestinationEnd(
  text: string,
  start: number,
): number | undefined {
  let cursor = start;
  let depth = 0;
  while (cursor < text.length) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (text[cursor] === "(") {
      depth++;
      if (depth > MAX_MARKDOWN_DESTINATION_PARENTHESIS_DEPTH) {
        return undefined;
      }
    } else if (text[cursor] === ")") {
      if (depth === 0) break;
      depth--;
    } else if (/\s/.test(text[cursor]!)) break;
    cursor++;
  }
  return depth === 0 ? cursor : undefined;
}

interface MarkdownInlineDestination {
  readonly href: string;
  readonly offset: number;
  readonly labelStart: number;
  readonly labelEnd: number;
  readonly linkEnd: number;
  readonly tail: Range;
  readonly angle?: Range;
}

function markdownInlineDestinationAt(
  text: string,
  start: number,
): MarkdownInlineDestination | undefined {
  const afterLabel = afterMarkdownLabel(text, start);
  if (afterLabel === undefined || text[afterLabel] !== "(") return undefined;

  let cursor = markdownDestinationStart(text, afterLabel + 1);
  if (cursor === undefined || cursor >= text.length) return undefined;

  let href: string;
  let offset: number;
  let angle: Range | undefined;
  if (text[cursor] === "<") {
    const rangeStart = cursor;
    const destinationStart = ++cursor;
    while (cursor < text.length) {
      if (text[cursor] === "\n" || text[cursor] === "\r") break;
      if (text[cursor] === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (text[cursor] === "<") return undefined;
      if (text[cursor] === ">") break;
      cursor++;
    }
    if (
      text[cursor] !== ">" ||
      !markdownDestinationCloses(text, cursor + 1)
    ) return undefined;
    href = text.slice(destinationStart, cursor);
    offset = destinationStart;
    angle = { start: rangeStart, end: cursor + 1 };
  } else {
    const destinationStart = cursor;
    const destinationEnd = bareMarkdownDestinationEnd(text, cursor);
    if (destinationEnd === undefined) return undefined;
    cursor = destinationEnd;
    if (!markdownDestinationCloses(text, cursor)) return undefined;
    href = text.slice(destinationStart, cursor);
    offset = destinationStart;
  }

  const linkEnd = afterInlineLink(text, afterLabel);
  if (linkEnd === undefined) return undefined;
  return {
    href,
    offset,
    labelStart: start + 1,
    labelEnd: afterLabel - 1,
    linkEnd,
    tail: { start: afterLabel, end: linkEnd },
    angle,
  };
}

function isImageLabel(text: string, start: number): boolean {
  return text[start - 1] === "!" && !isBackslashEscaped(text, start - 1);
}

function containsNestedRenderedLink(
  text: string,
  candidate: MarkdownInlineDestination,
  ignoredRanges: readonly Range[],
  definedLabels: ReadonlySet<string>,
): boolean {
  for (
    let nestedStart = candidate.labelStart;
    nestedStart < candidate.labelEnd;
    nestedStart++
  ) {
    if (
      text[nestedStart] !== "[" || isImageLabel(text, nestedStart) ||
      isBackslashEscaped(text, nestedStart) ||
      isInsideRange(ignoredRanges, nestedStart)
    ) continue;
    const nested = markdownInlineDestinationAt(text, nestedStart);
    if (nested !== undefined && nested.linkEnd <= candidate.labelEnd) {
      return true;
    }
  }

  const labelText = text.slice(candidate.labelStart, candidate.labelEnd);
  const referenceUse = usedReferences(labelText, [], new Set());
  return referenceUse.usages.some((usage) => {
    const usageStart = candidate.labelStart + usage.range.start;
    return definedLabels.has(usage.label) &&
      !isImageLabel(text, usageStart) &&
      !isInsideRange(ignoredRanges, usageStart);
  });
}

/**
 * Every destination in `text`, with its offset.
 *
 * Scanned over the whole document rather than line by line: Markdown lets link
 * text wrap across lines, and lets a reference definition put its destination
 * on the following line. Neither line holds enough syntax on its own, while
 * Mintlify still renders both as links.
 */
export function scanDestinations(
  text: string,
  syntax: DocumentSyntax = "mdx",
  hasFrontmatter = false,
): Destination[] {
  // A scanner is required here because valid Markdown labels can contain
  // balanced brackets or escaped closing brackets.
  const found: Destination[] = [];
  const destinationOffsets = new Set<number>();
  const syntaxRanges = ignoredDestinationRanges(
    text,
    syntax,
    hasFrontmatter,
  );
  const ignoredRanges = syntaxRanges.ignored;
  const tagRanges = htmlTagRanges(
    text,
    ignoredRanges,
    syntaxRanges.expressions,
    syntaxRanges.strings,
  );
  const structuralTagRanges = syntax === "markdown"
    ? tagRanges.filter((range) =>
      commonMarkHtmlTagEnd(text, range.start) === range.end
    )
    : tagRanges;
  const rawHtmlBlocks: RawHtmlBlockBodyRanges = syntax === "markdown"
    ? rawHtmlBlockBodyRanges(text, structuralTagRanges, ignoredRanges)
    : { markdown: [], rawText: [], blocks: [] };
  const structuralMarkdownIgnoredRanges = mergeRanges([
    ...ignoredRanges,
    ...syntaxRanges.expressions,
    ...structuralTagRanges,
    ...rawHtmlBlocks.markdown,
  ]);

  // Parse definitions before rendered links so title text cannot be mistaken
  // for Markdown, HTML, or autolink destinations.
  const references: Array<
    Destination & {
      label: string;
      labelStart: number;
      definitionEnd: number;
    }
  > = [];
  let previousReferenceEnd: number | undefined;
  for (let lineStart = 0; lineStart <= text.length;) {
    const next = text.indexOf("\n", lineStart);
    if (isInsideRange(structuralMarkdownIgnoredRanges, lineStart)) {
      if (next === -1) break;
      lineStart = next + 1;
      continue;
    }
    const previousLineEnd = text[lineStart - 2] === "\r"
      ? lineStart - 2
      : lineStart - 1;
    const followsCodeBlock = previousLineEnd > 0 &&
      isInsideRange(syntaxRanges.code, previousLineEnd - 1);
    const followsHtmlComment = followsClosedHtmlCommentBlock(
      text,
      lineStart,
      syntaxRanges.htmlComments,
    );
    const followsHtmlBlock = followsCompletedHtmlBlock(
      lineStart,
      rawHtmlBlocks.blocks,
    );
    const reference = followsCodeBlock || followsHtmlComment ||
        followsHtmlBlock ||
        referenceDefinitionMayStart(
          text,
          lineStart,
          previousReferenceEnd,
        )
      ? referenceDestinationAt(text, lineStart)
      : undefined;
    if (reference) {
      references.push(reference);
      previousReferenceEnd = reference.definitionEnd;
    }
    if (next === -1) break;
    lineStart = next + 1;
  }
  const referenceDefinitionRanges = references.map((reference) => ({
    start: reference.labelStart,
    end: reference.definitionEnd,
  }));
  const definedLabels = new Set<string>();
  for (const reference of references) {
    definedLabels.add(normalizeReferenceLabel(reference.label));
  }
  const markdownIgnoredRanges = mergeRanges([
    ...structuralMarkdownIgnoredRanges,
    ...referenceDefinitionRanges,
  ]);
  const markdownAngleDestinationRanges: Range[] = [];
  const markdownImageLabelRanges: Range[] = [];
  const markdownLinkRanges: Range[] = [];
  const markdownLinkTailRanges: Range[] = [];
  for (let start = 0; start < text.length; start++) {
    if (
      isInsideRange(markdownIgnoredRanges, start) ||
      markdownLinkTailRanges.some((range) =>
        start >= range.start && start < range.end
      ) ||
      isBackslashEscaped(text, start)
    ) continue;
    const candidate = markdownInlineDestinationAt(text, start);
    if (candidate === undefined) continue;
    markdownLinkTailRanges.push(candidate.tail);
    const image = isImageLabel(text, start);
    if (
      !image && containsNestedRenderedLink(
        text,
        candidate,
        markdownIgnoredRanges,
        definedLabels,
      )
    ) {
      continue;
    }
    if (candidate.angle !== undefined) {
      markdownAngleDestinationRanges.push(candidate.angle);
    }
    if (candidate.href !== "") {
      recordDestination(found, destinationOffsets, {
        href: candidate.href,
        offset: candidate.offset,
        syntax: "markdown",
      });
    }
    markdownLinkRanges.push({ start, end: candidate.linkEnd });
    if (image) {
      markdownImageLabelRanges.push({
        start: candidate.labelStart,
        end: candidate.labelEnd,
      });
      start = candidate.linkEnd - 1;
    }
  }

  const referenceUse = usedReferences(
    text,
    mergeRanges([
      ...markdownIgnoredRanges,
      ...markdownImageLabelRanges,
      ...markdownLinkTailRanges,
    ]),
    new Set(references.map((reference) => reference.labelStart)),
  );
  markdownImageLabelRanges.push(
    ...referenceUse.usages
      .filter((usage) => usage.image && definedLabels.has(usage.label))
      .map((usage) => usage.description),
  );
  const markdownImageLabelLookupRanges = mergeRanges(
    markdownImageLabelRanges,
  );

  for (const tagRange of tagRanges) {
    if (
      isInsideRange(referenceDefinitionRanges, tagRange.start) ||
      isInsideRange(markdownImageLabelLookupRanges, tagRange.start) ||
      isInsideRange(rawHtmlBlocks.rawText, tagRange.start)
    ) continue;
    const tag = text.slice(tagRange.start, tagRange.end);
    const topLevelOffsets = topLevelTagOffsets(tag);
    const htmlDestination = new RegExp(
      HTML_DESTINATION_ATTRIBUTE_SOURCE,
      "gi",
    );
    let htmlMatch: RegExpExecArray | null;
    while ((htmlMatch = htmlDestination.exec(tag))) {
      if (!topLevelOffsets.has(htmlMatch.index)) continue;
      const expressionStart = htmlMatch[3] === undefined
        ? undefined
        : htmlMatch.index + htmlMatch[0].lastIndexOf("{") + 1;
      const expression = expressionStart === undefined
        ? undefined
        : staticJsxStringExpression(tag, expressionStart);
      const rawHref = htmlMatch[1] ?? htmlMatch[2] ?? expression?.value;
      if (rawHref === undefined) continue;
      const href = expressionStart !== undefined
        ? decodeJavaScriptStringLiteral(rawHref)
        : rawHref;
      if (href === undefined) continue;
      const offset = expression?.offset ??
        htmlMatch.index + htmlMatch[0].lastIndexOf(rawHref);
      recordDestination(found, destinationOffsets, {
        href,
        offset: tagRange.start + offset,
        syntax: expressionStart === undefined
          ? "html-attribute"
          : "javascript-string",
      });
    }
    if (syntax === "markdown") {
      const unquotedDestination = new RegExp(
        MARKDOWN_UNQUOTED_DESTINATION_ATTRIBUTE_SOURCE,
        "gi",
      );
      while ((htmlMatch = unquotedDestination.exec(tag))) {
        if (!topLevelOffsets.has(htmlMatch.index)) continue;
        const href = htmlMatch[1]!;
        recordDestination(found, destinationOffsets, {
          href,
          offset: tagRange.start + htmlMatch.index +
            htmlMatch[0].lastIndexOf(href),
          syntax: "html-attribute",
        });
      }
    }
  }

  const recordedReferenceLabels = new Set<string>();
  for (const reference of references) {
    destinationOffsets.add(reference.offset);
    const label = normalizeReferenceLabel(reference.label);
    if (recordedReferenceLabels.has(label)) continue;
    recordedReferenceLabels.add(label);
    if (reference.href !== "" && referenceUse.labels.has(label)) {
      recordDestination(found, destinationOffsets, reference);
    }
  }

  const renderedLinkRanges = mergeRanges([
    ...markdownLinkRanges,
    ...referenceUse.usages
      .filter((usage) => definedLabels.has(usage.label))
      .map((usage) => usage.range),
  ]);
  const uriAutolinkIgnoredRanges = mergeRanges([
    ...markdownIgnoredRanges,
    ...markdownImageLabelLookupRanges,
    ...markdownLinkTailRanges,
    ...referenceDefinitionRanges,
    ...markdownAngleDestinationRanges,
  ]);
  let autolinkMatch: RegExpExecArray | null;
  while ((autolinkMatch = URI_AUTOLINK_SOURCE.exec(text))) {
    if (
      isInsideRange(uriAutolinkIgnoredRanges, autolinkMatch.index) ||
      isBackslashEscaped(text, autolinkMatch.index)
    ) continue;
    recordDestination(found, destinationOffsets, {
      href: autolinkMatch[1]!,
      offset: autolinkMatch.index + 1,
      syntax: "autolink",
    });
  }
  const bareAutolinkIgnoredRanges = mergeRanges([
    ...markdownIgnoredRanges,
    ...markdownImageLabelLookupRanges,
    ...renderedLinkRanges,
    ...referenceDefinitionRanges,
  ]);

  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = BARE_AUTOLINK_SOURCE.exec(text))) {
    const offset = bareMatch.index;
    if (
      /[A-Za-z]/.test(text[offset - 1] ?? "") ||
      text[offset - 1] === "<" || destinationOffsets.has(offset) ||
      isInsideRange(bareAutolinkIgnoredRanges, offset)
    ) continue;
    const href = trimBareAutolink(bareMatch[0]);
    if (href !== "") {
      recordDestination(found, destinationOffsets, {
        href,
        offset,
        syntax: "autolink",
      });
    }
  }

  return found;
}

export function destinations(text: string): string[] {
  return scanDestinations(text).map((destination) => destination.href);
}

/** 1-indexed line holding `offset`. */
function lineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const starts: number[] = [0];
  for (const line of lines.slice(0, -1)) {
    starts.push(starts[starts.length - 1]! + line.length + 1);
  }
  return starts;
}

export function collectUnpublishedLinkIssues(
  path: string,
  content: string,
  stat: (path: string) => { readonly isFile: boolean } = Deno.statSync,
): PublicDocIssue[] {
  if (path !== "README.md" && !isPublishedPage(path)) return [];

  const lines = content.split("\n");
  const lineStarts = lineStartOffsets(lines);
  const documentSyntax = path.endsWith(".mdx") ? "mdx" : "markdown";

  const issues: PublicDocIssue[] = [];
  for (
    const { href, offset, syntax } of scanDestinations(
      content,
      documentSyntax,
      path !== "README.md",
    )
  ) {
    const target = resolveDocumentationTarget(path, href, syntax);
    if (path === "README.md" && !target?.startsWith("docs/")) continue;
    if (target === undefined || publishedTargetExists(target, stat)) continue;
    const line = lineAt(lineStarts, offset);
    issues.push({
      path,
      line,
      message:
        `Do not link published docs to ${target}. veryfront-docs publishes only ${
          SYNCED_DOC_DIRS.join(", ")
        }, and drops each section README, so this link 404s on the site.`,
      text: lines[line - 1]!.trim(),
    });
  }
  return issues;
}

const MOVED_GETTING_STARTED_PAGES = [
  "quickstart",
  "cloud-quickstart",
  "installation",
  "create-project",
  "create-agent",
  "create-api",
  "create-frontend",
  "deploy-project",
  "veryfront-code",
];

const staleGettingStartedPath = new RegExp(
  String.raw`(?:https://veryfront\.com)?/docs/code/guides/(?:${
    MOVED_GETTING_STARTED_PAGES.join("|")
  })\b`,
);

const DEFAULT_BLOCKED_REPOSITORY = "veryfront/veryfront-examples";

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RepositoryRule extends Rule {
  matches(text: string): boolean;
}

function blockedRepositoryRule(repository: string): RepositoryRule {
  const escapedRepository = escapeRegularExpression(repository);
  const repositoryUrl = String
    .raw`(?:(?:https?:\/\/)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)${escapedRepository}(?:\.git)?`;
  const trailingBoundary = String
    .raw`(?:$|[/#?\s)>\],;:'"!]|[.](?=\s|$))`;
  const pattern = new RegExp(
    String.raw`(?:^|[\s("'=<])${repositoryUrl}(?=${trailingBoundary})`,
    "i",
  );
  const emphasizedPattern = new RegExp(
    String
      .raw`(?:^|[\s("'=<])(\*+|_+|~{1,2})${repositoryUrl}\1(?=${trailingBoundary})`,
    "i",
  );
  return {
    pattern,
    matches: (text) => pattern.test(text) || emphasizedPattern.test(text),
    message:
      `${repository} is a private repository. A reader following this link gets a 404, so link a public example or inline the code instead.`,
  };
}

function canonicalizeHttpUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"'`]+/gi, (rawUrl) => {
    const suffix = rawUrl.match(/[),.;:!?]+$/)?.[0] ?? "";
    const candidate = rawUrl.slice(0, rawUrl.length - suffix.length);
    try {
      const url = new URL(candidate);
      const pathname = decodeUrlPathForRepositoryMatch(url.pathname);
      return `${url.protocol}//${url.host}${pathname}${url.search}${url.hash}${suffix}`;
    } catch {
      return rawUrl;
    }
  });
}

const RULES: Rule[] = [
  {
    pattern: /\u2013|\u2014/,
    message:
      "Use ASCII punctuation in public docs. Replace en dash or em dash with '-' or punctuation.",
  },
  {
    pattern: /#veryfront\//,
    message: "Do not expose internal #veryfront imports in public docs.",
  },
  {
    pattern: /\{@[A-Za-z]/,
    message:
      "Do not publish raw inline JSDoc tags. Regenerate the API reference after changing source JSDoc or the generator.",
  },
  {
    pattern: /_test-setup/,
    message: "Do not expose test-only setup modules in public docs.",
  },
  {
    pattern: /\bInternal utilities\b/,
    message: "Do not describe public API pages as internal utilities.",
  },
  {
    pattern: /\bdeep-import-only\b/,
    message:
      "Do not expose implementation-only import taxonomy in public docs.",
  },
  {
    pattern: /\bmini tutorial\b/i,
    message:
      "Do not describe how-to guides as mini tutorials. Keep Diataxis tutorial and guide modes distinct.",
  },
  {
    pattern: /\bUse this module\b/,
    message:
      "Describe API reference modules neutrally. Do not use instructional 'Use this module' phrasing.",
  },
  {
    pattern: /\btask and concept guides\b/i,
    message:
      "Keep guides task-oriented. Use 'task guides and decision guides' instead of concept guide wording.",
  },
  {
    pattern: staleGettingStartedPath,
    message: "Use /docs/code/getting-started/ for moved Getting Started pages.",
  },
  {
    pattern: /Ready on\s+`?\[?https?:\/\//i,
    message:
      "veryfront dev prints a '✓ Ready in <duration>' line followed by the URL on its own line. Do not document a 'Ready on <url>' line the CLI never prints.",
  },
];

/**
 * Rules that must survive prose wrapping, so they run against a line joined
 * with the one after it.
 *
 * The pattern below is deliberately byte-identical to the wrapped rule in
 * veryfront-docs' `scripts/check-code-docs-quality.mjs`. This validator exists
 * to predict that one, so narrowing the pattern here alone would let a page
 * pass in this repo and still fail the sync downstream, which is the exact
 * silent breakage this check was added to prevent. It is broad enough to reject
 * an accurate sentence about `--verbose` output; phrase such a sentence around
 * what the flag lists rather than what the server "prints", or change both
 * repositories in the same change.
 */
const WRAPPED_RULES: Rule[] = [
  {
    pattern:
      /printed MCP (?:endpoint|URL|address)|prints the MCP (?:endpoint|URL|address)/i,
    message:
      "`veryfront dev` does not print the MCP endpoint by default. State the address instead: two ports above the port the dev server bound (3002 for the default 3000), path `/mcp`.",
  },
];

interface CoverageRequirement {
  label: string;
  pattern: RegExp;
}

interface CoveragePage {
  path: string;
  requirements: CoverageRequirement[];
}

/**
 * Veryfront Cloud seeds production, staging, and preview as protected
 * environments, so an anonymous request to a fresh deployment is redirected to
 * the Veryfront sign-in page instead of the app. Every page that tells a reader
 * to deploy has to say so, or the reader ships a URL nobody else can open.
 *
 * These mirror the deploy-access coverage checks veryfront-docs runs against
 * the synced `docs/code/**` tree. Keeping them here as well means a PR that
 * drops the coverage fails in this repo, instead of silently breaking the docs
 * sync in a downstream repository nobody is watching.
 */
const DEPLOY_ACCESS_COVERAGE: CoveragePage[] = [
  {
    path: "docs/getting-started/cloud-quickstart.md",
    requirements: [
      {
        label:
          "state that Veryfront Cloud environments are protected by default",
        pattern: /protected by default/i,
      },
    ],
  },
  {
    path: "docs/getting-started/deploy-project.md",
    requirements: [
      {
        label:
          "state that Veryfront Cloud environments are protected by default",
        pattern: /protected by default/i,
      },
      {
        label: "state that an unauthenticated request is redirected to sign-in",
        pattern: /sign-in/i,
      },
      {
        label:
          "state that VERYFRONT_API_TOKEN does not open a protected environment",
        pattern: /VERYFRONT_API_TOKEN[^.]{0,120}does not open/i,
      },
      {
        label: "name the Studio switch that makes an environment public",
        pattern: /Public Environment/,
      },
    ],
  },
  {
    path: "docs/guides/deploying.md",
    requirements: [
      {
        label:
          "state that Veryfront Cloud environments are protected by default",
        pattern: /protected by default/i,
      },
      {
        label: "name the Studio switch that makes an environment public",
        pattern: /Public Environment/,
      },
    ],
  },
];

/**
 * `veryfront dev` prints `http://localhost:<port>` and no other URL. Pages
 * that run the dev server and then tell the reader to open the app must name
 * that host, or the reader hits a banner that matches nothing in the doc.
 */
const PRINTED_DEV_SERVER_URL = "http://localhost:3000";
const DEV_SERVER_PAGES = [
  "docs/getting-started/quickstart.md",
  "docs/getting-started/cloud-quickstart.md",
  "docs/getting-started/create-project.md",
];

async function* walkMarkdownFiles(path: string): AsyncGenerator<string> {
  const absolute = `${ROOT}/${path}`;
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(absolute);
  } catch {
    return;
  }

  if (stat.isFile) {
    if (path.endsWith(".md") || path.endsWith(".mdx")) {
      yield path;
    }
    return;
  }

  if (!stat.isDirectory) return;

  for await (const entry of Deno.readDir(absolute)) {
    if (entry.name.startsWith(".")) continue;
    yield* walkMarkdownFiles(`${path}/${entry.name}`);
  }
}

export function collectIssues(
  path: string,
  content: string,
  blockedRepository = DEFAULT_BLOCKED_REPOSITORY,
): PublicDocIssue[] {
  const issues: PublicDocIssue[] = [];
  const repositoryRule = blockedRepositoryRule(blockedRepository);
  const lines = content.split("\n");
  const lineStarts = lineStartOffsets(lines);
  const documentSyntax = path.endsWith(".mdx") ? "mdx" : "markdown";
  const blockedDestinationLines = new Set<number>();
  for (
    const destination of scanDestinations(
      content,
      documentSyntax,
      path !== "README.md",
    )
  ) {
    if (
      repositoryRule.matches(destination.href) ||
      repositoryRule.matches(canonicalizeHttpUrls(destination.href))
    ) {
      blockedDestinationLines.add(lineAt(lineStarts, destination.offset));
    }
  }
  for (const [index, text] of lines.entries()) {
    const renderedText = decodeMarkdownBackslashEscapes(
      decodeMarkdownCharacterReferences(text),
    );
    for (const rule of RULES) {
      if (!rule.pattern.test(renderedText)) continue;
      issues.push({
        path,
        line: index + 1,
        message: rule.message,
        text,
      });
    }
    const canonicalText = canonicalizeHttpUrls(renderedText);
    if (
      repositoryRule.matches(renderedText) ||
      repositoryRule.matches(canonicalText) ||
      blockedDestinationLines.has(index + 1)
    ) {
      issues.push({
        path,
        line: index + 1,
        message: repositoryRule.message,
        text,
      });
    }
  }

  for (const rule of WRAPPED_RULES) {
    const hit = lines.findIndex((line, index) =>
      rule.pattern.test(
        `${line} ${lines[index + 1] ?? ""}`.replace(/\s+/g, " "),
      )
    );
    if (hit === -1) continue;
    issues.push({
      path,
      line: hit + 1,
      message: rule.message,
      text: lines[hit].trim(),
    });
  }

  return issues;
}

async function collectCoverageIssues(): Promise<PublicDocIssue[]> {
  const issues: PublicDocIssue[] = [];

  for (const page of DEPLOY_ACCESS_COVERAGE) {
    const content = await Deno.readTextFile(`${ROOT}/${page.path}`);
    const flattened = content.replace(/\s+/g, " ");
    for (const requirement of page.requirements) {
      if (requirement.pattern.test(flattened)) continue;
      issues.push({
        path: page.path,
        line: 1,
        message: `Deploy pages must ${requirement.label}.`,
        text: String(requirement.pattern),
      });
    }
  }

  for (const page of DEV_SERVER_PAGES) {
    const content = await Deno.readTextFile(`${ROOT}/${page}`);
    if (content.includes(PRINTED_DEV_SERVER_URL)) continue;
    issues.push({
      path: page,
      line: 1,
      message:
        `\`veryfront dev\` prints ${PRINTED_DEV_SERVER_URL}. Show that URL before sending the reader to the app.`,
      text: "Missing the dev server URL the CLI prints.",
    });
  }

  return issues;
}

// Code-unit order, not locale order: the file list is reported verbatim.
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function main(): Promise<void> {
  const files = new Set<string>();
  for (const root of PUBLIC_DOC_ROOTS) {
    for await (const file of walkMarkdownFiles(root)) {
      files.add(file);
    }
  }

  const issues: PublicDocIssue[] = [];
  const sortedFiles = [...files].sort(compareCodeUnits);
  for (const file of sortedFiles) {
    const content = await Deno.readTextFile(`${ROOT}/${file}`);
    issues.push(...collectIssues(file, content));
    issues.push(...collectUnpublishedLinkIssues(file, content));
  }
  issues.push(...await collectCoverageIssues());

  if (issues.length === 0) {
    console.log(`Validated public docs quality across ${files.size} file(s).`);
    return;
  }

  console.error(`${issues.length} public docs quality issue(s) found:\n`);
  for (const issue of issues.slice(0, 60)) {
    console.error(`${issue.path}:${issue.line}: ${issue.message}`);
    console.error(`  ${issue.text}`);
  }
  if (issues.length > 60) {
    console.error(`... ${issues.length - 60} more issue(s) omitted.`);
  }
  Deno.exit(1);
}

if (import.meta.main) await main();
