/**
 * Import specifier resolution and rewriting for HTTP module caching.
 *
 * Resolves npm:, http://, relative, and bare specifiers to local cached paths,
 * then rewrites import statements in module code to use those paths.
 *
 * @module transforms/esm/specifier-resolver
 */

import { basename } from "#veryfront/compat/path/index.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import { OutboundRequestBlockedError } from "#veryfront/security/http/outbound-fetch.ts";
import {
  appendSameOriginSSRDependencyPinningKey,
  normalizeExtension,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { isContainedProjectAliasPath } from "#veryfront/transforms/shared/alias-containment.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";
import { parseBarePackageSpecifier } from "../shared/package-specifier.ts";
import { isServerOnlyPackage } from "../shared/server-only-packages.ts";
import { parseImports, replaceSpecifiers } from "./lexer.ts";

import {
  type CacheOptions,
  fingerprintHttpModuleRequest,
  getEffectiveHttpCacheRequest,
  isCanonicalReactEsmUrl,
  isExternalScheme,
  isHttpUrl,
  isInternalBare,
  isParentHttpModule,
  isRelative,
  normalizeHttpUrl,
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

function classifyAuthoredPackageFetchError(
  error: unknown,
  requestedPackageFingerprint: string | undefined,
): unknown {
  const snapshot = snapshotVeryfrontError(error);
  const context = snapshot?.context;
  if (
    snapshot?.slug !== BUILD_FAILED.slug ||
    typeof context !== "object" || context === null ||
    typeof requestedPackageFingerprint !== "string" ||
    (context as { httpStatus?: unknown }).httpStatus !== 404 ||
    (context as { httpModuleRequestFingerprint?: unknown }).httpModuleRequestFingerprint !==
      requestedPackageFingerprint
  ) {
    return error;
  }

  return BUILD_FAILED.create({
    message: snapshot.message,
    detail: snapshot.detail,
    cause: error,
    context: {
      httpStatus: 404,
      httpModuleRequestFingerprint: requestedPackageFingerprint,
      tenantBuildFailure: true,
    },
  });
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

const MODULE_TRANSPORT_PREFIX = "/_vf_modules/";

function isLocalMappedSpecifier(specifier: string): boolean {
  return stringStartsWith(specifier, MODULE_TRANSPORT_PREFIX) ||
    stringStartsWith(specifier, "_vf_modules/") ||
    stringStartsWith(specifier, "file://");
}

/**
 * Origin used to canonicalize module-transport paths when the caller has no
 * module-server origin. `.invalid` is reserved (RFC 2606) and can never
 * resolve, so it only ever supplies WHATWG path normalization — the same
 * normalization the browser or importing runtime applies to the emitted
 * specifier — and never a fetchable target.
 */
const CONTAINMENT_BASE = "https://module-transport.invalid/";

/**
 * True when `specifier` still lands inside `/_vf_modules/` after the URL
 * parser has collapsed dot segments, mapped backslashes and stripped the
 * characters (NUL/TAB/CR/LF) it removes before parsing.
 *
 * A prefix test alone is not containment: `/_vf_modules/../_veryfront/…`
 * starts with the transport prefix yet normalizes out of it.
 */
function isContainedModuleTransportSpecifier(specifier: string): boolean {
  // A `file://` target names an already-cached artifact on disk, not a
  // same-origin transport URL, so it cannot be normalized onto an arbitrary
  // application route and this containment rule does not apply to it.
  if (stringStartsWith(specifier, "file://")) return true;

  let resolved: URL;
  try {
    resolved = new URL(specifier, CONTAINMENT_BASE);
  } catch {
    return false;
  }

  return `${resolved.origin}/` === CONTAINMENT_BASE &&
    stringStartsWith(resolved.pathname, MODULE_TRANSPORT_PREFIX);
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
    const { path: pathOnly, suffix } = splitSpecifierSuffix(stringSlice(specifier, 2));
    // The alias path is tenant-authored and decides where the composed
    // `/_vf_modules/` URL finally points, so it has to satisfy the shared
    // containment rule before anything is composed from it. That rule lives in
    // `transforms/shared/alias-containment.ts` and is enforced identically by
    // `AliasStrategy.rewrite` and the SSR adapter, so the browser, SSR and
    // module-cache paths cannot drift apart. It is a pure guard, so an
    // accepted path keeps the exact `AliasStrategy.rewrite` byte shape
    // composed below.
    //
    // The authored suffix is a query string or fragment and can carry tenant
    // credentials (`@/module?token=…`), so the diagnostics below name the
    // alias by its path alone — AGENTS.md, "Secret and internal-detail
    // safety", forbids echoing such values into error messages.
    const reportedAlias = suffix === "" ? `@/${pathOnly}` : `@/${pathOnly}<redacted suffix>`;
    if (!isContainedProjectAliasPath(pathOnly)) {
      throw new Error(
        `Refusing to resolve project alias ${reportedAlias}: its path escapes the /_vf_modules/ module transport`,
      );
    }

    const mappedAlias = resolveImport(specifier, options.importMap);
    if (mappedAlias !== specifier && isLocalMappedSpecifier(mappedAlias)) {
      // A configured "@/" mapping is not exempt from containment. A target
      // like "/_vf_modules/../_veryfront/modules/" keeps the transport prefix
      // that `isLocalMappedSpecifier` matches, yet the importing runtime
      // normalizes the emitted specifier straight back out of the transport.
      // Validate the resolved target, not its literal prefix.
      if (!isContainedModuleTransportSpecifier(mappedAlias)) {
        throw new Error(
          `Refusing to resolve project alias ${reportedAlias}: its import-map target resolves outside the /_vf_modules/ module transport`,
        );
      }
      return mappedAlias;
    }

    const normalizedPath = normalizeExtension(pathOnly);
    const jsPath = regexpTest(/\.(js|mjs|cjs|css)$/, normalizedPath)
      ? normalizedPath
      : `${normalizedPath}.js`;
    const projectModulePath = `${MODULE_TRANSPORT_PREFIX}${jsPath}${suffix}`;
    // Canonicalize the composed path even when there is no module-server
    // origin. That branch returns the path for the importing runtime to
    // resolve itself, so it needs the same post-composition containment check
    // rather than trusting the character guards above to have been exhaustive.
    const moduleServerOrigin = parseHttpBase(options.moduleServerOrigin);
    const projectModuleUrl = new URL(projectModulePath, moduleServerOrigin ?? CONTAINMENT_BASE);
    if (!stringStartsWith(projectModuleUrl.pathname, MODULE_TRANSPORT_PREFIX)) {
      throw new Error(
        `Refusing to resolve project alias ${reportedAlias}: it resolved outside the /_vf_modules/ module transport`,
      );
    }
    if (!moduleServerOrigin) return projectModulePath;

    return resolveSpecifier(
      projectModuleUrl.toString(),
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
  if (
    serverOnlyParsed &&
    isServerOnlyPackage(serverOnlyParsed.packageName, options.serverExternalPackages)
  ) return null;

  if (isInternalBare(specifier)) {
    const mapped = resolveImport(specifier, options.importMap);
    if (mapped === specifier) return null;
    if (isLocalMappedSpecifier(mapped)) return mapped;
    return resolveSpecifier(mapped, baseUrl, options, cacheHttpModule);
  }

  if (stringStartsWith(specifier, "npm:")) {
    const bareSpecifier = stringSlice(specifier, 4);
    const requestedPackageUrl = `https://esm.sh/${bareSpecifier}`;
    let cached: string | null;
    try {
      cached = await cacheHttpModule(requestedPackageUrl, options);
    } catch (error) {
      const effective = getEffectiveHttpCacheRequest(requestedPackageUrl, options);
      const requestedPackageFingerprint = await fingerprintHttpModuleRequest(
        normalizeHttpUrl(effective.url),
      );
      throw classifyAuthoredPackageFetchError(error, requestedPackageFingerprint);
    }
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

  let requestedPackageUrl: string | undefined;
  const cacheAuthoredPackage: CacheHttpModuleFn = async (url, cacheOptions) => {
    const effective = getEffectiveHttpCacheRequest(url, cacheOptions);
    requestedPackageUrl ??= normalizeHttpUrl(effective.url);
    return await cacheHttpModule(url, cacheOptions);
  };

  try {
    return await resolveSpecifier(mapped, baseUrl, options, cacheAuthoredPackage);
  } catch (error) {
    const requestedPackageFingerprint = requestedPackageUrl === undefined
      ? undefined
      : await fingerprintHttpModuleRequest(requestedPackageUrl);
    throw classifyAuthoredPackageFetchError(error, requestedPackageFingerprint);
  }
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
