import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";

const fs = createFileSystem();

const PAGE_EXTENSIONS = ["mdx", "md", "tsx", "ts", "jsx", "js"] as const;
const RSC_RENDER_ROUTE_PREFIX = "_veryfront/rsc/render/";
const ENCODED_ROUTE_SEPARATOR_PATTERN = /%(?:00|2e|2f|5c)/iu;

export async function resolveComponentPath(
  pathname: string,
  projectDir: string,
  fsAdapter?: FileSystemAdapter,
  appDir: string = "app",
): Promise<string | null> {
  const cleanPath = normalizeComponentRoute(pathname);
  if (cleanPath === null) return null;

  const projectRoot = normalizePath(projectDir);
  const normalizedAppDir = appDir.replace(/^\/+|\/+$/g, "") || "app";
  const appRoot = normalizePath(joinPath(projectRoot, normalizedAppDir));
  if (!isWithinDirectory(projectRoot, appRoot)) return null;

  const rootPatterns = PAGE_EXTENSIONS.map((extension) => `page.${extension}`);

  if (cleanPath === "index") {
    const rootMatch = await findFirstExistingPath(appRoot, rootPatterns, fsAdapter);
    if (rootMatch) return rootMatch;
  }

  const patterns = [
    ...PAGE_EXTENSIONS.map((extension) => `${cleanPath}/page.${extension}`),
    ...PAGE_EXTENSIONS.map((extension) => `${cleanPath}.${extension}`),
  ];
  return findFirstExistingPath(appRoot, patterns, fsAdapter);
}

export function normalizeComponentRoute(pathname: string): string | null {
  if (hasUnsafeRouteCharacter(pathname) || ENCODED_ROUTE_SEPARATOR_PATTERN.test(pathname)) {
    return null;
  }

  let route = pathname;
  if (route.startsWith(`/${RSC_RENDER_ROUTE_PREFIX}`)) {
    route = route.slice(RSC_RENDER_ROUTE_PREFIX.length + 1);
  } else if (route.startsWith(RSC_RENDER_ROUTE_PREFIX)) {
    route = route.slice(RSC_RENDER_ROUTE_PREFIX.length);
  } else if (route.startsWith("/")) {
    if (route.startsWith("//")) return null;
    route = route.slice(1);
  }

  if (route.endsWith("/")) route = route.slice(0, -1);
  if (!route) return "index";

  const segments = route.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return route;
}

function hasUnsafeRouteCharacter(route: string): boolean {
  for (const character of route) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === "\\" || character === "?" || character === "#" || codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

async function findFirstExistingPath(
  projectDir: string,
  patterns: string[],
  fsAdapter?: FileSystemAdapter,
): Promise<string | null> {
  for (const pattern of patterns) {
    const fullPath = normalizePath(joinPath(projectDir, pattern));
    if (!isWithinDirectory(projectDir, fullPath)) continue;
    if (await fileExists(fullPath, fsAdapter)) return fullPath;
  }
  return null;
}

async function fileExists(filePath: string, fsAdapter?: FileSystemAdapter): Promise<boolean> {
  try {
    const stat = fsAdapter ? await fsAdapter.stat(filePath) : await fs.stat(filePath);
    return stat.isFile;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export function extractParams(_pathname: string): Record<string, string> {
  return {};
}
