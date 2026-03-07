/**
 * Import specifier resolution and rewriting for HTTP module caching.
 *
 * Resolves npm:, http://, relative, and bare specifiers to local cached paths,
 * then rewrites import statements in module code to use those paths.
 *
 * @module transforms/esm/specifier-resolver
 */

import { basename } from "#veryfront/compat/path/index.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";
import {
  type CacheOptions,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  resolveBareSpecifier,
} from "./http-cache-helpers.ts";

/** Function signature for caching an HTTP module and returning its local path. */
export type CacheHttpModuleFn = (url: string, options: CacheOptions) => Promise<string | null>;

/**
 * Resolve a single import specifier to a local cached path.
 *
 * Handles npm:, http(s)://, relative, and bare specifiers.
 * Returns null if the specifier should not be rewritten.
 */
export async function resolveSpecifier(
  specifier: string,
  baseUrl: string | undefined,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<string | null> {
  if (isExternalScheme(specifier) || isInternalBare(specifier)) return null;

  if (specifier.startsWith("npm:")) {
    const bareSpecifier = specifier.slice(4);
    const cached = await cacheHttpModule(`https://esm.sh/${bareSpecifier}`, options);
    if (!cached) return bareSpecifier;

    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isHttpUrl(specifier)) {
    const cached = await cacheHttpModule(specifier, options);
    if (!cached) return null;

    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isRelative(specifier)) {
    if (specifier.startsWith("/_vf_modules/")) return null;
    if (!baseUrl || !isHttpUrl(baseUrl)) return null;

    const resolved = new URL(specifier, baseUrl).toString();

    const cached = await cacheHttpModule(resolved, options);
    if (!cached) return null;

    return `./${basename(cached)}`;
  }

  const mapped = resolveBareSpecifier(specifier, options.importMap, options.reactVersion);
  if (mapped === specifier) return null;

  return resolveSpecifier(mapped, baseUrl, options, cacheHttpModule);
}

/**
 * Build a map of specifier replacements by resolving all imports in the code.
 */
export async function buildReplacements(
  code: string,
  baseUrl: string | undefined,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<Map<string, string>> {
  const imports = await parseImports(code);
  const uniqueSpecifiers = [...new Set(imports.map((imp) => imp.n).filter(Boolean))] as string[];

  const results = await Promise.all(
    uniqueSpecifiers.map(async (specifier) => {
      try {
        return {
          specifier,
          resolved: await resolveSpecifier(specifier, baseUrl, options, cacheHttpModule),
        };
      } catch {
        return { specifier, resolved: null };
      }
    }),
  );

  const replacements = new Map<string, string>();
  for (const { specifier, resolved } of results) {
    if (resolved && resolved !== specifier) replacements.set(specifier, resolved);
  }

  return replacements;
}

/**
 * Rewrite all HTTP/npm/bare import specifiers in module code to local cached paths.
 */
export async function rewriteModuleImports(
  code: string,
  moduleUrl: string,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<string> {
  const replacements = await buildReplacements(code, moduleUrl, options, cacheHttpModule);
  if (replacements.size === 0) return code;

  return replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
