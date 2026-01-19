/**
 * Portable @std/front-matter/yaml shim.
 * Uses gray-matter for consistent, feature-complete parsing across runtimes.
 *
 * @module
 */

import grayMatterImport from "gray-matter";

// ============================================================================
// Types
// ============================================================================

export interface Extract<T> {
  attrs: T;
  body: string;
  frontMatter: string;
}

type GrayMatterResult<T> = { data: T; content: string; matter?: string };
type GrayMatterFn = <T = Record<string, unknown>>(content: string) => GrayMatterResult<T>;

const grayMatter = (grayMatterImport as unknown as { default?: GrayMatterFn }).default ??
  (grayMatterImport as unknown as GrayMatterFn);

// ============================================================================
// Exports
// ============================================================================

export function extract<T = Record<string, unknown>>(text: string): Extract<T> {
  const result = grayMatter<T>(text);
  return {
    attrs: result.data,
    body: result.content,
    frontMatter: result.matter ?? "",
  };
}

export function test(text: string): boolean {
  const matterWithTest = grayMatter as GrayMatterFn & { test?: (input: string) => boolean };
  if (typeof matterWithTest.test === "function") {
    return matterWithTest.test(text);
  }
  return /^---\r?\n/.test(text);
}
