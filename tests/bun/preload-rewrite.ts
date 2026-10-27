import { rewriteNpmProtocolImports } from "./npm-protocol-imports.ts";

export const bunPreloadRewriteFilter =
  /^(?!.*[/\\]node_modules[/\\]).*(\.test\.[cm]?[jt]sx?|[/\\](?:scripts|tests)[/\\].*\.[cm]?[jt]sx?|[/\\]extensions[/\\]ext-[^/\\]+[/\\]src[/\\].*\.[cm]?[jt]sx?)$/;

function normalizePreloadPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isExtensionSourcePath(path: string): boolean {
  return /(?:^|\/)extensions\/ext-[^/]+\/src\/.*\.[cm]?[jt]sx?$/.test(path);
}

export function rewriteBunPreloadSource(
  path: string,
  source: string,
  rewriteExtensionImports: (source: string) => string | null,
): string {
  const posixPath = normalizePreloadPath(path);
  const contents = isExtensionSourcePath(posixPath)
    ? rewriteExtensionImports(source) ?? source
    : source;
  // Helpers imported by tests need the same protocol translation as test files.
  return rewriteNpmProtocolImports(contents) ?? contents;
}
