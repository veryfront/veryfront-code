// NOTE: This file is ONLY used in the npm bundle build process.

export interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

import { createRequire } from "node:module";

let grayMatter: typeof import("gray-matter") | null = null;
const require = createRequire(import.meta.url);

async function getGrayMatter(): Promise<typeof import("gray-matter")> {
  if (!grayMatter) {
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

export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  const gm = getGrayMatterSync();
  if (gm) {
    const result = gm(content);
    return {
      attrs: result.data as T,
      body: result.content,
      frontMatter: result.matter ?? "",
    };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return { attrs: {} as T, body: content, frontMatter: "" };
  }

  const [, frontMatterStr, body] = match;
  return { attrs: {} as T, body: body || "", frontMatter: frontMatterStr || "" };
}

export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}

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
