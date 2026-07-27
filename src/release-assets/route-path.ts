const PAGE_MODULE_EXTENSION = /\.(tsx|ts|jsx|mdx|js)$/;
const DECLARATION_MODULE_EXTENSION = /\.d\.(tsx|ts)$/;

function stripPageModuleExtension(logicalPath: string): string | null {
  if (DECLARATION_MODULE_EXTENSION.test(logicalPath)) return null;
  if (!PAGE_MODULE_EXTENSION.test(logicalPath)) return null;
  return logicalPath.replace(PAGE_MODULE_EXTENSION, "");
}

/** Derive a route path from a page module logical path. */
export function routeForPage(logicalPath: string): string | null {
  if (logicalPath.startsWith("pages/")) {
    const withoutPrefix = logicalPath.slice("pages/".length);
    const withoutExt = stripPageModuleExtension(withoutPrefix);
    if (withoutExt === null) return null;
    const segments = withoutExt.split("/").filter(Boolean);
    if (
      segments.length === 0 ||
      segments[0] === "api" ||
      segments.some((segment) => segment.startsWith("_"))
    ) {
      return null;
    }
    const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
    return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  if (logicalPath.startsWith("app/")) {
    const withoutPrefix = logicalPath.slice("app/".length);
    const withoutExt = stripPageModuleExtension(withoutPrefix);
    if (withoutExt === null) return null;
    if (withoutExt !== "page" && !withoutExt.endsWith("/page")) return null;

    const segments = withoutExt
      .replace(/\/page$/, "")
      .replace(/^page$/, "")
      .split("/")
      .filter(Boolean);
    if (segments.some((segment) => segment.startsWith("@") || segment.startsWith("_"))) {
      return null;
    }

    const route = segments
      .filter((segment) => !segment.startsWith("("))
      .join("/");
    return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  return null;
}
