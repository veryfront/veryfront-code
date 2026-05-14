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

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)([\s\S]*)$/;

export function extract<T = Record<string, unknown>>(text: string): Extract<T> {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return {
      attrs: {} as T,
      body: text,
      frontMatter: "",
    };
  }

  const frontMatter = match[1] ?? "";
  const parsed = frontMatter.trim() ? parse(frontMatter) : {};
  const attrs = (parsed && typeof parsed === "object" ? parsed : {}) as T;
  return {
    attrs,
    body: match[2] ?? "",
    frontMatter,
  };
}

export function test(text: string): boolean {
  return /^---\r?\n/.test(text);
}
