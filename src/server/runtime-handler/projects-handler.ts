/**
 * Projects Handler Module
 *
 * Admits project-picker requests before a project-specific runtime exists.
 * UI behavior is delegated to the same handler instance registered in the
 * development route registry. Local discovery is an explicitly injected,
 * bounded capability rooted at the configured runtime project directory.
 *
 * @module server/runtime-handler/projects-handler
 */

import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { serverLogger } from "#veryfront/utils";
import type { Handler, HandlerContext } from "#veryfront/types";
import type { ParsedDomain } from "../utils/domain-parser.ts";
import { type ProjectDiscoveryCache, standardProjectDirs } from "./local-project-discovery.ts";

const logger = serverLogger.component("projects-handler");

const DEFAULT_MAX_DISCOVERY_ENTRIES = 1_000;
const DEFAULT_MAX_DISCOVERED_PROJECTS = 100;
const MAX_PROJECT_ENTRY_NAME_LENGTH = 255;
const MAX_PROJECT_ROOT_LENGTH = 4_096;
const PROJECT_MARKER_DIRECTORIES = ["app", "pages", "components"] as const;
const DISCOVERY_PROBLEM_TYPE = "urn:veryfront:problem:local-project-discovery-unavailable";
const DISCOVERY_PROBLEM_TITLE = "Local project discovery unavailable";
const DISCOVERY_PROBLEM_DETAIL =
  "The configured project filesystem could not be scanned completely and safely.";
const PROJECTS_API_ALLOWED_METHODS = "GET, HEAD";
const textEncoder = new TextEncoder();

export interface LocalProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface LocalProjectsDiscoveryService {
  list(): Promise<readonly LocalProjectSummary[]>;
}

export interface LocalProjectsDiscoveryLimits {
  /** Maximum directory entries consumed across every configured discovery root. */
  readonly maxEntriesScanned: number;
  /** Maximum projects returned and retained in the runtime discovery cache. */
  readonly maxProjects: number;
}

export interface LocalProjectsDiscoveryServiceOptions {
  /** Explicit runtime root. Relative values remain adapter-relative; no host cwd is consulted. */
  readonly projectRoot: string;
  /** Filesystem capability owned by the active runtime adapter. */
  readonly fileSystem: FileSystemAdapter;
  /** Runtime-generation-local cache populated only after a complete successful scan. */
  readonly cache: ProjectDiscoveryCache;
  readonly limits?: Partial<LocalProjectsDiscoveryLimits>;
}

export interface ProjectsRequestDependencies {
  /** The same instance that is registered in the development route registry. */
  readonly projectsHandler: Handler;
  readonly discoveryService: LocalProjectsDiscoveryService;
}

type DiscoveryFailureCode =
  | "filesystem_failure"
  | "limit_exceeded"
  | "unsafe_entry"
  | "unsupported_filesystem";

class LocalProjectDiscoveryFailure extends Error {
  constructor(
    readonly code: DiscoveryFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalProjectDiscoveryFailure";
  }
}

function requirePositiveInteger(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive safe integer`);
  }
  return value;
}

function normalizeProjectRoot(projectRoot: string): string {
  if (
    projectRoot.length === 0 ||
    projectRoot.length > MAX_PROJECT_ROOT_LENGTH ||
    projectRoot.includes("\0")
  ) {
    throw new TypeError("projectRoot must be a non-empty, bounded path without NUL bytes");
  }

  return normalize(projectRoot);
}

function isSafeEntryName(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_PROJECT_ENTRY_NAME_LENGTH &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0");
}

function isKnownDiscoveryFailure(error: unknown): error is LocalProjectDiscoveryFailure {
  try {
    return error instanceof LocalProjectDiscoveryFailure;
  } catch {
    return false;
  }
}

function toDiscoveryFailure(error: unknown): LocalProjectDiscoveryFailure {
  if (isKnownDiscoveryFailure(error)) return error;
  return new LocalProjectDiscoveryFailure(
    "filesystem_failure",
    "The configured project filesystem failed during local project discovery",
    { cause: error },
  );
}

type DirectoryState = "missing" | "safe" | "unsafe";

function isPathContainedBy(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." &&
    !pathFromRoot.startsWith("../") &&
    !pathFromRoot.startsWith("..\\") &&
    !isAbsolute(pathFromRoot);
}

async function inspectDirectory(
  fileSystem: FileSystemAdapter,
  path: string,
): Promise<DirectoryState> {
  if (!await fileSystem.exists(path)) return "missing";

  if (fileSystem.symlinkSemantics === "none") {
    const info = await fileSystem.stat(path);
    return info.isDirectory && !info.isSymlink ? "safe" : "unsafe";
  }

  if (fileSystem.lstat === undefined) {
    throw new LocalProjectDiscoveryFailure(
      "unsupported_filesystem",
      "Local project discovery requires lstat or explicit no-symlink semantics",
    );
  }

  const info = await fileSystem.lstat(path);
  return info.isDirectory && !info.isSymlink ? "safe" : "unsafe";
}

function requireNativeDiscoveryCapabilities(
  fileSystem: FileSystemAdapter,
): asserts fileSystem is FileSystemAdapter & {
  lstat: NonNullable<FileSystemAdapter["lstat"]>;
  realPath: NonNullable<FileSystemAdapter["realPath"]>;
} {
  if (
    fileSystem.symlinkSemantics !== "none" &&
    (fileSystem.lstat === undefined || fileSystem.realPath === undefined)
  ) {
    throw new LocalProjectDiscoveryFailure(
      "unsupported_filesystem",
      "Local project discovery requires lstat and realPath or explicit no-symlink semantics",
    );
  }
}

async function requireCanonicalContainedDirectory(
  fileSystem: FileSystemAdapter & {
    realPath: NonNullable<FileSystemAdapter["realPath"]>;
  },
  path: string,
  canonicalRoot: string,
): Promise<string> {
  const canonicalPath = await fileSystem.realPath(path);
  if (!isPathContainedBy(canonicalRoot, canonicalPath)) {
    throw new LocalProjectDiscoveryFailure(
      "unsafe_entry",
      "A local project discovery path resolves outside its configured root",
    );
  }
  return canonicalPath;
}

async function hasProjectMarker(
  fileSystem: FileSystemAdapter,
  projectPath: string,
): Promise<boolean> {
  const markerResults = await Promise.all(
    PROJECT_MARKER_DIRECTORIES.map((marker) =>
      inspectDirectory(fileSystem, join(projectPath, marker))
    ),
  );
  return markerResults.some((state) => state === "safe");
}

function createProjectSummary(slug: string): LocalProjectSummary {
  return Object.freeze({ id: slug, name: slug, slug });
}

function sortProjectSummaries(
  projects: ReadonlyMap<string, string>,
): readonly LocalProjectSummary[] {
  return Object.freeze(
    Array.from(projects, ([slug]) => createProjectSummary(slug)).sort(
      (left, right) => left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
    ),
  );
}

/**
 * Create one runtime-generation-local project discovery capability.
 *
 * Concurrent callers share a scan. Cache writes are delayed until the full
 * scan succeeds, so an adapter failure or limit breach cannot publish partial
 * routing state.
 */
export function createLocalProjectsDiscoveryService(
  options: LocalProjectsDiscoveryServiceOptions,
): LocalProjectsDiscoveryService {
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const fileSystem = options.fileSystem;
  const cache = options.cache;
  const limits: LocalProjectsDiscoveryLimits = Object.freeze({
    maxEntriesScanned: requirePositiveInteger(
      options.limits?.maxEntriesScanned ?? DEFAULT_MAX_DISCOVERY_ENTRIES,
      "limits.maxEntriesScanned",
    ),
    maxProjects: requirePositiveInteger(
      options.limits?.maxProjects ?? DEFAULT_MAX_DISCOVERED_PROJECTS,
      "limits.maxProjects",
    ),
  });
  let managedProjects = new Map<string, string>();

  const snapshotUnmanagedProjects = (): Map<string, string> => {
    const unmanaged = new Map(cache.projects.entries());
    for (const [slug, managedPath] of managedProjects) {
      if (unmanaged.get(slug) === managedPath) unmanaged.delete(slug);
    }
    return unmanaged;
  };

  const scan = async (): Promise<readonly LocalProjectSummary[]> => {
    const unmanagedAtStart = snapshotUnmanagedProjects();
    if (unmanagedAtStart.size > limits.maxProjects) {
      throw new LocalProjectDiscoveryFailure(
        "limit_exceeded",
        "The local project cache already exceeds the configured project limit",
      );
    }

    const scannedProjects = new Map<string, string>();
    let entriesScanned = 0;
    try {
      requireNativeDiscoveryCapabilities(fileSystem);
      const canonicalProjectRoot = fileSystem.symlinkSemantics === "none"
        ? undefined
        : await fileSystem.realPath(projectRoot);

      for (const relativeRoot of standardProjectDirs) {
        const discoveryRoot = join(projectRoot, relativeRoot);
        const rootState = await inspectDirectory(fileSystem, discoveryRoot);
        if (rootState === "missing") continue;
        if (rootState === "unsafe") {
          throw new LocalProjectDiscoveryFailure(
            "unsafe_entry",
            "A configured local project discovery root is not a safe directory",
          );
        }
        const canonicalDiscoveryRoot = canonicalProjectRoot === undefined
          ? undefined
          : await requireCanonicalContainedDirectory(
            fileSystem,
            discoveryRoot,
            canonicalProjectRoot,
          );

        for await (const entry of fileSystem.readDir(discoveryRoot)) {
          entriesScanned++;
          if (entriesScanned > limits.maxEntriesScanned) {
            throw new LocalProjectDiscoveryFailure(
              "limit_exceeded",
              "The local project discovery entry limit was exceeded",
            );
          }

          if (entry.name.startsWith(".") || !entry.isDirectory || entry.isSymlink) continue;
          if (!isSafeEntryName(entry.name)) {
            throw new LocalProjectDiscoveryFailure(
              "unsafe_entry",
              "The project filesystem returned an unsafe directory entry name",
            );
          }
          if (unmanagedAtStart.has(entry.name) || scannedProjects.has(entry.name)) continue;

          const projectPath = join(discoveryRoot, entry.name);
          const projectState = await inspectDirectory(fileSystem, projectPath);
          if (projectState === "missing") continue;
          if (projectState === "unsafe") {
            throw new LocalProjectDiscoveryFailure(
              "unsafe_entry",
              "A discovered local project is not a safe directory",
            );
          }

          const canonicalProjectPath = canonicalDiscoveryRoot === undefined
            ? undefined
            : await requireCanonicalContainedDirectory(
              fileSystem,
              projectPath,
              canonicalDiscoveryRoot,
            );
          if (!await hasProjectMarker(fileSystem, projectPath)) continue;
          if (
            canonicalProjectPath !== undefined &&
            canonicalDiscoveryRoot !== undefined
          ) {
            const verifiedProjectPath = await requireCanonicalContainedDirectory(
              fileSystem,
              projectPath,
              canonicalDiscoveryRoot,
            );
            if (verifiedProjectPath !== canonicalProjectPath) {
              throw new LocalProjectDiscoveryFailure(
                "unsafe_entry",
                "A discovered local project changed physical identity during validation",
              );
            }
          }

          if (unmanagedAtStart.size + scannedProjects.size >= limits.maxProjects) {
            throw new LocalProjectDiscoveryFailure(
              "limit_exceeded",
              "The local project discovery result limit was exceeded",
            );
          }
          scannedProjects.set(entry.name, projectPath);
        }
      }
    } catch (error) {
      throw toDiscoveryFailure(error);
    }

    // Routing can populate the shared cache while an asynchronous scan is in
    // progress. Re-snapshot immediately before publication; externally owned
    // entries win collisions and are never removed by this service.
    const unmanagedAtPublication = snapshotUnmanagedProjects();
    const publishedProjects = new Map<string, string>();
    const completeProjects = new Map(unmanagedAtPublication);
    for (const [slug, path] of scannedProjects) {
      if (completeProjects.has(slug)) continue;
      completeProjects.set(slug, path);
      publishedProjects.set(slug, path);
    }
    if (completeProjects.size > limits.maxProjects) {
      throw new LocalProjectDiscoveryFailure(
        "limit_exceeded",
        "The local project cache changed beyond the configured project limit during discovery",
      );
    }

    // No await occurs during publication, so other requests observe either the
    // previous complete generation or this complete generation.
    for (const [slug, path] of managedProjects) {
      if (cache.projects.get(slug) === path) cache.projects.delete(slug);
    }
    for (const [slug, path] of publishedProjects) {
      cache.projects.set(slug, path);
    }
    managedProjects = publishedProjects;
    return sortProjectSummaries(completeProjects);
  };

  let activeScan: Promise<readonly LocalProjectSummary[]> | undefined;
  return Object.freeze({
    list(): Promise<readonly LocalProjectSummary[]> {
      if (activeScan !== undefined) return activeScan;
      const trackedScan = scan().finally(() => {
        if (activeScan === trackedScan) activeScan = undefined;
      });
      activeScan = trackedScan;
      return trackedScan;
    },
  });
}

/**
 * Check if the request should be admitted by the project-picker route before
 * project-specific runtime context resolution.
 */
export function shouldHandleProjectsUI(
  pathname: string,
  projectSlug: string | undefined,
  parsedDomain: ParsedDomain,
): boolean {
  const isProjectsPath = pathname === "/" ||
    pathname.startsWith("/_projects") ||
    pathname === "/_vf/api/projects";

  return (
    !projectSlug &&
    !parsedDomain.slug &&
    parsedDomain.isVeryfrontDomain &&
    isProjectsPath
  );
}

function createProjectsJsonResponse(
  value: unknown,
  status: number,
  contentType: string,
  headOnly: boolean,
): Response {
  const body = JSON.stringify(value);
  return new Response(headOnly ? null : body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Length": String(textEncoder.encode(body).byteLength),
      "Content-Type": contentType,
    },
  });
}

function createDiscoveryFailureResponse(error: unknown, headOnly: boolean): Response {
  const failure = toDiscoveryFailure(error);
  logger.warn("Local project discovery failed", {
    code: failure.code,
  });
  return createProjectsJsonResponse(
    {
      type: DISCOVERY_PROBLEM_TYPE,
      title: DISCOVERY_PROBLEM_TITLE,
      status: 503,
      detail: DISCOVERY_PROBLEM_DETAIL,
    },
    503,
    "application/problem+json; charset=utf-8",
    headOnly,
  );
}

function cancelRejectedRequestBody(req: Request): void {
  try {
    void req.body?.cancel().catch(() => {});
  } catch {
    // The method is already rejected; a locked or failed hostile stream must
    // not replace that deterministic response.
  }
}

/**
 * Handle a project-picker request using explicitly composed dependencies.
 * Returns null only when the injected UI handler elects to continue.
 */
export async function handleProjectsRequest(
  req: Request,
  url: URL,
  ctx: HandlerContext,
  dependencies: ProjectsRequestDependencies,
): Promise<Response | null> {
  if (url.pathname === "/_vf/api/projects") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      cancelRejectedRequestBody(req);
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: PROJECTS_API_ALLOWED_METHODS,
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const headOnly = req.method === "HEAD";
    try {
      const data = await dependencies.discoveryService.list();
      return createProjectsJsonResponse(
        { data },
        200,
        "application/json; charset=utf-8",
        headOnly,
      );
    } catch (error) {
      return createDiscoveryFailureResponse(error, headOnly);
    }
  }

  const result = await dependencies.projectsHandler.handle(req, ctx);
  return result.response ?? null;
}
