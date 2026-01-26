import type { ImportMapConfig } from "./types.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import {
  getDenoNpmReactMap,
  getReactImportMap,
} from "#veryfront/transforms/esm/package-registry.ts";

function getFrameworkRoot(): string {
  try {
    const rootPath = new URL("../../..", import.meta.url).pathname;
    return rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  } catch {
    // Fallback for environments where import.meta.url doesn't work correctly
    // Use cwd() as a reasonable fallback instead of "/" which would create invalid paths
    if (typeof Deno !== "undefined" && typeof Deno.cwd === "function") {
      const cwd = Deno.cwd();
      return cwd.endsWith("/") ? cwd : `${cwd}/`;
    }

    if (typeof process !== "undefined" && typeof process.cwd === "function") {
      const cwd = process.cwd();
      return cwd.endsWith("/") ? cwd : `${cwd}/`;
    }

    throw new Error(
      "Unable to determine framework root: import.meta.url is unavailable and neither Deno.cwd() nor process.cwd() are supported in this environment.",
    );
  }
}

function getVeryfrontSsrImportMap(): Record<string, string> {
  const srcPath = `file://${getFrameworkRoot()}src`;
  const head = `${srcPath}/react/components/Head.tsx`;
  const router = `${srcPath}/react/router/index.ts`;
  const context = `${srcPath}/react/context/index.ts`;
  const fonts = `${srcPath}/react/fonts/index.ts`;

  return {
    "veryfront/head": head,
    "veryfront/router": router,
    "veryfront/context": context,
    "veryfront/fonts": fonts,
    "veryfront/react/head": head,
    "veryfront/react/router": router,
    "veryfront/react/context": context,
    "veryfront/react/fonts": fonts,
  };
}

/**
 * Get React import map for SSR in Deno.
 * Uses npm: specifiers which Deno handles natively with automatic deduplication.
 * See: https://deno.com/blog/not-using-npm-specifiers-doing-it-wrong
 *
 * This replaces the previous shared-*.ts approach which required manual re-exports.
 */
export function getDenoReactImportMap(): Record<string, string> {
  return getDenoNpmReactMap();
}

/**
 * Get the default import map for SSR transforms.
 *
 * For Deno SSR: Uses npm: specifiers with automatic deduplication.
 * For other runtimes: Uses esm.sh URLs with external=react.
 */
export function getDefaultImportMap(): ImportMapConfig {
  const reactMap = isDeno ? getDenoReactImportMap() : getReactImportMap();
  const veryfrontMap = getVeryfrontSsrImportMap();

  // For Deno SSR, add scopes so that esm.sh modules with external=react
  // resolve their bare `react` imports to npm: specifiers.
  const scopes = isDeno ? { "https://esm.sh/": getDenoReactImportMap() } : undefined;

  return {
    imports: { ...veryfrontMap, ...reactMap },
    scopes,
  };
}
