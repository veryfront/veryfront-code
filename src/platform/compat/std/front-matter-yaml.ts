/**
 * Portable @std/front-matter/yaml shim.
 *
 * @module
 */

import { parse } from "@std/yaml/parse";

export interface Extract<T> {
  attrs: T;
  body: string;
  frontMatter: string;
}

const OPENING_DELIMITER_RE = /^---\r?\n/;
const CLOSING_DELIMITER_RE = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/g;

function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function extract<T = Record<string, unknown>>(text: string): Extract<T> {
  const content = stripByteOrderMark(text);
  const openingDelimiter = OPENING_DELIMITER_RE.exec(content);
  if (!openingDelimiter) {
    return {
      attrs: {} as T,
      body: text,
      frontMatter: "",
    };
  }

  const afterOpening = content.slice(openingDelimiter[0].length);
  CLOSING_DELIMITER_RE.lastIndex = 0;
  const closingDelimiter = CLOSING_DELIMITER_RE.exec(afterOpening);
  if (!closingDelimiter) {
    return {
      attrs: {} as T,
      body: text,
      frontMatter: "",
    };
  }

  const frontMatter = afterOpening.slice(0, closingDelimiter.index);
  const parsed = frontMatter.trim() ? parse(frontMatter) : {};
  const attrs = (parsed && typeof parsed === "object" ? parsed : {}) as T;
  return {
    attrs,
    body: afterOpening.slice(closingDelimiter.index + closingDelimiter[0].length),
    frontMatter,
  };
}

export function test(text: string): boolean {
  return OPENING_DELIMITER_RE.test(stripByteOrderMark(text));
}
