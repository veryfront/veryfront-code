import grayMatterImport from "gray-matter";

interface FrontMatterResult<T = Record<string, unknown>> {
  attrs: T;
  body: string;
  frontMatter: string;
}

type GrayMatterResult<T> = { data: T; content: string; matter?: string };
type GrayMatterEngine = { parse: () => never };
type GrayMatterOptions = { engines?: Record<string, GrayMatterEngine> };
type GrayMatterFn = <T = Record<string, unknown>>(
  content: string,
  options?: GrayMatterOptions,
) => GrayMatterResult<T>;

const grayMatter = (grayMatterImport as { default?: GrayMatterFn }).default ??
  (grayMatterImport as GrayMatterFn);

/** Security: override both "js" and "javascript" engine aliases to block eval on untrusted frontmatter */
const DISABLED_ENGINE: GrayMatterEngine = {
  parse: () => {
    throw new Error("JavaScript frontmatter is disabled for security");
  },
};
const SAFE_OPTIONS: GrayMatterOptions = {
  engines: { js: DISABLED_ENGINE, javascript: DISABLED_ENGINE },
};

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
