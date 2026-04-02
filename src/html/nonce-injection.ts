import { escapeHtml } from "#veryfront/utils/html-escape.ts";

function findTagEnd(html: string, start: number): number {
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

function getOpeningTagName(tag: string): "script" | "style" | undefined {
  const match = /^<\s*([a-zA-Z][\w:-]*)/u.exec(tag);
  const tagName = match?.[1]?.toLowerCase();
  if (tagName === "script" || tagName === "style") return tagName;
  return undefined;
}

function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || /\s|\/|>/u.test(char);
}

function findRawTextClosingTagStart(
  lowerHtml: string,
  tagName: "script" | "style",
  fromIndex: number,
): number {
  const needle = `</${tagName}`;
  let searchIndex = fromIndex;

  while (searchIndex < lowerHtml.length) {
    const closingIndex = lowerHtml.indexOf(needle, searchIndex);
    if (closingIndex === -1) return -1;

    if (isTagBoundary(lowerHtml[closingIndex + needle.length])) {
      return closingIndex;
    }

    searchIndex = closingIndex + needle.length;
  }

  return -1;
}

function injectNonceIntoOpeningTag(tag: string, escapedNonce: string): string {
  if (/(?:\s|<)nonce\s*=/iu.test(tag)) return tag;

  const closeIndex = tag.lastIndexOf(">");
  if (closeIndex === -1) return tag;

  const insertAt = /\/\s*>$/u.test(tag) ? closeIndex - 1 : closeIndex;
  return `${tag.slice(0, insertAt)} nonce="${escapedNonce}"${tag.slice(insertAt)}`;
}

export function addNonceToHtmlTags(html: string, nonce?: string): string {
  if (!nonce) return html;

  const escapedNonce = escapeHtml(nonce);
  const lowerHtml = html.toLowerCase();
  let result = "";
  let index = 0;
  let rawTextTag: "script" | "style" | null = null;

  while (index < html.length) {
    if (rawTextTag) {
      const closingIndex = findRawTextClosingTagStart(lowerHtml, rawTextTag, index);
      if (closingIndex === -1) {
        result += html.slice(index);
        break;
      }

      result += html.slice(index, closingIndex);
      index = closingIndex;
      rawTextTag = null;
      continue;
    }

    if (html.startsWith("<!--", index)) {
      const commentEnd = html.indexOf("-->", index + 4);
      const endIndex = commentEnd === -1 ? html.length : commentEnd + 3;
      result += html.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    if (html[index] !== "<") {
      result += html[index];
      index++;
      continue;
    }

    const tagEnd = findTagEnd(html, index);
    if (tagEnd === -1) {
      result += html.slice(index);
      break;
    }

    const tag = html.slice(index, tagEnd + 1);
    const tagName = getOpeningTagName(tag);

    if (!tagName) {
      result += tag;
      index = tagEnd + 1;
      continue;
    }

    result += injectNonceIntoOpeningTag(tag, escapedNonce);
    index = tagEnd + 1;

    if (!/\/\s*>$/u.test(tag)) {
      rawTextTag = tagName;
    }
  }

  return result;
}
