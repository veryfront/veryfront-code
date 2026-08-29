import { parse } from "#std/yaml/parse";
import { matchFrontMatterSource } from "../std/front-matter-source.ts";

interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  const source = matchFrontMatterSource(content);
  if (source === undefined) {
    return {
      attrs: {} as T,
      body: content,
      frontMatter: "",
    };
  }

  const frontMatter = source.frontMatter;
  const parsed = frontMatter.trim() ? parse(frontMatter) : {};
  const attrs = (parsed && typeof parsed === "object" ? parsed : {}) as T;
  return {
    attrs,
    body: source.body,
    frontMatter,
  };
}

export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}
