import * as dntShim from "../../../_dnt.shims.js";
import type { ImportMapConfig } from "./types.js";
import { isDeno } from "../../platform/compat/runtime.js";
import {
  getDenoNpmReactMap,
  getReactImportMap,
} from "../../transforms/esm/package-registry.js";

function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function getFrameworkRoot(): string {
  try {
    return ensureTrailingSlash(new URL("../../..", import.meta.url).pathname);
  } catch {
    // Fallback for environments where import.meta.url doesn't work correctly
    const cwd = (typeof dntShim.Deno !== "undefined" && dntShim.Deno.cwd?.()) ||
      (typeof process !== "undefined" && process.cwd?.());

    if (cwd) return ensureTrailingSlash(cwd);

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
