/** Resolve a snippet route to its project-relative source path. */
export function resolveSnippetFilePath(pathname: string): string {
  if (pathname.startsWith("/@components/")) {
    const componentPath = `components/${pathname.slice("/@components/".length)}`;
    return componentPath.endsWith(".snippet.mdx")
      ? componentPath
      : `${componentPath}.snippet.mdx`;
  }
  return pathname.slice("/@/".length);
}

/** Select the explicit module origin used by the snippet renderer. */
export function resolveSnippetModuleServerUrl(
  configuredUrl: string | undefined,
  requestUrl: URL,
): string {
  return configuredUrl ?? requestUrl.origin;
}
