import grayMatterImport from "gray-matter";

interface FrontMatterResult<T = Record<string, unknown>> {
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
  const { data, content: body, matter } = grayMatter<T>(content);
  return {
    attrs: data,
    body,
    frontMatter: matter ?? "",
  };
}

export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}
