/****
 * Portable @std/front-matter/yaml shim.
 * Uses gray-matter for consistent, feature-complete parsing across runtimes.
 *
 * @module
 */

import grayMatterImport from "gray-matter";

export interface Extract<T> {
  attrs: T;
  body: string;
  frontMatter: string;
}

type GrayMatterResult<T> = { data: T; content: string; matter?: string };
type GrayMatterEngine = { parse: () => never };
type GrayMatterOptions = { engines?: Record<string, GrayMatterEngine> };
type GrayMatterFn = <T = Record<string, unknown>>(
  content: string,
  options?: GrayMatterOptions,
) => GrayMatterResult<T>;

const grayMatter: GrayMatterFn = (grayMatterImport as { default?: GrayMatterFn }).default ??
  (grayMatterImport as GrayMatterFn);

/** Security: override both "js" and "javascript" engine aliases to block eval on untrusted frontmatter */
const DISABLED_ENGINE: GrayMatterEngine = {
  parse: () => {
    throw new Error("JavaScript frontmatter is disabled for security");
  },
};
const SAFE_OPTIONS: GrayMatterOptions = {
  engines: { js: DISABLED_ENGINE, javascript: DISABLED_ENGINE },
};

export function extract<T = Record<string, unknown>>(text: string): Extract<T> {
  const result = grayMatter<T>(text, SAFE_OPTIONS);
  return {
    attrs: result.data,
    body: result.content,
    frontMatter: result.matter ?? "",
  };
}

export function test(text: string): boolean {
  const testFn = (grayMatter as GrayMatterFn & { test?: (input: string) => boolean }).test;
  if (testFn) return testFn(text);
  return /^---\r?\n/.test(text);
}
