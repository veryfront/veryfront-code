/**
 * Small, non-decoding HTML lexical helpers shared by server-side rewriters.
 *
 * These helpers deliberately preserve source text and do not attempt to build
 * a DOM. They recognize quoted attribute values, comments, and raw-text tag
 * boundaries so rewriters do not mistake markup-shaped text for real tags.
 */

export interface ParsedHtmlAttribute {
  name: string;
  start: number;
  end: number;
  value: string | null;
}

export interface HtmlHeadBoundary {
  openingTagStart: number;
  openingTagEnd: number;
  closingTagStart: number;
  closingTagEnd: number;
}

const HTML_RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

export function findHtmlTagEnd(html: string, start: number): number {
  let activeQuote: '"' | "'" | null = null;

  for (let index = start + 1; index < html.length; index++) {
    const char = html[index];
    if (activeQuote) {
      if (char === activeQuote) activeQuote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      continue;
    }
    if (char === ">") return index;
  }

  return -1;
}

export function getOpeningHtmlTagName(tag: string): string | undefined {
  return /^<\s*([a-zA-Z][\w:-]*)(?=[\t\n\f\r />]|$)/u.exec(tag)?.[1]?.toLowerCase();
}

export function getClosingHtmlTagName(tag: string): string | undefined {
  return /^<\s*\/\s*([a-zA-Z][\w:-]*)(?=[\t\n\f\r />]|$)/u.exec(tag)?.[1]?.toLowerCase();
}

export function isSelfClosingHtmlTag(tag: string): boolean {
  return /\/\s*>$/u.test(tag);
}

export function getHtmlAttributeInsertionIndex(tag: string): number {
  const closeIndex = tag.lastIndexOf(">");
  if (closeIndex === -1) return -1;

  let index = closeIndex - 1;
  while (index >= 0 && /\s/u.test(tag[index] ?? "")) index--;
  return tag[index] === "/" ? index : closeIndex;
}

function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || char === "\t" || char === "\n" || char === "\f" ||
    char === "\r" || char === " " || char === "/" || char === ">";
}

function isGenuineOpeningHtmlTag(tag: string): boolean {
  return /^<[a-zA-Z]/u.test(tag);
}

function isGenuineClosingHtmlTag(tag: string): boolean {
  return /^<\/[a-zA-Z]/u.test(tag);
}

function findHtmlCommentEnd(html: string, start: number): number {
  const commentDataStart = start + 4;
  if (html[commentDataStart] === ">") return commentDataStart + 1;
  if (
    html[commentDataStart] === "-" &&
    html[commentDataStart + 1] === ">"
  ) {
    return commentDataStart + 2;
  }
  const standardEnd = html.indexOf("-->", commentDataStart);
  const parseErrorEnd = html.indexOf("--!>", commentDataStart);
  if (standardEnd === -1) return parseErrorEnd === -1 ? -1 : parseErrorEnd + 4;
  if (parseErrorEnd === -1) return standardEnd + 3;
  return standardEnd < parseErrorEnd ? standardEnd + 3 : parseErrorEnd + 4;
}

export function findHtmlRawTextClosingTagStart(
  html: string,
  tagName: string,
  fromIndex: number,
): number {
  const needle = `</${tagName.toLowerCase()}`;
  let searchIndex = fromIndex;

  while (searchIndex < html.length) {
    const closingIndex = html.indexOf("<", searchIndex);
    if (closingIndex === -1) return -1;

    let matches = closingIndex + needle.length <= html.length;
    for (let offset = 0; matches && offset < needle.length; offset++) {
      const code = html.charCodeAt(closingIndex + offset);
      const asciiLowerCode = code >= 65 && code <= 90 ? code + 32 : code;
      if (asciiLowerCode !== needle.charCodeAt(offset)) matches = false;
    }

    if (matches && isTagBoundary(html[closingIndex + needle.length])) {
      return closingIndex;
    }
    searchIndex = closingIndex + 1;
  }

  return -1;
}

function matchesAsciiCaseInsensitive(
  html: string,
  start: number,
  expectedLowercase: string,
): boolean {
  if (start + expectedLowercase.length > html.length) return false;
  for (let offset = 0; offset < expectedLowercase.length; offset++) {
    const code = html.charCodeAt(start + offset);
    const asciiLowerCode = code >= 65 && code <= 90 ? code + 32 : code;
    if (asciiLowerCode !== expectedLowercase.charCodeAt(offset)) return false;
  }
  return true;
}

function matchesScriptSequence(
  html: string,
  start: number,
  sequence: "<script" | "</script",
): boolean {
  return matchesAsciiCaseInsensitive(html, start, sequence) &&
    isTagBoundary(html[start + sequence.length]);
}

/**
 * Find the closing tag that actually terminates an HTML script-data token.
 * Script data has escaped and double-escaped states in which an apparent
 * `</script>` may only leave double escaping instead of closing the element.
 */
export function findHtmlScriptClosingTagStart(
  html: string,
  fromIndex: number,
): number {
  let state: "data" | "escaped" | "double-escaped" = "data";
  let index = fromIndex;

  while (index < html.length) {
    if (state === "data") {
      if (matchesScriptSequence(html, index, "</script")) return index;
      if (html.startsWith("<!--", index)) {
        state = "escaped";
        index += 4;
        continue;
      }
    } else if (state === "escaped") {
      if (matchesScriptSequence(html, index, "</script")) return index;
      if (matchesScriptSequence(html, index, "<script")) {
        state = "double-escaped";
        index += "<script".length;
        continue;
      }
      if (html.startsWith("-->", index)) {
        state = "data";
        index += 3;
        continue;
      }
    } else {
      if (matchesScriptSequence(html, index, "</script")) {
        state = "escaped";
        index += "</script".length;
        continue;
      }
      if (html.startsWith("-->", index)) {
        state = "data";
        index += 3;
        continue;
      }
    }

    index++;
  }

  return -1;
}

export function findHtmlTextElementClosingTagStart(
  html: string,
  tagName: string,
  fromIndex: number,
): number {
  return tagName.toLowerCase() === "script"
    ? findHtmlScriptClosingTagStart(html, fromIndex)
    : findHtmlRawTextClosingTagStart(html, tagName, fromIndex);
}

/**
 * Locate an explicit document-head boundary without mistaking markup-shaped
 * text for structure. The scan preserves source offsets, skips comments and
 * raw-text/RCDATA content, and ignores `</head>` tokens inside templates.
 * Ambiguous or unterminated input returns undefined so callers fail closed.
 */
export function findHtmlHeadBoundary(html: string): HtmlHeadBoundary | undefined {
  let index = 0;
  let openingTagStart = -1;
  let openingTagEnd = -1;
  let templateDepth = 0;

  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) return undefined;

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = findHtmlCommentEnd(html, tagStart);
      if (commentEnd === -1) return undefined;
      index = commentEnd;
      continue;
    }

    const tagEnd = findHtmlTagEnd(html, tagStart);
    if (tagEnd === -1) return undefined;
    const source = html.slice(tagStart, tagEnd + 1);
    const closingTagName = isGenuineClosingHtmlTag(source)
      ? getClosingHtmlTagName(source)
      : undefined;
    const openingTagName = closingTagName === undefined && isGenuineOpeningHtmlTag(source)
      ? getOpeningHtmlTagName(source)
      : undefined;

    if (openingTagStart === -1) {
      if (openingTagName === "head") {
        openingTagStart = tagStart;
        openingTagEnd = tagEnd + 1;
      }
    } else {
      if (closingTagName === "template" && templateDepth > 0) {
        templateDepth--;
      } else if (closingTagName === "head" && templateDepth === 0) {
        return {
          openingTagStart,
          openingTagEnd,
          closingTagStart: tagStart,
          closingTagEnd: tagEnd + 1,
        };
      } else if (openingTagName === "template") {
        templateDepth++;
      }
    }

    index = tagEnd + 1;
    if (
      openingTagName && HTML_RAW_TEXT_ELEMENTS.has(openingTagName)
    ) {
      if (openingTagName === "plaintext") return undefined;
      const closingIndex = findHtmlTextElementClosingTagStart(
        html,
        openingTagName,
        index,
      );
      if (closingIndex === -1) return undefined;
      const rawTextTagEnd = findHtmlTagEnd(html, closingIndex);
      if (rawTextTagEnd === -1) return undefined;
      index = rawTextTagEnd + 1;
    }
  }

  return undefined;
}

export function insertBeforeHtmlHeadClose(html: string, content: string): string {
  const boundary = findHtmlHeadBoundary(html);
  if (!boundary) return html;
  return html.slice(0, boundary.closingTagStart) + content +
    html.slice(boundary.closingTagStart);
}

export function findHtmlAttribute(
  tag: string,
  attributeName: string,
): ParsedHtmlAttribute | undefined {
  const closeIndex = tag.lastIndexOf(">");
  if (closeIndex <= 0) return undefined;

  let index = 1;
  while (index < closeIndex && !/\s|\/|>/u.test(tag[index] ?? "")) index++;

  while (index < closeIndex) {
    while (index < closeIndex && /\s/u.test(tag[index] ?? "")) index++;
    if (index >= closeIndex) break;

    const char = tag[index];
    if (char === "/" || char === ">") break;

    const start = index;
    while (index < closeIndex && !/[\s=/>]/u.test(tag[index] ?? "")) index++;
    const name = tag.slice(start, index);

    while (index < closeIndex && /\s/u.test(tag[index] ?? "")) index++;

    let value: string | null = null;
    if (tag[index] === "=") {
      index++;
      while (index < closeIndex && /\s/u.test(tag[index] ?? "")) index++;

      const quote = tag[index];
      if (quote === '"' || quote === "'") {
        index++;
        const valueStart = index;
        while (index < closeIndex && tag[index] !== quote) index++;
        value = tag.slice(valueStart, index);
        if (index < closeIndex) index++;
      } else {
        const valueStart = index;
        while (index < closeIndex && !/[\s>]/u.test(tag[index] ?? "")) index++;
        value = tag.slice(valueStart, index);
      }
    }

    if (name.toLowerCase() === attributeName.toLowerCase()) {
      return { name, start, end: index, value };
    }
  }

  return undefined;
}
