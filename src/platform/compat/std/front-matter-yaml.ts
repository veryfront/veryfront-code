/**
 * Portable @std/front-matter/yaml shim.
 *
 * @module
 */

import { parse } from "#std/yaml/parse";

export interface Extract<T> {
  attrs: T;
  body: string;
  frontMatter: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)([\s\S]*)$/;

function extractUnknown(text: string): Extract<unknown> {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return {
      attrs: {},
      body: text,
      frontMatter: "",
    };
  }

  const frontMatter = match[1] ?? "";
  const parsed = frontMatter.trim() ? parse(frontMatter) : {};
  return {
    attrs: parsed,
    body: match[2] ?? "",
    frontMatter,
  };
}

/**
 * Extracts YAML front matter with the compatibility behavior used by existing
 * framework consumers. Scalar roots become an empty attribute object while
 * object-like roots, including sequences, are returned unchanged.
 */
export function extract<T = Record<string, unknown>>(text: string): Extract<T> {
  const extracted = extractUnknown(text);
  return {
    ...extracted,
    attrs: (
      extracted.attrs && typeof extracted.attrs === "object" ? extracted.attrs : {}
    ) as T,
  };
}

/**
 * Extracts YAML front matter and requires its root to be a plain mapping.
 *
 * Use this at trust boundaries where silently coercing a scalar or sequence
 * would hide malformed metadata.
 */
export function extractMapping(
  text: string,
): Extract<Record<string, unknown>> {
  const extracted = extractUnknown(text);
  const parsed = extracted.attrs;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (
      Reflect.getPrototypeOf(parsed) !== Object.prototype &&
      Reflect.getPrototypeOf(parsed) !== null
    )
  ) {
    throw new TypeError("YAML front matter must be a mapping");
  }
  return {
    ...extracted,
    attrs: parsed as Record<string, unknown>,
  };
}

export function test(text: string): boolean {
  return /^---\r?\n/.test(text);
}
