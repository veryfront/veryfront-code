/****
 * Central package version and URL registry.
 *
 * Re-exports from the unified import-rewriter module.
 * This file is kept for backward compatibility with existing imports.
 */

import { rendererLogger } from "#veryfront/utils";

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
    const { createFileSystem } = await import("../../platform/compat/fs.ts");
    const fs = createFileSystem();
    const stat = await fs.stat(packageJsonPath);
    const mtimeMs = getMtimeMs(stat.mtime);
    const cached = dependencyVersionCache.get(packageJsonPath);

    if (cached && cached.mtimeMs === mtimeMs) {
      return { react: cached.react, veryfront: cached.veryfront };
    }

    const content = await fs.readTextFile(packageJsonPath);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const react = deps.react ? normalizeReactVersion(stripSemverRange(deps.react)) : undefined;
    const veryfront = deps.veryfront ? stripSemverRange(deps.veryfront) : undefined;

    dependencyVersionCache.set(packageJsonPath, { mtimeMs, react, veryfront });

    return { react, veryfront };
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
 * 1. Config override: config.client.cdn.versions.react
 * 2. package.json detection (via cross-runtime filesystem)
 * 3. DEFAULT_REACT_VERSION fallback
 *
 * This is the single source of truth for React version resolution.
 * Both HTML import map generation and module server transforms should use this.
 */
export async function resolveProjectReactVersion(options: {
  projectDir?: string | null;
  config?: VeryfrontConfig | null;
}): Promise<string> {
  const { projectDir, config } = options;

  // 1. Config override takes highest priority
  const versionsConfig = config?.client?.cdn?.versions;
  if (versionsConfig && versionsConfig !== "auto") {
    const configVersion = versionsConfig.react;
    if (configVersion) {
      const normalized = normalizeReactVersion(stripSemverRange(configVersion));
      return normalized;
    }
  }

  // 2. Detect from package.json
  if (projectDir) {
    const detected = await readProjectDependencyVersions(projectDir);
    if (detected.react) return detected.react;
  }

  // 3. Fallback to default
  return DEFAULT_REACT_VERSION;
}
