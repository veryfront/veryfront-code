import { assertHTMLStringSize } from "./limits.ts";

function skipWhitespace(content: string, start: number): number {
  let index = start;
  while (index < content.length && /\s/u.test(content[index]!)) index++;
  return index;
}

function skipLeadingComments(content: string, start: number): number {
  let index = skipWhitespace(content, start);
  while (content.startsWith("<!--", index)) {
    const commentEnd = content.indexOf("-->", index + 4);
    if (commentEnd < 0) return -1;
    index = skipWhitespace(content, commentEnd + 3);
  }
  return index;
}

function trimTrailingComments(content: string): number {
  let end = content.length;
  while (end > 0 && /\s/u.test(content[end - 1]!)) end--;

  while (end >= 3 && content.slice(end - 3, end) === "-->") {
    const commentStart = content.lastIndexOf("<!--", end - 3);
    if (commentStart < 0) return -1;
    end = commentStart;
    while (end > 0 && /\s/u.test(content[end - 1]!)) end--;
  }
  return end;
}

export function isFullHTMLDocument(content: string): boolean {
  assertHTMLStringSize(content, "HTML document");
  const firstContentIndex = content.search(/\S/);
  if (firstContentIndex < 0) return false;

  const doctypeEndIndex = content.indexOf(">", firstContentIndex);
  if (doctypeEndIndex < 0 || doctypeEndIndex - firstContentIndex > 1024) return false;
  const doctype = content.slice(firstContentIndex, doctypeEndIndex + 1);
  if (!/^<!doctype\s+html(?:\s+[^<>]*)?\s*>$/i.test(doctype)) return false;

  const rootStart = skipLeadingComments(content, doctypeEndIndex + 1);
  if (rootStart < 0) return false;
  const openingTag = /^<html(?:\s[^<>]*)?>/i.exec(content.slice(rootStart));
  if (!openingTag) return false;

  const documentEnd = trimTrailingComments(content);
  if (documentEnd < 0) return false;
  const closingTag = /<\/html\s*>$/i.exec(content.slice(0, documentEnd));
  return closingTag !== null && closingTag.index >= rootStart + openingTag[0].length;
}
