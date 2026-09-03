import { BUNDLE_ERROR } from "#veryfront/errors";
import { type DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "#veryfront/transforms/esm/react-cdn.ts";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { buildServerExternalPackagesIdentity } from "#veryfront/config/server-external-packages.ts";
import { assertContainedProjectAliasPath } from "#veryfront/transforms/shared/alias-containment.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import { getConfiguredServerExternalRuntimeSpecifier } from "#veryfront/transforms/shared/server-only-packages.ts";
import {
  type DependencyResolutionObservation,
  resolveDependencyPinForImport,
} from "#veryfront/transforms/import-rewriter/dependency-resolution.ts";
import {
  applyImportEdits,
  parseImportEdits,
} from "#veryfront/transforms/import-rewriter/import-edit.ts";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
  type StaticImportSpan,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";

type CacheBuster = number | string;
const JsonStringify = JSON.stringify;
const MAX_CONFIGURED_EXTERNAL_IMPORTS = 500;

function rewriteMatchedImportSpans(
  code: string,
  fromSpans: readonly StaticImportSpan[],
  dynamicSpans: readonly StaticImportSpan[],
  sideEffectSpans: readonly StaticImportSpan[],
): string {
  const replacements: SourceSpanReplacement[] = [
    ...fromSpans.map((span) => ({
      start: span.start,
      end: span.end,
      expected: span.original,
      replacement: `from ${JsonStringify(span.path)}`,
    })),
    ...dynamicSpans.map((span) => ({
      start: span.start,
      end: span.end,
      expected: span.original,
      replacement: JsonStringify(span.path),
    })),
    ...sideEffectSpans.map((span) => ({
      start: span.start,
      end: span.end,
      expected: span.original,
      replacement: `import ${JsonStringify(span.path)}`,
    })),
  ];
  return replacements.length === 0 ? code : replaceSourceSpans(code, replacements);
}

export interface SSRImportRewriteTarget {
  specifier: string;
  kind: "alias" | "relative";
  modulePath: string;
  rewrittenPath: string;
}

export function stripSSRModuleJsExtensionCompat(path: string): string {
  return path.replace(/\.(?:mjs|js)$/i, "");
}

function normalizeSSRModulePath(path: string): string {
  let normalized = path.replace(/^\/+/, "");
  if (normalized.startsWith("_vf_modules/")) {
    normalized = normalized.slice("_vf_modules/".length);
  }
  if (normalized.startsWith("@/")) normalized = normalized.slice(2);
  return normalized;
}

export function resolveSSRImportTargetModulePathCompat(
  target: SSRImportRewriteTarget,
  currentModulePath: string,
): string {
  if (target.kind === "alias") return normalizeSSRModulePath(target.modulePath);

  const currentPath = normalizeSSRModulePath(currentModulePath);
  if (target.specifier.startsWith("/")) {
    return normalizeSSRModulePath(target.specifier);
  }

  const basePath = currentPath.startsWith("/") ? currentPath : `/${currentPath}`;
  const resolved = new URL(target.specifier, `http://veryfront.local${basePath}`).pathname;
  return normalizeSSRModulePath(resolved);
}

export interface SSRRewriteOptions {
  /** Project slug for multi-project routing */
  projectSlug?: string | null;
  /** Branch name for branch-aware routing */
  branch?: string | null;
  /** Cache buster token. When omitted, each rewritten target gets a stable token. */
  cacheBuster?: CacheBuster;
  /** Resolve a cache buster token for each rewritten target. */
  resolveCacheBuster?: (
    target: SSRImportRewriteTarget,
  ) => CacheBuster | null | undefined | Promise<CacheBuster | null | undefined>;
  /** Cross-project reference (e.g., "demo@0.0") for @/ path rewrites */
  crossProjectRef?: string;
  /** React version to use for import rewrites */
  reactVersion?: string;
  /** Bare npm package roots that the server runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Project root directory for dependency pin lookup (used when VERYFRONT_DEPENDENCY_PINNING=1). */
  projectDir?: string;
  /** Project reference used by the best-effort platform range resolver. */
  projectId?: string;
  /** Stable dependency-pinning key paired with the immutable dependency map. */
  dependencyPinningCacheKey?: string;
  /** Immutable dependency map captured with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Collect unresolved dependency observations for cache replay. */
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void;
}

/** Replay cached SSR observations through the same live resolver as rewriting. */
export function replaySSRDependencyResolutionObservations(
  observations: readonly DependencyResolutionObservation[],
  options: SSRRewriteOptions,
): void {
  for (const observation of observations) {
    resolveDependencyPinForImport(observation.packageName, {
      projectDir: options.projectDir,
      projectId: options.projectId,
      dependencyPinningCacheKey: options.dependencyPinningCacheKey,
      dependencyPinningDependencies: options.dependencyPinningDependencies,
      dependencyPinningSource: options.dependencyPinningSource,
      onDependencyResolutionObserved: options.onDependencyResolutionObserved,
    });
  }
}

function shouldKeepBareSpecifier(specifier: string): boolean {
  // npm: specifiers are only supported in Deno, not Node.js
  // In Node.js, we need to convert them to esm.sh URLs (handled in rewriteBareImports)
  if (specifier.startsWith("npm:")) return isDeno;

  if (/^(?:https?|file|node):/i.test(specifier)) return true;

  if (specifier.startsWith("@/")) return true;
  if (specifier.startsWith("veryfront/")) return true;

  return false;
}

function resolveReactForRuntime(specifier: string, version?: string): string | null {
  // For Bun: Use local React paths from veryfront's node_modules.
  // Bun handles CJS/ESM interop correctly with file:// URLs.
  if (!isDeno && !isNode) {
    const localPath = getLocalReactPaths()[specifier];
    if (localPath) return localPath;
    // If not found in local paths, fall through to esm.sh for subpath imports
  }

  // For Deno: Use esm.sh URLs (Deno supports HTTP imports natively).
  // For Node.js: Use esm.sh URLs which will be cached to disk by cacheHttpImportsToLocal.
  // The cached bundles are ESM-compatible and can be imported via file:// URLs.
  const v = version ?? DEFAULT_REACT_VERSION;
  const mapped = getReactImportMap(v)[specifier];
  if (mapped) return mapped;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${v}/${subpath}?external=react&target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${v}/${subpath}?external=react&target=es2022`;
  }

  return null;
}

function resolveBareImportPin(
  bareSpecifier: string,
  projectDir?: string,
  projectId?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void,
): string | undefined {
  const parsed = parseBarePackageSpecifier(bareSpecifier);
  if (!parsed || parsed.version) return undefined; // already versioned inline

  return resolveDependencyPinForImport(parsed.packageName, {
    projectDir,
    projectId,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    onDependencyResolutionObserved,
  });
}

function observeSpecialImportDependency(
  bareSpecifier: string,
  projectDir?: string,
  projectId?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void,
): void {
  const parsed = parseBarePackageSpecifier(bareSpecifier);
  if (
    parsed?.version ||
    (
      parsed?.packageName !== "react" &&
      parsed?.packageName !== "react-dom" &&
      parsed?.packageName !== "veryfront"
    )
  ) {
    return;
  }

  resolveDependencyPinForImport(parsed.packageName, {
    projectDir,
    projectId,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    onDependencyResolutionObserved,
  });
}

function observeSpecialImportDependencies(
  code: string,
  projectDir?: string,
  projectId?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void,
): void {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      observeSpecialImportDependency(
        specifier.startsWith("npm:") ? specifier.slice(4) : specifier,
        projectDir,
        projectId,
        dependencyPinningCacheKey,
        dependencyPinningDependencies,
        dependencyPinningSource,
        onDependencyResolutionObserved,
      );
    }
  }
}

function rewriteBareImports(
  code: string,
  version?: string,
  projectDir?: string,
  projectId?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void,
  serverExternalPackages?: readonly string[],
): string {
  const v = version ?? DEFAULT_REACT_VERSION;

  observeSpecialImportDependencies(
    code,
    projectDir,
    projectId,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    onDependencyResolutionObserved,
  );

  return code.replace(/from\s*["']([^"'./][^"']*)["']/g, (_match, specifier: string) => {
    const bareSpecifier = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;

    const runtimeSpecifier = getConfiguredServerExternalRuntimeSpecifier(
      specifier,
      serverExternalPackages,
      isDeno,
    );
    if (runtimeSpecifier !== undefined) {
      return `from "${runtimeSpecifier}"`;
    }

    const reactUrl = resolveReactForRuntime(bareSpecifier, v);
    if (reactUrl) return `from "${reactUrl}"`;

    if (shouldKeepBareSpecifier(specifier)) return `from "${specifier}"`;

    const pinVersion = resolveBareImportPin(
      bareSpecifier,
      projectDir,
      projectId,
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
      dependencyPinningSource,
      onDependencyResolutionObserved,
    );
    if (pinVersion) {
      const parsed = parseBarePackageSpecifier(bareSpecifier);
      // Insert the version between package name and subpath (if any).
      const versionedBase = parsed
        ? `${parsed.packageName}@${pinVersion}${parsed.subpath ?? ""}`
        : `${bareSpecifier}@${pinVersion}`;
      return `from "https://esm.sh/${versionedBase}?external=react&target=es2022"`;
    }

    return `from "https://esm.sh/${bareSpecifier}?external=react&target=es2022"`;
  });
}

function rewriteConfiguredExternalImports(
  code: string,
  serverExternalPackages?: readonly string[],
): string {
  if (serverExternalPackages === undefined || serverExternalPackages.length === 0) return code;

  const matchExternal = (specifier: string) => {
    const runtimeSpecifier = getConfiguredServerExternalRuntimeSpecifier(
      specifier,
      serverExternalPackages,
      isDeno,
    );
    return runtimeSpecifier === undefined || runtimeSpecifier === specifier
      ? null
      : runtimeSpecifier;
  };
  const scanLimit = MAX_CONFIGURED_EXTERNAL_IMPORTS + 1;
  const fromSpans = findStaticImportFromSpans(code, matchExternal, scanLimit);
  const dynamicSpans = findDynamicImportSpans(code, matchExternal, scanLimit);
  const sideEffectSpans = findStaticSideEffectImportSpans(code, matchExternal, scanLimit);
  const totalMatches = fromSpans.length + dynamicSpans.length + sideEffectSpans.length;
  if (totalMatches > MAX_CONFIGURED_EXTERNAL_IMPORTS) {
    throw BUNDLE_ERROR.create({
      message: "Configured server external import limit exceeded",
      detail:
        `Module contains more than ${MAX_CONFIGURED_EXTERNAL_IMPORTS} configured external imports`,
      context: { maxConfiguredExternalImports: MAX_CONFIGURED_EXTERNAL_IMPORTS },
    });
  }

  return rewriteMatchedImportSpans(code, fromSpans, dynamicSpans, sideEffectSpans);
}

function getDefaultCacheBuster(target: SSRImportRewriteTarget, options: SSRRewriteOptions): string {
  const fields = [
    target.kind,
    target.modulePath,
    target.rewrittenPath,
    options.projectSlug ?? "",
    options.branch ?? "",
    options.crossProjectRef ?? "",
    options.reactVersion ?? "",
  ];
  if (options.dependencyPinningCacheKey?.startsWith("on:")) {
    fields.push(options.dependencyPinningCacheKey);
  }
  return scopeCacheBusterByServerExternalPackages(
    hashString(fields.join("\0")),
    options.serverExternalPackages,
  );
}

function scopeCacheBusterByServerExternalPackages(
  cacheBuster: string,
  serverExternalPackages?: readonly string[],
): string {
  const identity = buildServerExternalPackagesIdentity(serverExternalPackages);
  return identity === undefined
    ? cacheBuster
    : hashString(`${cacheBuster}\0server-externals\0${identity}`);
}

function getCacheBusterSync(
  target: SSRImportRewriteTarget,
  options: SSRRewriteOptions,
): string {
  if (options.cacheBuster !== undefined) {
    return scopeCacheBusterByServerExternalPackages(
      String(options.cacheBuster),
      options.serverExternalPackages,
    );
  }
  return getDefaultCacheBuster(target, options);
}

async function getCacheBusterAsync(
  target: SSRImportRewriteTarget,
  options: SSRRewriteOptions,
): Promise<string> {
  if (options.cacheBuster !== undefined) {
    return scopeCacheBusterByServerExternalPackages(
      String(options.cacheBuster),
      options.serverExternalPackages,
    );
  }
  const resolved = await options.resolveCacheBuster?.(target);
  if (resolved !== undefined && resolved !== null) {
    return scopeCacheBusterByServerExternalPackages(
      String(resolved),
      options.serverExternalPackages,
    );
  }
  return getDefaultCacheBuster(target, options);
}

/**
 * Rewrite one authored `@/` alias into its SSR module-transport URL.
 * `specifierPath` is the text after `@/`.
 *
 * The URL is composed by concatenating the authored path onto
 * `/_vf_modules/`, so an alias carrying dot segments would be emitted as
 * `/_vf_modules/../…` and normalized straight back out of the transport by the
 * SSR importer, turning the import into a same-origin fetch of an arbitrary
 * path that is then cached as an executable module. Containment is therefore
 * checked before anything is composed, from the same shared rule
 * `AliasStrategy.rewrite` and `transforms/esm/specifier-resolver.ts` apply.
 */
function buildAliasRewrite(
  specifierPath: string,
  options: SSRRewriteOptions,
): { target: SSRImportRewriteTarget; prefix: string } {
  assertContainedProjectAliasPath(specifierPath);
  const { crossProjectRef } = options;
  const jsPath = specifierPath.endsWith(".js") ? specifierPath : `${specifierPath}.js`;

  if (crossProjectRef) {
    const rewrittenPath = `/_vf_modules/_cross/${crossProjectRef}/@/${jsPath}`;
    return {
      target: {
        specifier: `@/${specifierPath}`,
        kind: "alias",
        modulePath: jsPath,
        rewrittenPath,
      },
      prefix: `${rewrittenPath}?ssr=true`,
    };
  }

  const rewrittenPath = `/_vf_modules/${jsPath}`;
  return {
    target: {
      specifier: `@/${specifierPath}`,
      kind: "alias",
      modulePath: jsPath,
      rewrittenPath,
    },
    prefix: `${rewrittenPath}?ssr=true`,
  };
}

function buildRelativeRewrite(
  specifier: string,
): { target: SSRImportRewriteTarget; prefix: string } {
  return {
    target: {
      specifier,
      kind: "relative",
      modulePath: specifier,
      rewrittenPath: specifier,
    },
    prefix: `${specifier}?ssr=true`,
  };
}

function buildScopedParams(options: SSRRewriteOptions): string {
  const projectParam = options.projectSlug ? `&project=${options.projectSlug}` : "";
  const branchParam = options.branch ? `&branch=${options.branch}` : "";
  const dependencyPinningParam = options.dependencyPinningCacheKey?.startsWith("on:")
    ? `&pins=${encodeURIComponent(options.dependencyPinningCacheKey)}`
    : "";
  return `${projectParam}${branchParam}${dependencyPinningParam}`;
}

function rewriteInternalModuleImportsSync(code: string, options: SSRRewriteOptions): string {
  const scopedParams = buildScopedParams(options);
  const rewriteSpecifier = (specifier: string): string | null => {
    let rewrite: { target: SSRImportRewriteTarget; prefix: string } | null = null;
    if (specifier.startsWith("@/")) {
      rewrite = buildAliasRewrite(specifier.slice(2), options);
    } else if (/^(?:\.\.?\/|\/)[^?#]+\.js$/.test(specifier)) {
      rewrite = buildRelativeRewrite(specifier);
    }
    if (!rewrite) return null;
    const cacheBuster = getCacheBusterSync(rewrite.target, options);
    return `${rewrite.prefix}${scopedParams}&v=${cacheBuster}`;
  };
  const scanLimit = code.length || 1;
  const fromSpans = findStaticImportFromSpans(code, rewriteSpecifier, scanLimit);
  const dynamicSpans = findDynamicImportSpans(code, rewriteSpecifier, scanLimit);
  const sideEffectSpans = findStaticSideEffectImportSpans(code, rewriteSpecifier, scanLimit);
  return rewriteMatchedImportSpans(code, fromSpans, dynamicSpans, sideEffectSpans);
}

export function rewriteSSRImportsCompat(code: string, options: SSRRewriteOptions = {}): string {
  let result = rewriteConfiguredExternalImports(code, options.serverExternalPackages);
  result = rewriteBareImports(
    result,
    options.reactVersion,
    options.projectDir,
    options.projectId,
    options.dependencyPinningCacheKey,
    options.dependencyPinningDependencies,
    options.dependencyPinningSource,
    options.onDependencyResolutionObserved,
    options.serverExternalPackages,
  );
  result = rewriteInternalModuleImportsSync(result, options);
  return result;
}

async function rewriteInternalModuleImportsAsync(
  code: string,
  options: SSRRewriteOptions,
): Promise<string> {
  const parsed = await parseImportEdits(code);
  const rewrites = new Map<number, { specifier: string }>();
  const scopedParams = buildScopedParams(options);

  for (let index = 0; index < parsed.imports.length; index++) {
    const imported = parsed.imports[index]!;
    const specifier = imported.specifier;
    const rewrite = specifier.startsWith("@/")
      ? buildAliasRewrite(specifier.slice(2), options)
      : /^(?:\.\.?\/|\/)[^?#]+\.js$/.test(specifier)
      ? buildRelativeRewrite(specifier)
      : null;
    if (!rewrite) continue;

    const cacheBuster = await getCacheBusterAsync(rewrite.target, options);
    rewrites.set(index, {
      specifier: `${rewrite.prefix}${scopedParams}&v=${cacheBuster}`,
    });
  }

  return rewrites.size === 0 ? code : applyImportEdits(parsed, rewrites);
}

export async function rewriteSSRImportsCompatAsync(
  code: string,
  options: SSRRewriteOptions = {},
): Promise<string> {
  let result = rewriteConfiguredExternalImports(code, options.serverExternalPackages);
  result = rewriteBareImports(
    result,
    options.reactVersion,
    options.projectDir,
    options.projectId,
    options.dependencyPinningCacheKey,
    options.dependencyPinningDependencies,
    options.dependencyPinningSource,
    options.onDependencyResolutionObserved,
    options.serverExternalPackages,
  );
  result = await rewriteInternalModuleImportsAsync(result, options);
  return result;
}
