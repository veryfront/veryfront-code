import type { ImportMapConfig } from "./types.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function getFrameworkRoot(): string {
  try {
    return ensureTrailingSlash(new URL("../../..", import.meta.url).pathname);
  } catch {
    // Fallback for environments where import.meta.url doesn't work correctly
    const cwd = (typeof Deno !== "undefined" && Deno.cwd?.()) ||
      (typeof process !== "undefined" && process.cwd?.());

    if (cwd) return ensureTrailingSlash(cwd);

    throw new Error(
      "Unable to determine framework root: import.meta.url is unavailable and neither Deno.cwd() nor process.cwd() are supported in this environment.",
    );
  }
}

function getVeryfrontSsrImportMap(): Record<string, string> {
  const srcPath = `file://${getFrameworkRoot()}src`;

  // In Deno source, files have .tsx/.ts extensions
  // In npm package (Node.js/Bun), dnt transforms to .js
  const tsxExt = isDeno ? ".tsx" : ".js";
  const tsExt = isDeno ? ".ts" : ".js";

  const head = `${srcPath}/react/components/Head${tsxExt}`;
  const router = `${srcPath}/react/router/index${tsExt}`;
  const context = `${srcPath}/react/context/index${tsExt}`;
  const fonts = `${srcPath}/react/fonts/index${tsExt}`;

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
 * Get the default import map for SSR transforms.
 * Uses esm.sh URLs consistently (NO npm: specifiers per plan requirements).
 */
export function getDefaultImportMap(): ImportMapConfig {
  const reactMap = getReactImportMap();
  const veryfrontMap = getVeryfrontSsrImportMap();

  return {
    imports: { ...veryfrontMap, ...reactMap },
  };
}
