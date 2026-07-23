/**
 * Projects Handler Module
 *
 * Handles the local projects discovery UI at root path when no project is selected.
 * Shows a list of discovered projects in standard directories.
 *
 * @module server/runtime-handler/projects-handler
 */

import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../handlers/types.ts";
import {
  defaultDiscoveryCache,
  type ProjectDiscoveryCache,
  standardProjectDirs,
} from "./local-project-discovery.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";
import {
  createPrivateProjectsResponse,
  isAuthorizedProjectsRequest,
} from "../handlers/dev/projects/request-policy.ts";

const logger = serverLogger.component("projects-handler");

const MAX_PROJECTS_RESPONSE = 100;
const MAX_DISCOVERY_ENTRIES = 1_000;
const MAX_PROJECT_SEARCH_LENGTH = 128;
const MAX_PROJECTS_QUERY_LENGTH = 1_024;
const SAFE_PROJECT_HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ALLOWED_PROJECT_QUERY_KEYS = new Set(["limit", "search", "sort_by", "sort_order"]);

interface ProjectsHandlerDeps {
  createFileSystem: typeof createFileSystem;
  cwd: typeof cwd;
  discoveryCache: ProjectDiscoveryCache;
}

let injectedDeps: Partial<ProjectsHandlerDeps> | null = null;

export function __injectProjectsHandlerDepsForTests(
  deps: Partial<ProjectsHandlerDeps> | null,
): void {
  injectedDeps = deps;
}

function getDeps(discoveryCache: ProjectDiscoveryCache): ProjectsHandlerDeps {
  return {
    createFileSystem: injectedDeps?.createFileSystem ?? createFileSystem,
    cwd: injectedDeps?.cwd ?? cwd,
    discoveryCache: injectedDeps?.discoveryCache ?? discoveryCache,
  };
}

function isProjectsPath(pathname: string): boolean {
  return pathname === "/" ||
    pathname === "/_projects" ||
    pathname.startsWith("/_projects/") ||
    pathname === "/_vf/api/projects";
}

/** Check if the request should be handled by the projects discovery UI. */
export function shouldHandleProjectsUI(
  pathname: string,
  projectSlug: string | undefined,
  parsedDomain: ParsedDomain,
): boolean {
  return (
    !projectSlug &&
    !parsedDomain.slug &&
    parsedDomain.isVeryfrontDomain &&
    parsedDomain.environment === "development" &&
    isProjectsPath(pathname)
  );
}

interface SerializeProjectsOptions {
  limit?: number;
  search?: string;
}

/** Convert internal project paths to the bounded public discovery shape. */
export function serializeDiscoveredProjects(
  projects: Iterable<readonly [string, string]>,
  options: SerializeProjectsOptions = {},
): Array<{ id: string; name: string; slug: string }> {
  const requestedLimit = options.limit ?? MAX_PROJECTS_RESPONSE;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 0), MAX_PROJECTS_RESPONSE)
    : MAX_PROJECTS_RESPONSE;
  if (limit === 0) return [];
  const search = options.search?.toLocaleLowerCase("en-US") ?? "";
  const output: Array<{ id: string; name: string; slug: string }> = [];

  for (const [slug] of projects) {
    if (!SAFE_PROJECT_HOST_LABEL.test(slug)) continue;
    if (search && !slug.toLocaleLowerCase("en-US").includes(search)) continue;
    output.push({ id: slug, name: slug, slug });
    if (output.length >= limit) break;
  }

  return output;
}

interface ProjectsQuery {
  limit: number;
  search: string;
}

function parseProjectsQuery(url: URL): ProjectsQuery | null {
  if (url.search.length > MAX_PROJECTS_QUERY_LENGTH) return null;

  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PROJECT_QUERY_KEYS.has(key) || url.searchParams.getAll(key).length !== 1) {
      return null;
    }
  }

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? MAX_PROJECTS_RESPONSE : Number(rawLimit);
  if (
    rawLimit !== null && !/^[1-9][0-9]{0,2}$/.test(rawLimit) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PROJECTS_RESPONSE
  ) {
    return null;
  }

  const search = url.searchParams.get("search") ?? "";
  if (
    search.length > MAX_PROJECT_SEARCH_LENGTH ||
    hasUnsafeControlCharacters(search)
  ) {
    return null;
  }

  const sortBy = url.searchParams.get("sort_by");
  if (sortBy !== null && sortBy !== "updated_at") return null;
  const sortOrder = url.searchParams.get("sort_order");
  if (sortOrder !== null && sortOrder !== "asc" && sortOrder !== "desc") return null;

  return { limit, search };
}

function isStrictlyContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== "" && relativePath !== "." && relativePath !== ".." &&
    !relativePath.startsWith("../") && !isAbsolute(relativePath);
}

async function hasContainedProjectMarker(
  projectPath: string,
  marker: string,
  fs: FileSystem,
): Promise<boolean> {
  const markerPath = resolve(projectPath, marker);
  if (!isStrictlyContainedPath(projectPath, markerPath) || !fs.realPath) return false;

  let canonicalMarker: string;
  try {
    canonicalMarker = resolve(await fs.realPath(markerPath));
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
  if (!isStrictlyContainedPath(projectPath, canonicalMarker)) return false;

  try {
    return (await fs.stat(canonicalMarker)).isDirectory;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function discoverLocalProjects(deps: ProjectsHandlerDeps): Promise<void> {
  const nativeFs = deps.createFileSystem();
  if (!nativeFs.realPath) throw new Error("Canonical filesystem paths are unavailable");

  const lexicalBasePath = resolve(deps.cwd());
  const canonicalBasePath = resolve(await nativeFs.realPath(lexicalBasePath));
  let inspectedEntries = 0;

  for (const dir of standardProjectDirs) {
    const lexicalRoot = resolve(lexicalBasePath, dir);
    if (!isStrictlyContainedPath(lexicalBasePath, lexicalRoot)) {
      throw new Error("Project discovery root is invalid");
    }

    let canonicalRoot: string;
    try {
      canonicalRoot = resolve(await nativeFs.realPath(lexicalRoot));
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    if (!isStrictlyContainedPath(canonicalBasePath, canonicalRoot)) {
      throw new Error("Project discovery root is invalid");
    }

    for await (const entry of nativeFs.readDir(canonicalRoot)) {
      inspectedEntries++;
      if (inspectedEntries > MAX_DISCOVERY_ENTRIES) {
        throw new Error("Project discovery entry limit exceeded");
      }

      const slug = entry.name;
      if (
        !SAFE_PROJECT_HOST_LABEL.test(slug) ||
        entry.isSymlink === true ||
        !entry.isDirectory
      ) {
        if (SAFE_PROJECT_HOST_LABEL.test(slug)) deps.discoveryCache.projects.delete(slug);
        continue;
      }

      const lexicalProjectPath = resolve(canonicalRoot, slug);
      if (!isStrictlyContainedPath(canonicalRoot, lexicalProjectPath)) continue;

      let canonicalProjectPath: string;
      try {
        canonicalProjectPath = resolve(await nativeFs.realPath(lexicalProjectPath));
      } catch (error) {
        if (isNotFoundError(error)) {
          deps.discoveryCache.projects.delete(slug);
          continue;
        }
        throw error;
      }

      if (
        !isStrictlyContainedPath(canonicalRoot, canonicalProjectPath) ||
        !isStrictlyContainedPath(canonicalBasePath, canonicalProjectPath)
      ) {
        deps.discoveryCache.projects.delete(slug);
        continue;
      }

      const markers = await Promise.all([
        hasContainedProjectMarker(canonicalProjectPath, "app", nativeFs),
        hasContainedProjectMarker(canonicalProjectPath, "pages", nativeFs),
        hasContainedProjectMarker(canonicalProjectPath, "components", nativeFs),
      ]);
      if (markers.some(Boolean)) {
        deps.discoveryCache.projects.set(slug, canonicalProjectPath);
      } else {
        deps.discoveryCache.projects.delete(slug);
      }
    }
  }
}

function jsonResponse(data: unknown, status: number): Response {
  return createPrivateProjectsResponse(
    JSON.stringify(data),
    status,
    { "Content-Type": "application/json" },
  );
}

/** Handle the projects discovery UI requests. */
export async function handleProjectsRequest(
  req: Request,
  url: URL,
  ctx: HandlerContext,
  discoveryCache: ProjectDiscoveryCache = defaultDiscoveryCache,
): Promise<Response | null> {
  const pathname = url.pathname;

  if (pathname !== "/_vf/api/projects") {
    const { handleProjectsSurfaceRequest } = await import(
      "../handlers/dev/projects/index.ts"
    );
    return handleProjectsSurfaceRequest(req, ctx);
  }

  if (!isAuthorizedProjectsRequest(req)) {
    return createPrivateProjectsResponse("Unauthorized", 401);
  }
  if (req.method.toUpperCase() !== "GET") {
    return createPrivateProjectsResponse("Method Not Allowed", 405, { "Allow": "GET" });
  }

  const query = parseProjectsQuery(url);
  if (!query) return jsonResponse({ error: "Invalid query" }, 400);

  const deps = getDeps(discoveryCache);
  try {
    await discoverLocalProjects(deps);
  } catch (error) {
    logger.warn("Local project discovery failed", {
      errorCategory: classifyTelemetryError(error),
    });
    return jsonResponse({ error: "Projects unavailable" }, 500);
  }

  const localProjects = serializeDiscoveredProjects(
    deps.discoveryCache.projects.entries(),
    query,
  );
  return jsonResponse({ data: localProjects }, 200);
}
