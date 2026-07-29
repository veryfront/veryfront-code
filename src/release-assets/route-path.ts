const PAGE_MODULE_EXTENSION = /\.(tsx|ts|jsx|mdx|js)$/;
const DECLARATION_MODULE_EXTENSION = /\.d\.(tsx|ts)$/;

export interface ConfiguredRouteDirectories {
  app?: string;
  pages?: string;
}

function stripPageModuleExtension(logicalPath: string): string | null {
  if (DECLARATION_MODULE_EXTENSION.test(logicalPath)) return null;
  if (!PAGE_MODULE_EXTENSION.test(logicalPath)) return null;
  return logicalPath.replace(PAGE_MODULE_EXTENSION, "");
}

export function normalizeLogicalPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function pathBelowRoot(path: string, root: string): string | null {
  const normalizedPath = normalizeLogicalPath(path);
  const normalizedRoot = normalizeLogicalPath(root);
  if (normalizedRoot === "") return normalizedPath;
  if (normalizedPath === normalizedRoot) return "";
  const prefix = `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : null;
}

export function configuredRoutePath(
  path: string,
  directories: ConfiguredRouteDirectories | undefined,
  routeRoot: "app" | "pages",
): string | null {
  const relativePath = pathBelowRoot(path, directories?.[routeRoot] ?? routeRoot);
  return relativePath === null ? null : `${routeRoot}/${relativePath}`;
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

export function routeForConfiguredPage(
  path: string,
  directories?: ConfiguredRouteDirectories,
): string | null {
  const appPath = configuredRoutePath(path, directories, "app");
  if (appPath) {
    const route = routeForPage(appPath);
    if (route !== null) return route;
  }

  const pagesPath = configuredRoutePath(path, directories, "pages");
  if (pagesPath) return routeForPage(pagesPath);

  return null;
}
