import { rewriteNpmProtocolImports } from "./npm-protocol-imports.ts";

export const bunPreloadRewriteFilter =
  /(\.test\.[cm]?[jt]sx?|[/\\]extensions[/\\]ext-[^/\\]+[/\\]src[/\\].*\.[cm]?[jt]sx?)$/;

function normalizePreloadPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function rewriteBunPreloadSource(
  path: string,
  source: string,
  rewriteExtensionImports: (source: string) => string | null,
): string {
  const posixPath = normalizePreloadPath(path);
  let contents = posixPath.includes("/extensions/")
    ? rewriteExtensionImports(source) ?? source
    : source;
  if (/\.test\.[cm]?[jt]sx?$/.test(posixPath)) {
    contents = rewriteNpmProtocolImports(contents) ?? contents;
  }
  return contents;
}
