// NOTE: This file is ONLY used in the npm bundle build process.

export interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

import { createRequire } from "node:module";

type GrayMatterFn = typeof import("gray-matter")["default"];
type GrayMatterModule = typeof import("gray-matter");

let grayMatterModule: GrayMatterModule | null = null;
const require = createRequire(import.meta.url);

async function getGrayMatter(): Promise<GrayMatterModule> {
  if (!grayMatterModule) {
    grayMatterModule = await import("gray-matter");
  }
  return grayMatterModule;
}

/**
 * Extracts the gray-matter function from a module that may have
 * different export shapes (ESM default vs CJS module.exports)
 */
function extractGrayMatterFn(mod: unknown): GrayMatterFn | null {
  if (typeof mod === "function") {
    return mod as GrayMatterFn;
  }
  const modObj = mod as { default?: unknown };
  if (typeof modObj.default === "function") {
    return modObj.default as GrayMatterFn;
  }
  return null;
}

function getGrayMatterSync(): GrayMatterFn | null {
  if (grayMatterModule) {
    return extractGrayMatterFn(grayMatterModule);
  }

  try {
    const mod = require("gray-matter");
    grayMatterModule = mod as GrayMatterModule;
    return extractGrayMatterFn(mod);
  } catch {
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
  const mod = await getGrayMatter();
  const gm = extractGrayMatterFn(mod);
  if (!gm) {
    throw new Error("Failed to load gray-matter module");
  }
  const result = gm(content);
  return {
    attrs: result.data as T,
    body: result.content,
    frontMatter: result.matter ?? "",
  };
}
