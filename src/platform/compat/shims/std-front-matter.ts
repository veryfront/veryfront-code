import grayMatterImport from "gray-matter";

export interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

type GrayMatterResult<T> = { data: T; content: string; matter?: string };
type GrayMatterFn = <T = Record<string, unknown>>(content: string) => GrayMatterResult<T>;

const grayMatter = (grayMatterImport as { default?: GrayMatterFn }).default ??
  (grayMatterImport as GrayMatterFn);

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

export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}

export function extractAsync<T = Record<string, unknown>>(
  content: string,
): Promise<FrontMatterResult<T>> {
  return Promise.resolve(extract(content));
}
