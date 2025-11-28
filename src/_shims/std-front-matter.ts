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

// Lazy-loaded gray-matter module
let grayMatter: typeof import("gray-matter") | null = null;

async function getGrayMatter(): Promise<typeof import("gray-matter")> {
  if (!grayMatter) {
    // Dynamic import to avoid Deno type checking issues
    // This module is only used in npm builds where gray-matter is available
    grayMatter = await import("gray-matter");
  }
  return grayMatter;
}

/**
 * Extract front matter from content
 * Compatible with Deno std/front_matter/yaml.ts extract function
 */
export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  // Synchronous extraction using a simple regex-based parser
  // This avoids the async complexity while still working
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return {
      attrs: {} as T,
      body: content,
      frontMatter: "",
    };
  }

  const [, frontMatterStr, body] = match;

  // Simple YAML parsing for common cases
  const attrs: Record<string, unknown> = {};
  if (frontMatterStr) {
    const lines = frontMatterStr.split(/\r?\n/);
    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value: unknown = line.slice(colonIndex + 1).trim();

        // Handle quoted strings
        if (
          (value as string).startsWith('"') && (value as string).endsWith('"')
        ) {
          value = (value as string).slice(1, -1);
        } else if (
          (value as string).startsWith("'") && (value as string).endsWith("'")
        ) {
          value = (value as string).slice(1, -1);
        } // Handle booleans
        else if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } // Handle numbers
        else if (!isNaN(Number(value)) && (value as string) !== "") {
          value = Number(value);
        }

        attrs[key] = value;
      }
    }
  }

  return {
    attrs: attrs as T,
    body: body || "",
    frontMatter: frontMatterStr || "",
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
export async function extractAsync<T = Record<string, unknown>>(
  content: string,
): Promise<FrontMatterResult<T>> {
  const gm = await getGrayMatter();
  const result = (gm as { default: (content: string) => { data: T; content: string; matter: string } }).default(content);
  return {
    attrs: result.data,
    body: result.content,
    frontMatter: result.matter,
  };
}
