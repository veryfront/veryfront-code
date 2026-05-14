import { parse } from "@std/yaml/parse";

interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)([\s\S]*)$/;

export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {
      attrs: {} as T,
      body: content,
      frontMatter: "",
    };
  }

  const frontMatter = match[1] ?? "";
  const parsed = frontMatter.trim() ? parse(frontMatter) : {};
  const attrs = (parsed && typeof parsed === "object" ? parsed : {}) as T;
  return {
    attrs,
    body: match[2] ?? "",
    frontMatter,
  };
}

export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}
