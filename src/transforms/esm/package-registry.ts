/****
 * Central package version and URL registry.
 *
 * Re-exports from the unified import-rewriter module.
 * This file is kept for backward compatibility with existing imports.
 */

import { rendererLogger } from "#veryfront/utils";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { CONFIG_PARSE_ERROR, VeryfrontError } from "#veryfront/errors";

const logger = rendererLogger.component("package-registry");
import type { VeryfrontConfig } from "#veryfront/config";
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
}

const dependencyVersionCache = new Map<string, CachedDependencyVersions>();
const MAX_DEPENDENCY_VERSION_CACHE_ENTRIES = 1_000;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

function setCachedDependencyVersions(path: string, value: CachedDependencyVersions): void {
  if (
    !dependencyVersionCache.has(path) &&
    dependencyVersionCache.size >= MAX_DEPENDENCY_VERSION_CACHE_ENTRIES
  ) {
    const oldestPath = dependencyVersionCache.keys().next().value;
    if (oldestPath !== undefined) dependencyVersionCache.delete(oldestPath);
  }
  dependencyVersionCache.set(path, value);
}

function parseDependencyRecord(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw CONFIG_PARSE_ERROR.create({
      detail: "Project package.json dependency fields must be JSON objects.",
    });
  }

  const entries = Object.entries(value);
  if (entries.some(([, version]) => typeof version !== "string")) {
    throw CONFIG_PARSE_ERROR.create({
      detail: "Project package.json dependency versions must be strings.",
    });
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

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
    `Invalid React version format. Using default version ${DEFAULT_REACT_VERSION}.`,
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

function getPackageJsonPath(projectDir: string): string {
  return `${projectDir}/package.json`;
}

function getMtimeMs(mtime: Date | null | undefined): number | null {
  return mtime instanceof Date ? mtime.getTime() : null;
}

export async function readProjectDependencyVersions(
  projectDir: string,
): Promise<{ react?: string; veryfront?: string }> {
  const packageJsonPath = getPackageJsonPath(projectDir);

  try {
    const fs = createFileSystem();
    const stat = await fs.stat(packageJsonPath);
    if (!stat.isFile || stat.size > MAX_PACKAGE_JSON_BYTES) {
      throw CONFIG_PARSE_ERROR.create({
        detail: "Project package.json is not a regular file or exceeds the size limit.",
      });
    }
    const mtimeMs = getMtimeMs(stat.mtime);
    const cached = dependencyVersionCache.get(packageJsonPath);

    if (cached && cached.mtimeMs === mtimeMs) {
      return { react: cached.react, veryfront: cached.veryfront };
    }

    const content = await fs.readTextFile(packageJsonPath);
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw CONFIG_PARSE_ERROR.create({
        detail: "Project package.json must contain a JSON object.",
      });
    }
    const pkg = parsed as Record<string, unknown>;
    const deps = {
      ...parseDependencyRecord(pkg.dependencies),
      ...parseDependencyRecord(pkg.devDependencies),
    };
    const react = deps.react ? normalizeReactVersion(stripSemverRange(deps.react)) : undefined;
    const veryfront = deps.veryfront ? stripSemverRange(deps.veryfront) : undefined;

    setCachedDependencyVersions(packageJsonPath, { mtimeMs, react, veryfront });

    return { react, veryfront };
  } catch (error) {
    if (isNotFoundError(error)) return {};
    if (error instanceof VeryfrontError) throw error;

    logger.warn("Failed to read project dependency versions", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw CONFIG_PARSE_ERROR.create({
      detail: "Veryfront could not read or parse project package.json.",
    });
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
