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
type GrayMatterFn = <T = Record<string, unknown>>(content: string) => GrayMatterResult<T>;

const grayMatter: GrayMatterFn = (grayMatterImport as { default?: GrayMatterFn }).default ??
  (grayMatterImport as GrayMatterFn);

export function extract<T = Record<string, unknown>>(text: string): Extract<T> {
  const result = grayMatter<T>(text);
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
