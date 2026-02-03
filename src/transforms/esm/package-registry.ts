/****
 * Central package version and URL registry.
 *
 * Re-exports from the unified import-rewriter module.
 * This file is kept for backward compatibility with existing imports.
 */

import { rendererLogger } from "#veryfront/utils";
import {
  buildReactUrl,
  DEFAULT_REACT_VERSION,
  getReactImportMap as getReactImportMapFromRewriter,
  TAILWIND_VERSION,
} from "../import-rewriter/url-builder.ts";

// Re-export constants from unified source
export { DEFAULT_REACT_VERSION, TAILWIND_VERSION };

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
 *
 * IMPORTANT: external=react should ONLY be used for react-dom packages.
 * React subpaths (jsx-runtime, jsx-dev-runtime) are PART of React itself,
 * so they should NOT have external=react (that would cause them to import
 * a separate React instance, creating the "two Reacts" problem).
 */
export function getReactUrls(version?: string): Record<string, string> {
  const v = version ?? DEFAULT_REACT_VERSION;
  return {
    // React core and subpaths - NO external=react (they're part of React itself)
    react: buildReactUrl("react", v),
    "react/jsx-runtime": buildReactUrl("react", v, "/jsx-runtime", false),
    "react/jsx-dev-runtime": buildReactUrl("react", v, "/jsx-dev-runtime", false),
    // react-dom - external=react (separate package that depends on React)
    "react-dom": buildReactUrl("react-dom", v, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", v, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", v, "/server", true),
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
