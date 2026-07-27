/** Derive a route path from a page module logical path. */
export function routeForPage(logicalPath: string): string | null {
  if (logicalPath.startsWith("pages/")) {
    const withoutPrefix = logicalPath.slice("pages/".length);
    const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
    const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
    return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  if (logicalPath.startsWith("app/")) {
    const withoutPrefix = logicalPath.slice("app/".length);
    const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
    if (withoutExt !== "page" && !withoutExt.endsWith("/page")) return null;
    const route = withoutExt.replace(/\/page$/, "").replace(/^page$/, "");
    return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  return null;
}
