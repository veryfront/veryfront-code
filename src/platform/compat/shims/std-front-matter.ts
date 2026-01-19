/**
 * Cross-platform shim for Deno std/front_matter module
 * Uses gray-matter for npm builds (ESM import, no require fallback)
 *
 * NOTE: This file is ONLY used in the npm bundle build process.
 * During Deno execution, the actual std/front_matter module is used.
 */

export interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

import grayMatterImport from "gray-matter";

type GrayMatterResult<T> = { data: T; content: string; matter?: string };
type GrayMatterFn = <T = Record<string, unknown>>(content: string) => GrayMatterResult<T>;

const grayMatter = (grayMatterImport as unknown as { default?: GrayMatterFn }).default ??
  (grayMatterImport as unknown as GrayMatterFn);

/**
 * Extract front matter from content
 * Compatible with Deno std/front_matter/yaml.ts extract function
 */
export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  const result = grayMatter<T>(content);
  return {
    attrs: result.data,
    body: result.content,
    frontMatter: result.matter ?? "",
  };
}

/**
 * Test if content has front matter
 */
export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}

/**
 * Async extract using gray-matter (for npm builds with complex YAML)
 */
export function extractAsync<T = Record<string, unknown>>(
  content: string,
): Promise<FrontMatterResult<T>> {
  return Promise.resolve(extract(content));
}
