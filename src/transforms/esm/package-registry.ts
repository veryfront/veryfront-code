/****
 * Central package version and URL registry.
 *
 * Re-exports from the unified import-rewriter module.
 * This file is kept for backward compatibility with existing imports.
 */

import { rendererLogger } from "#veryfront/utils";

const logger = rendererLogger.component("package-registry");
import type { VeryfrontConfig } from "#veryfront/config";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  buildReactUrl,
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
  getReactImportMap as getReactImportMapFromRewriter,
  TAILWIND_VERSION,
} from "../import-rewriter/url-builder.ts";

// Re-export constants from unified source
export { CSSTYPE_VERSION, DEFAULT_REACT_VERSION, TAILWIND_VERSION };

interface CachedDependencyVersions {
  mtimeMs: number | null;
  react?: string;
  veryfront?: string;
  /** Full merged dependency map (dependencies + devDependencies, raw semver strings). */
  dependencies?: Record<string, string>;
}

const dependencyVersionCache = new Map<string, CachedDependencyVersions>();

/**
 * Validate React version format (semver: X.Y.Z).
 */
export function isValidReactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Validate and normalize React version.
 */
export function normalizeReactVersion(version: string | undefined): string {
  if (!version) return DEFAULT_REACT_VERSION;
  if (isValidReactVersion(version)) return version;

  rendererLogger.warn(
    `Invalid React version format "${version}" (expected X.Y.Z). Using default: ${DEFAULT_REACT_VERSION}`,
  );
  return DEFAULT_REACT_VERSION;
}

/**
 * Build esm.sh URL with deps=csstype for React packages.
 */
export function esmShReact(
  pkg: string,
  version: string,
  path = "",
  external = false,
): string {
  return buildReactUrl(
    pkg as "react" | "react-dom",
    version,
    path || undefined,
    external,
  );
}

/**
 * Get React esm.sh URLs with consistent versioning.
 */
export function getReactUrls(version?: string): Record<string, string> {
  const v = version ?? DEFAULT_REACT_VERSION;
  return {
    react: buildReactUrl("react", v),
    "react-dom": buildReactUrl("react-dom", v, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", v, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", v, "/server", true),
    "react/jsx-runtime": buildReactUrl("react", v, "/jsx-runtime", true),
    "react/jsx-dev-runtime": buildReactUrl("react", v, "/jsx-dev-runtime", true),
  };
}

/**
 * Get complete React import map for esm.sh.
 */
export function getReactImportMap(version?: string): Record<string, string> {
  return getReactImportMapFromRewriter(version ?? DEFAULT_REACT_VERSION);
}

/**
 * Strip semver range prefixes (^, ~, >=, >, <=, <, =) from a version string.
 */
export function stripSemverRange(version: string): string {
  return version.replace(/^[~^>=<]+/, "");
}

/**
 * Compatibility no-op. Kept for tests and older call sites.
 */
export function clearReactVersionCache(): void {
  dependencyVersionCache.clear();
}

/**
 * For tests only — prime the in-process dependency cache for a given project directory,
 * simulating a package.json that has already been read by readProjectDependencyVersions.
 */
export function _primeDependenciesCache(
  projectDir: string,
  dependencies: Record<string, string>,
): void {
  dependencyVersionCache.set(getPackageJsonPath(projectDir), { mtimeMs: null, dependencies });
}

/**
 * Synchronously return the full dependency map for a project from the in-process
 * cache, or undefined when the cache has not been warmed yet.
 *
 * The cache is populated by readProjectDependencyVersions(). Call sites that
 * need the map synchronously (e.g. import rewrite strategies) should trigger
 * an async warm-up early in the request lifecycle and then use this accessor.
 */
export function getProjectDependenciesSync(
  projectDir: string,
): Record<string, string> | undefined {
  return dependencyVersionCache.get(getPackageJsonPath(projectDir))?.dependencies;
}

/**
 * When VERYFRONT_DEPENDENCY_PINNING=1, ensure the project's package.json has
 * been read into the in-process dependency cache. No-op when the flag is off
 * or when projectDir is absent. Repeat calls within the same process are cheap
 * because readProjectDependencyVersions is mtime-guarded.
 *
 * Call this early in each request/build lifecycle — before any synchronous
 * getProjectDependenciesSync calls run — so that bare-import pin lookups find
 * the cache warm even when resolveProjectReactVersion is bypassed (e.g. when
 * config.react.version is set or an explicitReactVersion is supplied by the
 * caller).
 */
export async function ensureProjectDependenciesLoaded(
  projectDir: string | null | undefined,
): Promise<void> {
  if (!projectDir || getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) !== "1") return;
  await readProjectDependencyVersions(projectDir);
}

function getPackageJsonPath(projectDir: string): string {
  return `${projectDir}/package.json`;
}

function getMtimeMs(mtime: Date | null | undefined): number | null {
  return mtime instanceof Date ? mtime.getTime() : null;
}

export async function readProjectDependencyVersions(
  projectDir: string,
): Promise<{ react?: string; veryfront?: string; dependencies?: Record<string, string> }> {
  const packageJsonPath = getPackageJsonPath(projectDir);

  try {
    const { createFileSystem } = await import("../../platform/compat/fs.ts");
    const fs = createFileSystem();
    const stat = await fs.stat(packageJsonPath);
    const mtimeMs = getMtimeMs(stat.mtime);
    const cached = dependencyVersionCache.get(packageJsonPath);

    if (cached && cached.mtimeMs === mtimeMs) {
      return {
        react: cached.react,
        veryfront: cached.veryfront,
        dependencies: cached.dependencies,
      };
    }

    const content = await fs.readTextFile(packageJsonPath);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const react = deps.react ? normalizeReactVersion(stripSemverRange(deps.react)) : undefined;
    const veryfront = deps.veryfront ? stripSemverRange(deps.veryfront) : undefined;

    // Preserve raw semver strings in the full map so callers can strip ranges as needed.
    const dependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === "string") dependencies[name] = version;
    }

    dependencyVersionCache.set(packageJsonPath, { mtimeMs, react, veryfront, dependencies });

    return { react, veryfront, dependencies };
  } catch (error) {
    // ENOENT means there is no package.json in the project dir — expected for
    // framework-only environments.  Any other error (permission denied, malformed
    // JSON, etc.) is logged at warn so it is visible without crashing the server.
    const isNotFound = error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT";
    if (!isNotFound) {
      logger.warn("Failed to read project dependency versions", {
        packageJsonPath,
        error: String(error),
      });
    }
    return {};
  }
}

/**
 * Resolve React version for a project with consistent priority:
 * 1. Public config override: config.react.version
 * 2. Legacy CDN config override: config.client.cdn.versions.react
 * 3. package.json detection (via cross-runtime filesystem)
 * 4. DEFAULT_REACT_VERSION fallback
 *
 * This is the single source of truth for React version resolution.
 * Both HTML import map generation and module server transforms should use this.
 */
export async function resolveProjectReactVersion(options: {
  projectDir?: string | null;
  config?: VeryfrontConfig | null;
}): Promise<string> {
  const { projectDir, config } = options;

  // 1. The documented public config override takes highest priority.
  const publicConfigVersion = config?.react?.version;
  if (publicConfigVersion) {
    return normalizeReactVersion(stripSemverRange(publicConfigVersion));
  }

  // 2. Preserve the older CDN-specific override for compatibility.
  const versionsConfig = config?.client?.cdn?.versions;
  if (versionsConfig && versionsConfig !== "auto") {
    const configVersion = versionsConfig.react;
    if (configVersion) {
      const normalized = normalizeReactVersion(stripSemverRange(configVersion));
      return normalized;
    }
  }

  // 3. Detect from package.json
  if (projectDir) {
    const detected = await readProjectDependencyVersions(projectDir);
    if (detected.react) return detected.react;
  }

  // 4. Fallback to default
  return DEFAULT_REACT_VERSION;
}
