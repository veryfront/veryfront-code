import grayMatterImport from "gray-matter";

interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

type GrayMatterResult<T> = { data: T; content: string; matter?: string };
type GrayMatterOptions = { engines?: Record<string, boolean> };
type GrayMatterFn = <T = Record<string, unknown>>(
  content: string,
  options?: GrayMatterOptions,
) => GrayMatterResult<T>;

const grayMatter = (grayMatterImport as { default?: GrayMatterFn }).default ??
  (grayMatterImport as GrayMatterFn);

/** Security: JS engine disabled to prevent arbitrary code execution from untrusted frontmatter */
const SAFE_OPTIONS: GrayMatterOptions = { engines: { js: false } };

export function extract<T = Record<string, unknown>>(
  content: string,
): FrontMatterResult<T> {
  const { data, content: body, matter } = grayMatter<T>(content, SAFE_OPTIONS);
  return {
    attrs: data,
    body,
    frontMatter: matter ?? "",
  };
}

export function test(content: string): boolean {
  return /^---\r?\n/.test(content);
}
