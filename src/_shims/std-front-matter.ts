/**
 * Cross-platform shim for Deno std/front_matter module
 * Uses gray-matter as the underlying implementation for npm builds
 *
 * NOTE: This file is ONLY used in the npm bundle build process.
 * During Deno execution, the actual std/front_matter module is used.
 */

export interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

import { createRequire } from "node:module";

// Lazy-loaded gray-matter module (kept as any to avoid Deno type issues)
let grayMatter: typeof import("gray-matter") | null = null;
const require = createRequire(import.meta.url);

async function getGrayMatter(): Promise<typeof import("gray-matter")> {
  if (!grayMatter) {
    // Dynamic import to avoid Deno type checking issues
    // This module is only used in npm builds where gray-matter is available
    grayMatter = await import("gray-matter");
  }
  return grayMatter;
}

function getGrayMatterSync(): typeof import("gray-matter")["default"] | null {
  if (grayMatter) {
    return (grayMatter as { default?: typeof import("gray-matter")["default"] }).default ??
      (grayMatter as unknown as { default: typeof import("gray-matter")["default"] }).default ??
      (grayMatter as unknown as typeof import("gray-matter")["default"]);
  }

  try {
    const mod = require("gray-matter") as {
      default?: typeof import("gray-matter")["default"];
    };
    grayMatter = mod as typeof import("gray-matter");
    return mod.default ?? (mod as unknown as typeof import("gray-matter")["default"]);
  } catch (_error) {
    return null;
  }
}

/**
 * Extract front matter from content
 * Compatible with Deno std/front_matter/yaml.ts extract function
 */
export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  // Prefer real gray-matter parsing to avoid regex-based YAML guesses
  const gm = getGrayMatterSync();
  if (gm) {
    const result = gm(content);
    return {
      attrs: result.data as T,
      body: result.content,
      frontMatter: result.matter ?? "",
    };
  }

  // Fallback: behave like Deno std extract when gray-matter is unavailable
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return { attrs: {} as T, body: content, frontMatter: "" };
  }

  const [, frontMatterStr, body] = match;
  return { attrs: {} as T, body: body || "", frontMatter: frontMatterStr || "" };
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
export async function extractAsync<T = Record<string, unknown>>(
  content: string,
): Promise<FrontMatterResult<T>> {
  const gm = await getGrayMatter();
  const result =
    (gm as { default: (content: string) => { data: T; content: string; matter: string } }).default(
      content,
    );
  return {
    attrs: result.data,
    body: result.content,
    frontMatter: result.matter,
  };
}
