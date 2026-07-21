/**
 * Import specifier resolution and rewriting for HTTP module caching.
 *
 * Resolves npm:, http://, relative, and bare specifiers to local cached paths,
 * then rewrites import statements in module code to use those paths.
 *
 * @module transforms/esm/specifier-resolver
 */

import { basename } from "#veryfront/compat/path/index.ts";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import { rendererLogger } from "#veryfront/utils";
import { type ImportSpecifier, parseImports, replaceSpecifiers } from "./lexer.ts";

const logger = rendererLogger.component("specifier-resolver");
import {
  type CacheOptions,
  isCanonicalReactEsmUrl,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  resolveBareSpecifier,
} from "./http-cache-helpers.ts";

/** Function signature for caching an HTTP module and returning its local path. */
export type CacheHttpModuleFn = (url: string, options: CacheOptions) => Promise<string | null>;

function isLocalMappedSpecifier(specifier: string): boolean {
  return specifier.startsWith("/_vf_modules/") ||
    specifier.startsWith("_vf_modules/") ||
    specifier.startsWith("file://");
}

/**
 * Resolve a single import specifier to a local cached path.
 *
 * Handles npm:, http(s)://, relative, and bare specifiers.
 * Returns null if the specifier should not be rewritten.
 */
async function resolveSpecifier(
  specifier: string,
  baseUrl: string | undefined,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<string | null> {
  if (isExternalScheme(specifier)) return null;

  if (isInternalBare(specifier)) {
    const mapped = resolveImport(specifier, options.importMap);
    if (mapped === specifier) return null;
    if (isLocalMappedSpecifier(mapped)) return mapped;
    return resolveSpecifier(mapped, baseUrl, options, cacheHttpModule);
  }

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
    // A generated React URL already carries the project's exact version.
    // Import-map URL matching must not replace it with a framework default,
    // or React and react-dom/server can load different singleton instances.
    const mapped = isCanonicalReactEsmUrl(specifier)
      ? specifier
      : resolveImport(specifier, options.importMap);
    if (mapped !== specifier) {
      if (isLocalMappedSpecifier(mapped)) return mapped;
      return resolveSpecifier(mapped, baseUrl, options, cacheHttpModule);
    }

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
  if (isLocalMappedSpecifier(mapped)) return mapped;

  return resolveSpecifier(mapped, baseUrl, options, cacheHttpModule);
}

/**
 * Specifiers this module only ever reaches through `import(...)`.
 *
 * The distinction decides what a resolution failure means. A static import is
 * part of the emitted module's own import graph, so the artifact contract holds
 * for it: every static dependency resolves to a local path before the module is
 * handed to the runtime loader, and a failure to do that is fatal, exactly as
 * it was before graceful degradation existed.
 *
 * A dynamic specifier is resolved by the runtime at call time and is routinely
 * guarded by the caller (`platform/adapters/redis/modules.js` only calls
 * `await import("redis")` when the redis adapter is actually used). Pre-fetching
 * it is an optimisation, so failing to pre-fetch it leaves the specifier in
 * place rather than taking down a render that would never have imported it.
 */
function isDynamicOnly(imports: readonly ImportSpecifier[]): Set<string> {
  const dynamic = new Set<string>();
  const staticSpecifiers = new Set<string>();

  for (const imp of imports) {
    if (!imp.n) continue;
    (imp.d > -1 ? dynamic : staticSpecifiers).add(imp.n);
  }

  for (const specifier of staticSpecifiers) dynamic.delete(specifier);
  return dynamic;
}

/**
 * Build a map of specifier replacements by resolving all imports in the code.
 *
 * Resolution failure is fatal for a static import and best-effort for a
 * specifier only ever used in `import(...)`. See {@link isDynamicOnly}.
 */
export async function buildReplacements(
  code: string,
  baseUrl: string | undefined,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<Map<string, string>> {
  const imports = await parseImports(code);
  const uniqueSpecifiers = [...new Set(imports.map((imp) => imp.n).filter(Boolean))] as string[];
  const dynamicOnly = isDynamicOnly(imports);

  const settled = await Promise.allSettled(
    uniqueSpecifiers.map(async (specifier) => ({
      specifier,
      resolved: await resolveSpecifier(specifier, baseUrl, options, cacheHttpModule),
    })),
  );

  const replacements = new Map<string, string>();
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const specifier = uniqueSpecifiers[i];
    if (!outcome || specifier === undefined) continue;

    if (outcome.status === "fulfilled") {
      const { specifier: resolvedFor, resolved } = outcome.value;
      if (resolved && resolved !== resolvedFor) replacements.set(resolvedFor, resolved);
      continue;
    }

    // A static import must resolve. Leaving one unresolved would emit a module
    // whose own import graph reaches outside the local cache, which is not what
    // the runtime loader is handed anywhere else.
    if (!dynamicOnly.has(specifier)) throw outcome.reason;

    logger.warn("Leaving an unresolvable dynamic specifier for runtime resolution", {
      specifier,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    });
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
