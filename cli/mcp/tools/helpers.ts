/**
 * Shared helpers for MCP advanced tools.
 */

import { type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import {
  directoryExists,
  ensureDir,
  fileExists,
  getFs,
} from "../../utils/fs.ts";
import {
  formatError,
  toComponentName,
  toSlug as toSlugBase,
} from "../../utils/string.ts";

// Re-export utilities so existing MCP tool imports keep working
export { directoryExists, ensureDir, fileExists, formatError, getFs, toComponentName };

/** Lowercase variant of toSlug used by MCP tools. */
export function toSlug(name: string): string {
  return toSlugBase(name).toLowerCase();
}

// ============================================================================
// Types
// ============================================================================

export type RouteType = "page" | "layout" | "api" | "error" | "loading" | "not-found";

export interface RouteInfo {
  path: string;
  type: RouteType;
  file: string;
  methods?: string[];
}

export interface ProjectContext {
  name: string;
  router: "app" | "pages";
  routes: RouteInfo[];
  directories: {
    app?: string;
    pages?: string;
    components?: string;
    lib?: string;
    ai?: string;
  };
  hasAI: boolean;
  integrations: string[];
  features: string[];
}

export interface ScaffoldResult {
  success: boolean;
  files: Array<{ path: string; created: boolean }>;
  message: string;
}

// ============================================================================
// Utilities
// ============================================================================

export function getProjectDir(projectPath?: string): string {
  return projectPath ?? cwd();
}

// ============================================================================
// Route Scanning
// ============================================================================

const ROUTE_FILE_MAP: Record<string, RouteType> = {
  "page.tsx": "page",
  "page.jsx": "page",
  "page.mdx": "page",
  "layout.tsx": "layout",
  "layout.jsx": "layout",
  "route.ts": "api",
  "route.js": "api",
  "error.tsx": "error",
  "error.jsx": "error",
  "loading.tsx": "loading",
  "loading.jsx": "loading",
  "not-found.tsx": "not-found",
  "not-found.jsx": "not-found",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

function toRouteSegment(dirName: string): string {
  if (dirName.startsWith("[...") && dirName.endsWith("]")) return `*${dirName.slice(4, -1)}`;
  if (dirName.startsWith("[") && dirName.endsWith("]")) return `:${dirName.slice(1, -1)}`;
  return dirName;
}

async function detectHttpMethods(filePath: string, fs: FileSystem): Promise<string[]> {
  const content = await fs.readTextFile(filePath);
  const methods: string[] = [];

  for (const method of HTTP_METHODS) {
    const regex = new RegExp(`export\\s+(const|function|async\\s+function)\\s+${method}`, "i");
    if (regex.test(content)) methods.push(method);
  }

  return methods.length ? methods : ["GET"];
}

export async function scanDirectory(
  dir: string,
  baseRoute: string,
  routes: RouteInfo[],
  fs: FileSystem,
): Promise<void> {
  try {
    for await (const entry of fs.readDir(dir)) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (entry.name.startsWith("_")) continue;

        const segment = toRouteSegment(entry.name);
        const newRoute = baseRoute === "/" ? `/${segment}` : `${baseRoute}/${segment}`;
        await scanDirectory(fullPath, newRoute, routes, fs);
        continue;
      }

      if (!entry.isFile) continue;

      const routeType = ROUTE_FILE_MAP[entry.name.toLowerCase()];
      if (!routeType) continue;

      const routeInfo: RouteInfo = { path: baseRoute || "/", type: routeType, file: fullPath };

      if (routeType === "api") routeInfo.methods = await detectHttpMethods(fullPath, fs);

      routes.push(routeInfo);
    }
  } catch {
    // Directory doesn't exist or permission error
  }
}

export const ROUTE_FILTER_MAP: Record<string, RouteType[]> = {
  pages: ["page"],
  api: ["api"],
  layouts: ["layout"],
};
