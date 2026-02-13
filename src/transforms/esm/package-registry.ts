/****
 * Central package version and URL registry.
 *
 * Re-exports from the unified import-rewriter module.
 * This file is kept for backward compatibility with existing imports.
 */

import { rendererLogger } from "#veryfront/utils";
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
 * Generate esm.sh URL for browser.
 */
export function getEsmShUrl(
  pkg: string,
  version: string,
  external?: readonly string[],
): string {
  const params = ["target=es2022"];
  if (external?.length) params.push(`external=${external.join(",")}`);
  return `https://esm.sh/${pkg}@${version}?${params.join("&")}`;
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
 * Get React esm.sh URLs for Deno SSR.
 */
export function getDenoNpmReactMap(version?: string): Record<string, string> {
  return getReactUrls(version);
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
  // Intentionally empty: resolveProjectReactVersion reads package.json per call
  // to avoid stale version values in long-lived processes.
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
    try {
      const { createFileSystem } = await import("../../platform/compat/fs.ts");
      const fs = createFileSystem();
      const content = await fs.readTextFile(`${projectDir}/package.json`);
      const pkg = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const rawVersion = deps.react;
      if (rawVersion) {
        const stripped = stripSemverRange(rawVersion);
        return normalizeReactVersion(stripped);
      }
    } catch {
      // package.json not found or unreadable - fall through to default
    }
  }

  // 3. Fallback to default
  return DEFAULT_REACT_VERSION;
}
