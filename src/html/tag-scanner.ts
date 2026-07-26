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
  return /^<\s*([a-zA-Z][\w:-]*)/u.exec(tag)?.[1]?.toLowerCase();
}

export function getClosingHtmlTagName(tag: string): string | undefined {
  return /^<\s*\/\s*([a-zA-Z][\w:-]*)/u.exec(tag)?.[1]?.toLowerCase();
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
  return char === undefined || /\s|\/|>/u.test(char);
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
