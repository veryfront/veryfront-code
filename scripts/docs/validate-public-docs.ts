#!/usr/bin/env -S deno run --allow-read
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
 * Mintlify renders these pages as MDX, so a raw anchor is a working link on
 * the site and has to clear the same boundary. Both a quoted attribute and a
 * JSX expression wrapping a string literal name a destination the reader can
 * load; a genuinely dynamic attribute has no literal to check.
 */
const HTML_DESTINATION_ATTRIBUTE_SOURCE =
  /(?:^|\s)(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*((?:\(\s*)*)"((?:\\[\s\S]|[^"\\])*)"((?:\s*\))*)\s*\}|\{\s*((?:\(\s*)*)'((?:\\[\s\S]|[^'\\])*)'((?:\s*\))*)\s*\}|\{\s*((?:\(\s*)*)`((?:\\[\s\S]|\$(?!\{)|[^`\\$])*)`((?:\s*\))*)\s*\})/;
const URI_AUTOLINK_SOURCE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g;
const BARE_AUTOLINK_SOURCE = /https?:\/\/[^\s<>"']+/gi;
type DestinationSyntax =
  | "markdown"
  | "autolink"
  | "html-attribute"
  | "javascript-string";
/** Any origin works: only the resolved path is read back out. */
const RESOLUTION_ORIGIN = "https://docs.invalid";
const VERYFRONT_DOCS_HOSTNAME = "veryfront.com";
const VERYFRONT_CODE_DOCS_PREFIX = "/docs/code/";
const VERYFRONT_SITE_CODE_PREFIX = "/code/";
const MARKDOWN_URL_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  colon: ":",
  period: ".",
  sol: "/",
  bsol: "\\",
  num: "#",
  quest: "?",
  equals: "=",
  percnt: "%",
  plus: "+",
  commat: "@",
};
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
      if (named !== undefined) return MARKDOWN_URL_ENTITIES[named] ?? reference;
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

function normalizeRepositoryPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname
      .replace(/%2e/gi, ".")
      .replace(/%2f/gi, "/")
      .replace(/%5c/gi, "\\");
  }
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
  if (/^(?:#|["'])/.test(href)) return undefined;
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

function afterMarkdownLabel(text: string, start: number): number | undefined {
  if (text[start] !== "[") return undefined;

  let cursor = start + 1;
  let depth = 1;
  while (cursor < text.length && depth > 0) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += 2;
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
    const paragraphBreak = text.slice(cursor + length).search(
      /\r?\n[ \t]*\r?\n/,
    );
    const paragraphLimit = paragraphBreak === -1
      ? text.length
      : cursor + length + paragraphBreak;
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

function quotedRangeEnd(
  text: string,
  start: number,
  quote: '"' | "'" | "`",
): number | undefined {
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    if (text[cursor] === "\\") cursor++;
    else if (text[cursor] === quote) return cursor + 1;
  }
  return undefined;
}

function javascriptCommentEnd(text: string, start: number): number | undefined {
  if (text.startsWith("//", start)) {
    const newline = text.indexOf("\n", start + 2);
    return newline === -1 ? text.length : newline + 1;
  }
  if (text.startsWith("/*", start)) {
    const closing = text.indexOf("*/", start + 2);
    return closing === -1 ? text.length : closing + 2;
  }
  return undefined;
}

function mdxExpressionAt(
  text: string,
  start: number,
): { readonly expression: Range; readonly strings: Range[] } | undefined {
  const strings: Range[] = [];
  let depth = 1;
  let cursor = start + 1;
  while (cursor < text.length) {
    const commentEnd = javascriptCommentEnd(text, cursor);
    if (commentEnd !== undefined) {
      cursor = commentEnd;
      continue;
    }
    const character = text[cursor]!;
    if (character === '"' || character === "'" || character === "`") {
      const end = quotedRangeEnd(text, cursor, character);
      if (end === undefined) return undefined;
      strings.push({ start: cursor, end });
      cursor = end;
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      return { expression: { start, end: cursor + 1 }, strings };
    }
    cursor++;
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
      const closing = text.indexOf("*/}", cursor + 3);
      if (closing === -1) break;
      const end = closing + 3;
      comments.push({ start: cursor, end });
      cursor = end;
      continue;
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

function moduleStatementContinues(line: string): boolean {
  const source = line.trimEnd();
  return /(?:^|\s)(?:import|export|from|default)\s*$/.test(source) ||
    /(?:=>|[=,:.?+\-*/%&|^!~<>({[\\])$/.test(source);
}

function mdxEsmStatementEnd(text: string, start: number): number {
  let quote: '"' | "'" | "`" | undefined;
  let blockComment = false;
  let depth = 0;
  let lineStart = start;
  for (let cursor = start; cursor < text.length; cursor++) {
    const character = text[cursor]!;
    if (blockComment) {
      if (text.startsWith("*/", cursor)) {
        blockComment = false;
        cursor++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (character === "\\") cursor++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (text.startsWith("//", cursor)) {
      const newline = text.indexOf("\n", cursor + 2);
      cursor = newline === -1 ? text.length : newline - 1;
      continue;
    }
    if (text.startsWith("/*", cursor)) {
      blockComment = true;
      cursor++;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (
      (character === ")" || character === "]" || character === "}") &&
      depth > 0
    ) {
      depth--;
    } else if (character === "\n") {
      const line = text.slice(lineStart, cursor).replace(/\r$/, "");
      if (depth === 0 && !moduleStatementContinues(line)) return cursor;
      lineStart = cursor + 1;
    }
  }
  return text.length;
}

function mdxEsmRanges(
  text: string,
  codeRanges: readonly Range[],
): Range[] {
  const ranges: Range[] = [];
  for (let lineStart = 0; lineStart <= text.length;) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    if (
      !isInsideRange(codeRanges, lineStart) &&
      /^ {0,3}(?:import(?:\s+(?:["'`A-Za-z_$]|[{*]))|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|[{*]))/
        .test(
          text.slice(lineStart, lineEnd).replace(/\r$/, ""),
        )
    ) {
      const end = mdxEsmStatementEnd(text, lineStart);
      ranges.push({ start: lineStart, end });
      if (end >= text.length) break;
      lineStart = end + 1;
      continue;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return ranges;
}

function ignoredDestinationRanges(text: string): {
  readonly ignored: Range[];
  readonly code: Range[];
  readonly expressions: Range[];
  readonly strings: Range[];
} {
  const codeRanges = markdownCodeRanges(text);
  const esmRanges = mdxEsmRanges(text, codeRanges);
  const mdxRanges = mdxSyntaxRanges(
    text,
    mergeRanges([...codeRanges, ...esmRanges]),
  );
  return {
    ignored: mergeRanges([...codeRanges, ...mdxRanges.comments, ...esmRanges]),
    code: codeRanges,
    expressions: mdxRanges.expressions,
    strings: mdxRanges.strings,
  };
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

    let quote: '"' | "'" | "`" | undefined;
    let expressionDepth = 0;
    let cursor = start + 2;
    for (; cursor < text.length; cursor++) {
      const character = text[cursor]!;
      if (quote !== undefined) {
        if (character === "\\") cursor++;
        else if (character === quote) quote = undefined;
        continue;
      }
      const commentEnd = expressionDepth > 0
        ? javascriptCommentEnd(text, cursor)
        : undefined;
      if (commentEnd !== undefined) {
        cursor = commentEnd - 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") expressionDepth++;
      else if (character === "}" && expressionDepth > 0) expressionDepth--;
      else if (character === ">" && expressionDepth === 0) break;
    }
    if (text[cursor] === ">") {
      ranges.push({ start, end: cursor + 1 });
      start = cursor + 1;
    } else break;
  }
  return ranges;
}

function topLevelTagOffsets(tag: string): ReadonlySet<number> {
  const offsets = new Set<number>();
  let quote: '"' | "'" | "`" | undefined;
  let expressionDepth = 0;
  for (let cursor = 0; cursor < tag.length; cursor++) {
    const character = tag[cursor]!;
    if (quote !== undefined) {
      if (character === "\\") cursor++;
      else if (character === quote) quote = undefined;
      continue;
    }
    const commentEnd = expressionDepth > 0
      ? javascriptCommentEnd(tag, cursor)
      : undefined;
    if (commentEnd !== undefined) {
      cursor = commentEnd - 1;
      continue;
    }
    if (expressionDepth === 0) offsets.add(cursor);
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") expressionDepth++;
    else if (character === "}" && expressionDepth > 0) expressionDepth--;
  }
  return offsets;
}

function referenceDefinitionTailEnd(
  text: string,
  start: number,
): number | undefined {
  let cursor = start;
  let hasSeparation = false;
  while (text[cursor] === " " || text[cursor] === "\t") {
    hasSeparation = true;
    cursor++;
  }
  if (
    cursor >= text.length || text[cursor] === "\n" ||
    text[cursor] === "\r"
  ) return cursor;
  if (!hasSeparation) return undefined;

  const opener = text[cursor];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== '"' && opener !== "'" && opener !== "(") return undefined;
  cursor++;
  while (cursor < text.length && text[cursor] !== "\n") {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (text[cursor] === closer) break;
    cursor++;
  }
  if (text[cursor] !== closer) return undefined;
  cursor++;
  while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  return cursor >= text.length || text[cursor] === "\n" ||
      text[cursor] === "\r"
    ? cursor
    : undefined;
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
  const labelStart = blockContentStart(text, lineStart);
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
  let destinationDepth = 0;
  while (
    cursor < text.length &&
    (wrapped
      ? text[cursor] !== ">" && text[cursor] !== "\n" &&
        text[cursor] !== "\r"
      : !/\s/.test(text[cursor]!))
  ) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (!wrapped && text[cursor] === "(") destinationDepth++;
    else if (!wrapped && text[cursor] === ")") {
      if (destinationDepth === 0) break;
      destinationDepth--;
    }
    cursor++;
  }
  const destinationEnd = cursor;
  if (!wrapped && destinationDepth !== 0) return undefined;
  if (wrapped) {
    if (text[cursor] !== ">") return undefined;
    cursor++;
  }
  const definitionEnd = destinationEnd > destinationStart
    ? referenceDefinitionTailEnd(text, cursor)
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
  return decodeMarkdownBackslashEscapes(
    decodeMarkdownCharacterReferences(label),
  ).trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
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
    const afterText = afterMarkdownLabel(text, start);
    if (afterText === undefined) continue;
    if (text[afterText] === "(") {
      start = (afterInlineLink(text, afterText) ?? afterText) - 1;
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

function markdownDestinationCloses(text: string, start: number): boolean {
  let cursor = start;
  let newlines = 0;
  while (/\s/.test(text[cursor] ?? "")) {
    if (text[cursor] === "\n" && ++newlines > 1) return false;
    cursor++;
  }
  if (text[cursor] === ")") return true;

  const opener = text[cursor];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== '"' && opener !== "'" && opener !== "(") return false;
  cursor++;
  while (cursor < text.length) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (text[cursor] === closer) break;
    cursor++;
  }
  if (text[cursor] !== closer) return false;
  cursor++;
  while (/\s/.test(text[cursor] ?? "")) cursor++;
  return text[cursor] === ")";
}

function markdownDestinationStart(
  text: string,
  start: number,
): number | undefined {
  let cursor = start;
  let newlines = 0;
  while (/\s/.test(text[cursor] ?? "")) {
    if (text[cursor] === "\n" && ++newlines > 1) return undefined;
    cursor++;
  }
  return cursor;
}

/**
 * Every destination in `text`, with its offset.
 *
 * Scanned over the whole document rather than line by line: Markdown lets link
 * text wrap across lines, and lets a reference definition put its destination
 * on the following line. Neither line holds enough syntax on its own, while
 * Mintlify still renders both as links.
 */
export function scanDestinations(text: string): Destination[] {
  // A scanner is required here because valid Markdown labels can contain
  // balanced brackets or escaped closing brackets.
  const found: Destination[] = [];
  const destinationOffsets = new Set<number>();
  const syntaxRanges = ignoredDestinationRanges(text);
  const ignoredRanges = syntaxRanges.ignored;
  const tagRanges = htmlTagRanges(
    text,
    ignoredRanges,
    syntaxRanges.expressions,
    syntaxRanges.strings,
  );
  const markdownIgnoredRanges = mergeRanges([
    ...ignoredRanges,
    ...syntaxRanges.expressions,
    ...tagRanges,
  ]);
  const markdownAngleDestinationRanges: Range[] = [];
  const markdownLinkRanges: Range[] = [];
  for (let start = 0; start < text.length; start++) {
    if (
      isInsideRange(markdownIgnoredRanges, start) ||
      isBackslashEscaped(text, start)
    ) continue;
    const afterLabel = afterMarkdownLabel(text, start);
    if (afterLabel === undefined || text[afterLabel] !== "(") continue;
    const linkStart = start;

    let cursor = markdownDestinationStart(text, afterLabel + 1);
    if (cursor === undefined || cursor >= text.length) continue;

    if (text[cursor] === "<") {
      const rangeStart = cursor;
      const destinationStart = ++cursor;
      while (cursor < text.length) {
        if (text[cursor] === "\n" || text[cursor] === "\r") break;
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
          cursor += 2;
          continue;
        }
        if (text[cursor] === ">") break;
        cursor++;
      }
      if (
        text[cursor] === ">" && cursor > destinationStart &&
        markdownDestinationCloses(text, cursor + 1)
      ) {
        markdownAngleDestinationRanges.push({
          start: rangeStart,
          end: cursor + 1,
        });
        recordDestination(found, destinationOffsets, {
          href: text.slice(destinationStart, cursor),
          offset: destinationStart,
          syntax: "markdown",
        });
        const linkEnd = afterInlineLink(text, afterLabel);
        if (linkEnd !== undefined) {
          markdownLinkRanges.push({ start: linkStart, end: linkEnd });
        }
      }
      start = cursor;
      continue;
    }

    const destinationStart = cursor;
    let destinationDepth = 0;
    while (cursor < text.length) {
      if (text[cursor] === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (text[cursor] === "(") {
        destinationDepth++;
      } else if (text[cursor] === ")") {
        if (destinationDepth === 0) break;
        destinationDepth--;
      } else if (/\s/.test(text[cursor]!) && destinationDepth === 0) {
        break;
      }
      cursor++;
    }
    if (
      cursor > destinationStart && markdownDestinationCloses(text, cursor)
    ) {
      recordDestination(found, destinationOffsets, {
        href: text.slice(destinationStart, cursor),
        offset: destinationStart,
        syntax: "markdown",
      });
      const linkEnd = afterInlineLink(text, afterLabel);
      if (linkEnd !== undefined) {
        markdownLinkRanges.push({ start: linkStart, end: linkEnd });
      }
    }
    start = cursor;
  }

  for (const tagRange of tagRanges) {
    const tag = text.slice(tagRange.start, tagRange.end);
    const topLevelOffsets = topLevelTagOffsets(tag);
    const htmlDestination = new RegExp(
      HTML_DESTINATION_ATTRIBUTE_SOURCE,
      "gi",
    );
    let htmlMatch: RegExpExecArray | null;
    while ((htmlMatch = htmlDestination.exec(tag))) {
      if (!topLevelOffsets.has(htmlMatch.index)) continue;
      const expression = htmlMatch[4] !== undefined
        ? { opening: htmlMatch[3]!, href: htmlMatch[4], closing: htmlMatch[5]! }
        : htmlMatch[7] !== undefined
        ? { opening: htmlMatch[6]!, href: htmlMatch[7], closing: htmlMatch[8]! }
        : htmlMatch[10] !== undefined
        ? {
          opening: htmlMatch[9]!,
          href: htmlMatch[10],
          closing: htmlMatch[11]!,
        }
        : undefined;
      if (
        expression !== undefined &&
        (expression.opening.match(/\(/g)?.length ?? 0) !==
          (expression.closing.match(/\)/g)?.length ?? 0)
      ) continue;
      const rawHref = htmlMatch[1] ?? htmlMatch[2] ?? expression?.href;
      if (rawHref === undefined) continue;
      const href = expression !== undefined
        ? decodeJavaScriptStringLiteral(rawHref)
        : rawHref;
      if (href === undefined) continue;
      recordDestination(found, destinationOffsets, {
        href,
        offset: tagRange.start + htmlMatch.index +
          htmlMatch[0].lastIndexOf(rawHref),
        syntax: expression === undefined
          ? "html-attribute"
          : "javascript-string",
      });
    }
  }

  // A reference definition is only a definition at the start of a line, and
  // only participates in rendering when a link uses its normalized label.
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
    if (isInsideRange(markdownIgnoredRanges, lineStart)) {
      if (next === -1) break;
      lineStart = next + 1;
      continue;
    }
    const previousLineEnd = text[lineStart - 2] === "\r"
      ? lineStart - 2
      : lineStart - 1;
    const followsCodeBlock = previousLineEnd > 0 &&
      isInsideRange(syntaxRanges.code, previousLineEnd - 1);
    const reference = followsCodeBlock || referenceDefinitionMayStart(
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
  const referenceUse = usedReferences(
    text,
    markdownIgnoredRanges,
    new Set(references.map((reference) => reference.labelStart)),
  );
  const definedLabels = new Set<string>();
  for (const reference of references) {
    destinationOffsets.add(reference.offset);
    const label = normalizeReferenceLabel(reference.label);
    if (definedLabels.has(label)) continue;
    definedLabels.add(label);
    if (referenceUse.labels.has(label)) {
      recordDestination(found, destinationOffsets, reference);
    }
  }

  const renderedLinkRanges = mergeRanges([
    ...markdownLinkRanges,
    ...referenceUse.usages
      .filter((usage) => definedLabels.has(usage.label))
      .map((usage) => usage.range),
  ]);
  const referenceDefinitionRanges = references.map((reference) => ({
    start: reference.labelStart,
    end: reference.definitionEnd,
  }));
  const uriAutolinkIgnoredRanges = mergeRanges([
    ...markdownIgnoredRanges,
    ...renderedLinkRanges,
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

export function collectUnpublishedLinkIssues(
  path: string,
  content: string,
  stat: (path: string) => { readonly isFile: boolean } = Deno.statSync,
): PublicDocIssue[] {
  if (path !== "README.md" && !isPublishedPage(path)) return [];

  const lines = content.split("\n");
  const lineStarts: number[] = [0];
  for (const line of lines.slice(0, -1)) {
    lineStarts.push(lineStarts[lineStarts.length - 1]! + line.length + 1);
  }

  const issues: PublicDocIssue[] = [];
  for (const { href, offset, syntax } of scanDestinations(content)) {
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

function blockedRepositoryRule(repository: string): Rule {
  const escapedRepository = escapeRegularExpression(repository);
  return {
    pattern: new RegExp(
      String
        .raw`(?:^|[\s("'=<])(?:(?:https?:\/\/)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)${escapedRepository}(?:\.git)?(?=$|[/#?\s)>\],;:'"!]|[.](?=\s|$))`,
      "i",
    ),
    message:
      `${repository} is a private repository. A reader following this link gets a 404, so link a public example or inline the code instead.`,
  };
}

function canonicalHttpUrls(text: string): string[] {
  const urls: string[] = [];
  const candidates = /https?:\/\/[^\s<>"'`]+/gi;
  let match: RegExpExecArray | null;
  while ((match = candidates.exec(text))) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === "http:" || url.protocol === "https:") {
        urls.push(url.href);
      }
    } catch {
      // Ignore URL-shaped prose that a browser cannot resolve.
    }
  }
  return urls;
}

function matchesBlockedRepository(text: string, rule: Rule): boolean {
  return rule.pattern.test(text) ||
    canonicalHttpUrls(text).some((url) => rule.pattern.test(url));
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
  const repositoryIssueLines = new Set<number>();
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
    if (matchesBlockedRepository(renderedText, repositoryRule)) {
      repositoryIssueLines.add(index + 1);
      issues.push({
        path,
        line: index + 1,
        message: repositoryRule.message,
        text,
      });
    }
  }

  const lineStarts = [0];
  for (let offset = 0; offset < content.length; offset++) {
    if (content[offset] === "\n") lineStarts.push(offset + 1);
  }
  for (const destination of scanDestinations(content)) {
    if (!matchesBlockedRepository(destination.href, repositoryRule)) continue;
    const line = lineAt(lineStarts, destination.offset);
    if (repositoryIssueLines.has(line)) continue;
    repositoryIssueLines.add(line);
    issues.push({
      path,
      line,
      message: repositoryRule.message,
      text: lines[line - 1]!,
    });
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
