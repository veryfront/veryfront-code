import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function assertSafeRoutePath(path: string): void {
  if (
    typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") ||
    path.includes("\\") || path.includes("?") || path.includes("#") ||
    hasUnsafeControlCharacters(path)
  ) {
    throw new TypeError("Static routes must use a safe absolute URL path");
  }
  if (path === "/") return;
  if (
    path.endsWith("/") ||
    path.slice(1).split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Static routes must use a safe absolute URL path");
  }
}

function assertSafeRouteSlug(slug: string): void {
  if (
    typeof slug !== "string" || !slug || isAbsolute(slug) ||
    slug.includes("\\") || slug.includes("?") || slug.includes("#") ||
    hasUnsafeControlCharacters(slug) ||
    slug.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Pages Router slugs must use a safe relative path");
  }
}

export function getPagesRouteOutputPath(slug: string): string {
  assertSafeRouteSlug(slug);
  return slug === "index" ? "index.html" : `${slug}/index.html`;
}

export function getAppRouteOutputPath(routePath: string): string {
  assertSafeRoutePath(routePath);
  return routePath === "/" ? "index.html" : `${routePath.slice(1)}/index.html`;
}

export function resolveBuildOutputPath(
  outputDir: string,
  relativePath: string,
  description: string,
): string {
  if (isAbsolute(relativePath)) {
    throw new TypeError(`${description} path must be relative: ${relativePath}`);
  }
  const outputRoot = resolve(outputDir);
  const outputPath = resolve(outputRoot, relativePath);
  const outputRelativePath = relative(outputRoot, outputPath);

  if (
    outputRelativePath === "" ||
    outputRelativePath.split(/[\\/]/)[0] === ".." ||
    isAbsolute(outputRelativePath)
  ) {
    throw new TypeError(`${description} is outside outputDir: ${relativePath}`);
  }

  return outputPath;
}

export function collectStaticRouteOutputPaths(
  pagesRoutes: RouteInfo[],
  appRoutes: AppRouteInfo[],
  outputDir: string,
): Set<string> {
  const outputRoot = resolve(outputDir);
  const paths = new Set<string>();
  const routePaths = new Set<string>();

  const addRoutePath = (routePath: string): void => {
    if (routePaths.has(routePath)) {
      throw new TypeError(`Duplicate static route path: ${routePath}`);
    }
    routePaths.add(routePath);
  };

  const add = (relativePath: string, description: string): void => {
    const outputPath = resolveBuildOutputPath(outputRoot, relativePath, description);
    const normalized = toPortablePath(relative(outputRoot, outputPath));
    if (paths.has(normalized)) {
      throw new TypeError(`Duplicate static output path: ${normalized}`);
    }
    paths.add(normalized);
  };

  for (const route of pagesRoutes) {
    assertSafeRoutePath(route.path);
    addRoutePath(route.path);
    add(getPagesRouteOutputPath(route.slug), `Pages route ${route.path}`);
  }
  for (const route of appRoutes) {
    addRoutePath(route.path);
    add(getAppRouteOutputPath(route.path), `App route ${route.path}`);
  }

  return paths;
}
