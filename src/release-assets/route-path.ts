/** Derive a route path from a page module logical path. */
export function routeForPage(logicalPath: string): string | null {
  if (!logicalPath.startsWith("pages/")) return null;
  const withoutPrefix = logicalPath.slice("pages/".length);
  const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
