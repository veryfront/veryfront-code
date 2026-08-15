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
import { OutboundRequestBlockedError } from "#veryfront/security/http/outbound-fetch.ts";
import {
  appendSameOriginSSRDependencyPinningKey,
  normalizeExtension,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { parseBarePackageSpecifier } from "../shared/package-specifier.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";
import { isServerOnlyPackage } from "../shared/server-only-packages.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";

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

const ReflectApply = Reflect.apply;
const RegExpTest = RegExp.prototype.test;
const StringSlice = String.prototype.slice;
const StringStartsWith = String.prototype.startsWith;

function regexpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpTest, pattern, [value]) as boolean;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]) as boolean;
}

/** Function signature for caching an HTTP module and returning its local path. */
export type CacheHttpModuleFn = (url: string, options: CacheOptions) => Promise<string | null>;

function parseHttpBase(value?: string): URL | undefined {
  if (!value || !regexpTest(/^https?:\/\//i, value)) return undefined;

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function canonicalizeHttpSpecifier(
  specifier: string,
  baseUrl?: string,
  moduleServerOrigin?: string,
): string {
  if (regexpTest(/^https?:\/\//i, specifier)) return new URL(specifier).toString();
  if (!stringStartsWith(specifier, "//")) return specifier;

  const resolutionBase = parseHttpBase(baseUrl) ?? parseHttpBase(moduleServerOrigin);
  if (!resolutionBase) {
    throw new Error(`Cannot resolve protocol-relative HTTP module ${specifier}`);
  }
  const resolved = new URL(specifier, resolutionBase);
  // A protocol-relative specifier inherits the resolution base's scheme, and
  // the base may be a plaintext local-dev module-server origin. Only the
  // base's own host may keep that scheme; executable code from any other
  // host must never be fetched over plaintext because of a dev-origin scheme.
  if (resolved.protocol === "http:" && resolved.host !== resolutionBase.host) {
    resolved.protocol = "https:";
  }
  return resolved.toString();
}

function isLocalMappedSpecifier(specifier: string): boolean {
  return stringStartsWith(specifier, "/_vf_modules/") ||
    stringStartsWith(specifier, "_vf_modules/") ||
    stringStartsWith(specifier, "file://");
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
  specifier = canonicalizeHttpSpecifier(
    specifier,
    baseUrl,
    options.moduleServerOrigin,
  );
  if (isExternalScheme(specifier)) return null;

  // The "@/" project alias always denotes the project's own module transport.
  // An alias that escaped every upstream rewrite must land there too: treating
  // it as a bare specifier would route it to esm.sh as a bogus scoped package,
  // and a project import map that maps "@/" to a relative prefix would resolve
  // it against the page's public origin, which answers with HTML
  // (VERYFRONT-SERVER-G).
  //
  // The URL shape is not invented here. It reproduces `AliasStrategy.rewrite`
  // (transforms/import-rewriter/strategies/alias-strategy.ts), the framework's
  // canonical "@/" rewriter, which emits this same shape for both its `ssr` and
  // its browser target: `normalizeExtension`, then append `.js` unless the
  // result already ends in a JS-like or CSS extension. A different shape here
  // would resolve one specifier to two different module URLs.
  if (stringStartsWith(specifier, "@/")) {
    const mappedAlias = resolveImport(specifier, options.importMap);
    if (mappedAlias !== specifier && isLocalMappedSpecifier(mappedAlias)) return mappedAlias;

    const { path: pathOnly, suffix } = splitSpecifierSuffix(stringSlice(specifier, 2));
    const normalizedPath = normalizeExtension(pathOnly);
    const jsPath = regexpTest(/\.(js|mjs|cjs|css)$/, normalizedPath)
      ? normalizedPath
      : `${normalizedPath}.js`;
    const projectModulePath = `/_vf_modules/${jsPath}${suffix}`;
    const moduleServerOrigin = parseHttpBase(options.moduleServerOrigin);
    if (!moduleServerOrigin) return projectModulePath;

    return resolveSpecifier(
      new URL(projectModulePath, moduleServerOrigin).toString(),
      baseUrl,
      options,
      cacheHttpModule,
    );
  }

  // Server-only packages (`redis`, `pg`, …), including their explicit `npm:`
  // form, must never be routed through esm.sh. esm.sh either 500s building them
  // or emits a browser bundle with Node built-ins stubbed that can never
  // connect. The framework's adapters only `import()` them behind a lazy,
  // configured code path, so leaving the specifier external lets the runtime
  // resolve the real package (node_modules on Node, npm: on Deno) if and when
  // the backend is actually used, and costs nothing when it is not.
  const serverOnlyCandidate = stringStartsWith(specifier, "npm:")
    ? stringSlice(specifier, 4)
    : specifier;
  const serverOnlyParsed = parseBarePackageSpecifier(serverOnlyCandidate);
  if (serverOnlyParsed && isServerOnlyPackage(serverOnlyParsed.packageName)) return null;

  if (isInternalBare(specifier)) {
    const mapped = resolveImport(specifier, options.importMap);
    if (mapped === specifier) return null;
    if (isLocalMappedSpecifier(mapped)) return mapped;
    return resolveSpecifier(mapped, baseUrl, options, cacheHttpModule);
  }

  if (stringStartsWith(specifier, "npm:")) {
    const bareSpecifier = stringSlice(specifier, 4);
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

    const effectiveSpecifier = appendSameOriginSSRDependencyPinningKey(
      specifier,
      options.dependencyPinningCacheKey,
      options.moduleServerOrigin,
    );
    const cached = await cacheHttpModule(effectiveSpecifier, options);
    if (!cached) {
      throw new Error(`Failed to cache absolute HTTP module ${effectiveSpecifier}`);
    }

    if (isParentHttpModule(baseUrl)) {
      return `./${basename(cached)}`;
    }
    return `file://${cached}`;
  }

  if (isRelative(specifier)) {
    if (stringStartsWith(specifier, "/_vf_modules/")) return null;
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

/** Complete specifier replacements for one module. */
export interface SpecifierReplacements {
  readonly replacements: ReadonlyMap<string, string>;
}

/** Module code whose resolvable imports have been rewritten. */
export interface RewrittenModule {
  readonly code: string;
}

/**
 * Build a map of specifier replacements by resolving all imports in the code.
 *
 * Resolution failure is fatal. In particular, an absolute dynamic HTTP import
 * may never be emitted unresolved: doing so would let the runtime loader bypass
 * the guarded fetch and DNS-pinning policy used while populating the cache.
 */
export async function buildReplacements(
  code: string,
  baseUrl: string | undefined,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<SpecifierReplacements> {
  const imports = await parseImports(code);
  const uniqueSpecifiers = [...new Set(imports.map((imp) => imp.n).filter(Boolean))] as string[];

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
      if (!resolved && isHttpUrl(resolvedFor)) {
        throw new Error(`Failed to resolve absolute HTTP module ${resolvedFor}`);
      }
      if (resolved && resolved !== resolvedFor) replacements.set(resolvedFor, resolved);
      continue;
    }

    // An egress-policy denial is an authorization decision, not a transient
    // prefetch failure. Leaving the original absolute import in the emitted
    // bundle would let the runtime resolve it with its unrestricted loader and
    // bypass the guarded transport entirely.
    if (outcome.reason instanceof OutboundRequestBlockedError) throw outcome.reason;

    throw outcome.reason;
  }

  return { replacements };
}

/**
 * Rewrite all HTTP/npm/bare import specifiers in module code to local cached paths.
 *
 * Resolution is atomic: a failed absolute HTTP import rejects instead of
 * emitting a partially rewritten module.
 */
export async function rewriteModuleImports(
  code: string,
  moduleUrl: string,
  options: CacheOptions,
  cacheHttpModule: CacheHttpModuleFn,
): Promise<RewrittenModule> {
  const { replacements } = await buildReplacements(
    code,
    moduleUrl,
    options,
    cacheHttpModule,
  );
  if (replacements.size === 0) return { code };

  return {
    code: await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null),
  };
}
