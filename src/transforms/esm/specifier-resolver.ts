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
 * Specifiers the runtime can still resolve on its own if prefetching fails.
 *
 * Two conditions must hold together. The specifier must be reached only
 * through `import(...)`, because a static import is part of the emitted
 * module's own import graph: every static dependency resolves to a local path
 * before the module is handed to the runtime loader, and a failure to do that
 * is fatal, exactly as it was before graceful degradation existed. A dynamic
 * specifier is resolved by the runtime at call time and is routinely guarded by
 * the caller (`platform/adapters/redis/modules.js` only calls
 * `await import("redis")` when the redis adapter is actually used), so failing
 * to prefetch it leaves the specifier in place rather than taking down a render
 * that would never have imported it.
 *
 * The specifier must also be an absolute http(s) URL, because that is the only
 * form the runtime can resolve without the transform. A relative specifier left
 * in place resolves against the local bundle cache directory, where the chunk
 * was never written; `npm:` and bare specifiers need the import map the cached
 * module no longer carries. Those failures stay fatal.
 */
function runtimeResolvableSpecifiers(imports: readonly ImportSpecifier[]): Set<string> {
  const dynamic = new Set<string>();
  const staticSpecifiers = new Set<string>();

  for (const imp of imports) {
    if (!imp.n) continue;
    (imp.d > -1 ? dynamic : staticSpecifiers).add(imp.n);
  }

  for (const specifier of staticSpecifiers) dynamic.delete(specifier);
  for (const specifier of [...dynamic]) {
    if (!isHttpUrl(specifier)) dynamic.delete(specifier);
  }
  return dynamic;
}

/** Specifier replacements plus the specifiers that were left unresolved. */
export interface SpecifierReplacements {
  readonly replacements: ReadonlyMap<string, string>;
  /** Specifiers left in place because prefetching them failed. */
  readonly degraded: readonly string[];
}

/** Rewritten module code plus the specifiers that were left unresolved. */
export interface RewrittenModule {
  readonly code: string;
  /** Specifiers left in place because prefetching them failed. */
  readonly degraded: readonly string[];
}

/**
 * Build a map of specifier replacements by resolving all imports in the code.
 *
 * Resolution failure is fatal unless the runtime can resolve the specifier on
 * its own. See {@link runtimeResolvableSpecifiers}. Every specifier left in
 * place is reported as degraded so callers can decide whether the resulting
 * code is fit to cache.
 */
export async function buildReplacements(
  code: string,
  baseUrl: string | undefined,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<SpecifierReplacements> {
  const imports = await parseImports(code);
  const uniqueSpecifiers = [...new Set(imports.map((imp) => imp.n).filter(Boolean))] as string[];
  const runtimeResolvable = runtimeResolvableSpecifiers(imports);

  const settled = await Promise.allSettled(
    uniqueSpecifiers.map(async (specifier) => ({
      specifier,
      resolved: await resolveSpecifier(specifier, baseUrl, options, cacheHttpModule),
    })),
  );

  const replacements = new Map<string, string>();
  const degraded: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const specifier = uniqueSpecifiers[i];
    if (!outcome || specifier === undefined) continue;

    if (outcome.status === "fulfilled") {
      const { specifier: resolvedFor, resolved } = outcome.value;
      if (resolved && resolved !== resolvedFor) replacements.set(resolvedFor, resolved);
      continue;
    }

    // Anything the runtime cannot resolve on its own must resolve here.
    // Leaving one unresolved would emit a module whose own import graph reaches
    // outside the local cache, which is not what the runtime loader is handed
    // anywhere else.
    if (!runtimeResolvable.has(specifier)) throw outcome.reason;

    degraded.push(specifier);
    logger.warn("Leaving an unresolvable dynamic specifier for runtime resolution", {
      specifier,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    });
  }

  return { replacements, degraded };
}

/**
 * Rewrite all HTTP/npm/bare import specifiers in module code to local cached paths.
 *
 * Reports any specifier left in place, so the caller can keep the resulting
 * code out of the caches that outlive this render.
 */
export async function rewriteModuleImports(
  code: string,
  moduleUrl: string,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<RewrittenModule> {
  const { replacements, degraded } = await buildReplacements(
    code,
    moduleUrl,
    options,
    cacheHttpModule,
  );
  if (replacements.size === 0) return { code, degraded };

  return {
    code: await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null),
    degraded,
  };
}
