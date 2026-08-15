/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling local imports (@/ alias and relative)
 * and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { getProjectTmpDir } from "#veryfront/modules/react-loader/index.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { invalidateMdxEsmModule } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  resolveModuleDependencies,
  rewriteResolvedDependencyImports,
  type TransformedModuleDependency,
} from "./dependency-resolver.ts";
import { persistTransformedModule } from "./module-persistence.ts";
import { transformModuleCodeWithCache } from "./module-transform-cache.ts";
import {
  buildModuleTransformCacheVariant,
  getModuleCacheKey,
  resolveCachedModulePath,
} from "./module-cache-lookup.ts";
import { markBuildFailure, markTenantBuildFailure } from "./build-failure.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import { MODULE_CACHE_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";

export { isBuildFailure } from "./build-failure.ts";

const logger = rendererLogger.component("module-loader");

/**
 * Specifiers each transformed module subtree left as authored, keyed by the
 * root module's transform cache key.
 *
 * The transform cache lets a module skip dependency resolution entirely, so the
 * evidence has to outlive the resolution that produced it — otherwise a
 * dependency's dangling tenant import is only ever visible on the very first
 * transform. The memo uses the module cache's entry bound and refreshes access
 * order on reads, while holding only specifier strings.
 */
const unresolvedSpecifiersByCacheKey = new Map<string, readonly string[]>();

function cacheUnresolvedSpecifiers(cacheKey: string, specifiers: readonly string[]): void {
  unresolvedSpecifiersByCacheKey.delete(cacheKey);
  unresolvedSpecifiersByCacheKey.set(cacheKey, specifiers);

  while (unresolvedSpecifiersByCacheKey.size > MODULE_CACHE_MAX_ENTRIES) {
    const oldestKey = unresolvedSpecifiersByCacheKey.keys().next().value;
    if (oldestKey === undefined) break;
    unresolvedSpecifiersByCacheKey.delete(oldestKey);
  }
}

function throwIfModuleLoadAborted(config: ModuleLoaderConfig): void {
  config.signal?.throwIfAborted();
}

function markModuleLoadProgress(
  config: ModuleLoaderConfig,
  phase: string,
  filePath: string,
): void {
  throwIfModuleLoadAborted(config);
  try {
    config.onProgress?.({ phase, filePath });
  } catch (error) {
    logger.debug("Module-load progress listener failed", { phase, filePath, error });
  }
}

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

function decodeFileContent(fileContent: string | Uint8Array): string {
  if (typeof fileContent === "string") return fileContent;
  return new TextDecoder().decode(fileContent);
}

/**
 * Transform a module and all its local dependencies (@/ alias and relative imports).
 *
 * @param filePath - Path to the module
 * @param tmpDir - Temp directory for caching
 * @param localAdapter - Local file system adapter
 * @param config - Module loader configuration
 * @param useLocalAdapter - Whether to use local adapter for reading
 * @returns Path to the transformed module file
 */
export async function transformModuleWithDeps(
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  useLocalAdapter = false,
  lineage: ReadonlySet<string> = new Set(),
  // Shared by reference across the whole transform tree (unlike `lineage`, which
  // is copied per level): a descendant records a cycle target here, and the
  // ancestor that eventually persists that target reads it to write a stable
  // alias the left-as-authored cycle edge can resolve to.
  cycleTargets: Set<string> = new Set(),
  // Also shared by reference across the whole transform tree: every specifier
  // the dependency resolver could not resolve and therefore left as authored.
  // Those are the only specifiers that can survive into the built module and
  // fail at `import()` time, so this is the evidence that tells a tenant typo
  // apart from a framework artifact going missing. See `loadModule`.
  //
  // A module served from the cache below returns before
  // `resolveModuleDependencies` runs, so it cannot re-derive its own evidence.
  // That matters because the retry path invalidates only the *root* module's
  // cache entry: without a memo, a typo living in a dependency would go
  // unrecorded on every rebuild and never be attributed to the tenant. The
  // cache-hit branch therefore replays what the first resolution found.
  unresolvedSpecifiers: Set<string> = new Set(),
): Promise<string> {
  throwIfModuleLoadAborted(config);
  const { moduleCache, projectDir, projectId, contentSourceId, adapter, mode } = config;
  const cacheKey = getModuleCacheKey(
    filePath,
    projectId,
    projectDir,
    contentSourceId,
    config.reactVersion,
    mode,
    config.dependencyPinningCacheKey,
    config.moduleServerOrigin,
  );

  const cachedPath = await resolveCachedModulePath({
    cacheKey,
    filePath,
    projectDir,
    projectId,
    contentSourceId,
    moduleCache,
    reactVersion: config.reactVersion,
    dependencyPinningCacheKey: config.dependencyPinningCacheKey,
    moduleServerOrigin: config.moduleServerOrigin,
  });
  if (cachedPath) {
    // Replay the evidence this module produced when it was last resolved. A
    // cache hit skips `resolveModuleDependencies`, so without this a dependency
    // that was already transformed contributes nothing and its tenant-authored
    // dangling import silently loses attribution.
    const cachedUnresolvedSpecifiers = unresolvedSpecifiersByCacheKey.get(cacheKey) ?? [];
    if (cachedUnresolvedSpecifiers.length > 0) {
      cacheUnresolvedSpecifiers(cacheKey, cachedUnresolvedSpecifiers);
    }
    for (const specifier of cachedUnresolvedSpecifiers) {
      unresolvedSpecifiers.add(specifier);
    }
    markModuleLoadProgress(config, "module:cache-hit", filePath);
    return cachedPath;
  }

  // Collect this module and every recursively transformed descendant into an
  // isolated set. Once persistence succeeds, cache that complete subtree and
  // merge it into the caller's aggregate evidence.
  const moduleUnresolvedSpecifiers = new Set<string>();

  const readAdapter = useLocalAdapter ? localAdapter : adapter;
  let fileContent = decodeFileContent(await readAdapter.fs.readFile(filePath));
  markModuleLoadProgress(config, "module:source-read", filePath);

  const resolvedDeps = await resolveModuleDependencies({
    adapter,
    fileContent,
    filePath,
    projectDir,
  });
  markModuleLoadProgress(config, "module:dependencies-resolved", filePath);

  // The module cache is only written once a transform completes, so it cannot
  // break a cycle that is still in progress. Carry the chain instead.
  const nextLineage = new Set(lineage).add(filePath);

  const transformedDeps = (await Promise.all(
    resolvedDeps.filter((d) => d.depFilePath).map(async (dep) => {
      // `await import()` is how a module graph legitimately breaks an import
      // cycle, so following one eagerly can lead straight back to a module
      // further up this chain and recurse until the worker dies. Leave the
      // specifier as authored so the recursion terminates.
      //
      // The cycle target is persisted as a content-hashed artifact whose hash
      // is derived from transformed output we do not produce here (producing it
      // is the recursion we are breaking), so the edge cannot be rewritten to
      // that hashed path. Instead we record the target: when its ancestor
      // persists it, a stable non-hashed alias is written next to the hashed
      // artifact so the relative `.js` specifier esbuild leaves behind resolves.
      // NOTE: this alias path is not yet runtime-verified end to end; if it does
      // not resolve in a real runtime the cycle branch stays broken, which is no
      // worse than before (and still a strict improvement over hanging).
      if (nextLineage.has(dep.depFilePath!)) {
        cycleTargets.add(dep.depFilePath!);
        logger.debug("Skipping dependency already in the transform chain:", {
          path: dep.path,
          depFilePath: dep.depFilePath,
        });
        return null;
      }

      logger.debug("Found dependency:", {
        path: dep.path,
        depFilePath: dep.depFilePath,
        isLocalLib: dep.isLocalLib,
      });

      try {
        const depTempPath = await transformModuleWithDeps(
          dep.depFilePath!,
          tmpDir,
          localAdapter,
          config,
          dep.isLocalLib,
          nextLineage,
          cycleTargets,
          moduleUnresolvedSpecifiers,
        );

        return { ...dep, depTempPath };
      } catch (error) {
        // A static import has to resolve for the importer to run at all. A
        // dynamic one may never be evaluated, so a module behind an untaken
        // branch must not fail the page that merely mentions it.
        if (!dep.isDynamic) throw error;

        logger.warn("Leaving an unresolvable dynamic dependency as authored:", {
          path: dep.path,
          depFilePath: dep.depFilePath,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }),
  )).filter((dep): dep is TransformedModuleDependency => dep !== null);
  markModuleLoadProgress(config, "module:dependencies-transformed", filePath);

  fileContent = rewriteResolvedDependencyImports(fileContent, transformedDeps);
  for (const dep of transformedDeps) {
    logger.debug("Replaced import:", {
      path: dep.path,
      depTempPath: dep.depTempPath,
    });
  }

  for (const dep of resolvedDeps) {
    if (dep.depFilePath) continue;
    moduleUnresolvedSpecifiers.add(dep.path);
    logger.warn("Could not find dependency:", {
      path: dep.path,
      relativePath: dep.relativePath,
      projectDir,
    });
  }
  const effectiveProjectId = projectId ?? projectDir;
  const { code: transformedCode } = await transformModuleCodeWithCache({
    fileContent,
    filePath,
    projectDir,
    effectiveProjectId,
    mode,
    adapter,
    reactVersion: config.reactVersion,
    moduleServerOrigin: config.moduleServerOrigin,
    dependencyPinningCacheKey: config.dependencyPinningCacheKey,
    dependencyPinningDependencies: config.dependencyPinningDependencies,
    dependencyPinningSource: config.dependencyPinningSource,
    onProgress: config.onProgress,
    signal: config.signal,
  });
  markModuleLoadProgress(config, "module:source-transformed", filePath);

  const persistedPath = await persistTransformedModule({
    filePath,
    projectDir,
    tmpDir,
    transformedCode,
    localAdapter,
    moduleCache,
    cacheKey,
    contentSourceId,
    reactVersion: config.reactVersion,
    moduleServerOrigin: config.moduleServerOrigin,
    dependencyPinningCacheKey: config.dependencyPinningCacheKey,
    isCycleTarget: cycleTargets.has(filePath),
  });
  cacheUnresolvedSpecifiers(cacheKey, [...moduleUnresolvedSpecifiers]);
  for (const specifier of moduleUnresolvedSpecifiers) unresolvedSpecifiers.add(specifier);
  markModuleLoadProgress(config, "module:persisted", filePath);
  return persistedPath;
}

export interface ModuleLoaderConfig {
  projectDir: string;
  projectId?: string;
  contentSourceId?: string;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  moduleCache: Map<string, string>;
  esmCache: Map<string, string>;
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Absolute request origin used to identify same-origin module URLs. */
  moduleServerOrigin?: string;
  /** Stable VERYFRONT_DEPENDENCY_PINNING + package dependency-map state. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Cooperative cancellation for one module-load stage. */
  signal?: AbortSignal;
  /** Meaningful module/transform milestones for the stage idle timeout. */
  onProgress?: TransformProgressListener;
}

/**
 * Get the cache directory for module transforms.
 * Uses MDX-ESM cache when contentSourceId is available, otherwise falls back to project tmp dir.
 * This ensures modules are shared between orchestrator and MDX loader to prevent duplicate contexts.
 */
async function getModuleCacheDir(config: ModuleLoaderConfig): Promise<string> {
  const { projectId, contentSourceId, projectDir } = config;

  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const cacheDir = join(baseCacheDir, projectKey, sourceKey);

    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    await createFileSystem().mkdir(cacheDir, { recursive: true });

    return cacheDir;
  }

  return getProjectTmpDir(projectId ?? projectDir);
}

/**
 * Detect a dynamic `import()` failure caused by a module file that is missing on
 * disk (e.g. a stale/evicted cached page module). Matches Node/Deno's
 * `ERR_MODULE_NOT_FOUND` as well as the "Cannot find module" / "Module not found"
 * message variants the runtimes surface for a missing `import()` target.
 */
export function isMissingModuleError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") return true;
  return /cannot find module|module not found/i.test(error.message);
}

/**
 * Whether a module-not-found failure is a specifier the project authored that
 * points at nothing, as opposed to framework infrastructure going missing.
 *
 * `isMissingModuleError` alone cannot answer this: an `ERR_MODULE_NOT_FOUND`
 * is raised the same way for a tenant typo, an HTTP bundle miss, a cycle-break
 * alias that did not resolve, and a rebuilt artifact the runtime failed to
 * persist. Only the first is the tenant's fault, and only the first may be
 * downgraded to a warning in observability.
 *
 * The discriminator is evidence rather than a guess: `resolveModuleDependencies`
 * resolves only `@/` aliases and relative imports, and `transformModuleWithDeps`
 * records every specifier it had to leave as authored. If it left none anywhere
 * in this module's transform tree, then nothing tenant-authored survived
 * unrewritten and whatever is missing here is framework-owned.
 *
 * Note the runtime reports the *resolved* path, which for a dropped relative
 * specifier lands inside the build's own temp directory — so a "is this path
 * ours?" test on the message would reject exactly the case this identifies.
 */
/**
 * The specifier a module-not-found error names as missing.
 *
 * Runtimes report it as the first quoted token and then name the importer, so
 * only the first quote pair identifies what is actually absent. The quote style
 * differs by runtime and both reach this seam, since `isMissingModuleError`
 * matches Node's phrasing as well as Deno's:
 *
 * - Deno:  `Module not found "file:///…/missing".`
 * - Node:  `Cannot find module '/…/missing' imported from /…/page.js`
 *
 * Note Node leaves the importer unquoted, so a double-quote-only match would
 * return `""` there and silently disable every check built on this.
 */
function missingModuleTarget(message: string): string {
  const match = message.match(/"([^"]*)"|'([^']*)'/);
  return match?.[1] ?? match?.[2] ?? "";
}

export function isUnresolvedTenantImport(
  error: unknown,
  unresolvedSpecifiers: ReadonlySet<string>,
  rebuiltArtifactPath?: string,
): boolean {
  if (!isMissingModuleError(error)) return false;
  if (unresolvedSpecifiers.size === 0) return false;
  const message = error instanceof Error ? error.message : String(error);
  // An HTTP bundle is framework infrastructure with dedicated recovery on the
  // outer branch. A miss on one is not the tenant's doing even when the tenant
  // separately has an unresolved import.
  if (/veryfront-http-bundle\/http-[a-f0-9]+\.mjs/.test(message)) return false;
  // The missing module can be the rebuilt artifact *itself* rather than one of
  // its dependencies — a racing cache sweep or a failing cache volume can evict
  // it between persist and import. That is repeated cache eviction, which must
  // stay at error severity however the tenant's own imports look.
  //
  // Only the *missing target* may be compared, never the whole message: the
  // runtime appends the importer's location, and at this seam the importer is
  // always the rebuilt artifact, so scanning the full message would exclude
  // every case including the tenant typo this predicate exists to catch.
  if (rebuiltArtifactPath && missingModuleTarget(message).includes(rebuiltArtifactPath)) {
    return false;
  }
  return true;
}

/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export async function loadModule(
  filePath: string,
  config: ModuleLoaderConfig,
): Promise<Record<string, unknown>> {
  throwIfModuleLoadAborted(config);
  const tmpDir = await getModuleCacheDir(config);
  const localAdapter = await getLocalAdapter();
  markModuleLoadProgress(config, "module:cache-ready", filePath);

  // Everything up to here compiles and resolves source, so a failure is a build
  // failure. Everything after it is the module running.
  // Every specifier the resolver had to leave as authored, across this module's
  // whole transform tree. Read back at the retry seam below to tell a tenant
  // typo apart from framework infrastructure going missing.
  const unresolvedSpecifiers = new Set<string>();

  let tempFilePath: string;
  try {
    tempFilePath = await transformModuleWithDeps(
      filePath,
      tmpDir,
      localAdapter,
      config,
      false,
      undefined,
      undefined,
      unresolvedSpecifiers,
    );
  } catch (error) {
    throw markBuildFailure(error);
  }

  const moduleUrl = toFileUrl(tempFilePath).href;
  markModuleLoadProgress(config, "module:import-start", filePath);

  try {
    const mod = await import(moduleUrl);
    markModuleLoadProgress(config, "module:imported", filePath);
    return mod;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // HEURISTIC: extract the bundle hash by matching the cache-path pattern in
    // the error message. This relies on the path format
    // `veryfront-http-bundle/http-<hash>.mjs` remaining stable. If the cache
    // layout changes, this recovery silently stops firing — update the regex
    // alongside any cache-dir rename.
    const bundleMatch = errorMsg.match(/veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/);

    if (bundleMatch) {
      const hash = bundleMatch[1]!;
      logger.warn("Import failed due to missing HTTP bundle, attempting recovery", {
        filePath,
        hash,
      });

      const { recoverHttpBundleByHash } = await import("#veryfront/transforms/esm/http-cache.ts");
      const cacheDir = getHttpBundleCacheDir();
      const recovered = await recoverHttpBundleByHash(hash, cacheDir);

      if (recovered) {
        logger.info("HTTP bundle recovered, retrying import", { hash });
        return await import(`${toFileUrl(tempFilePath).href}?t=${Date.now()}&retry=1`);
      }
    }

    // Self-heal: the cached module artifact resolved to a path that no longer
    // exists on disk (evicted, or rebuilt under a different content hash by a
    // racing write). Rather than hard-failing the whole page render (#2077),
    // treat it as a cache miss: drop the stale cache pointers so we don't get
    // handed the same dead path, rebuild the module from source, and retry the
    // import once. Skip HTTP-bundle misses, which have dedicated recovery above.
    if (!bundleMatch && isMissingModuleError(error)) {
      logger.warn("Cached module missing on disk, rebuilding and retrying import", {
        filePath,
        tempFilePath,
      });

      config.moduleCache.delete(
        getModuleCacheKey(
          filePath,
          config.projectId,
          config.projectDir,
          config.contentSourceId,
          config.reactVersion,
          config.mode,
          config.dependencyPinningCacheKey,
          config.moduleServerOrigin,
        ),
      );
      // tmpDir is the exact cache dir this module was registered under, so the
      // invalidation stays scoped to this tenant (the path-cache key is not
      // project-scoped — see invalidateMdxEsmModule).
      invalidateMdxEsmModule(
        tmpDir,
        filePath,
        config.projectDir,
        config.reactVersion,
        buildModuleTransformCacheVariant(
          config.dependencyPinningCacheKey,
          config.moduleServerOrigin,
        ),
      );

      // Classification at the retry seam must describe the rebuilt graph, not
      // the artifact that just failed. A dependency may appear between the two
      // transforms, so retaining its earlier dropped-specifier evidence can
      // misattribute an unrelated retry failure to the tenant.
      unresolvedSpecifiers.clear();

      let rebuiltPath: string;
      try {
        rebuiltPath = await transformModuleWithDeps(
          filePath,
          tmpDir,
          localAdapter,
          config,
          false,
          undefined,
          undefined,
          unresolvedSpecifiers,
        );
      } catch (rebuildError) {
        throw markBuildFailure(rebuildError);
      }

      try {
        return await import(`${toFileUrl(rebuiltPath).href}?t=${Date.now()}&rebuilt=1`);
      } catch (retryError) {
        // The module was found and ran, so it threw at module scope. That is an
        // ordinary application error the project's own error page should
        // present, not a build failure — leave it untagged.
        if (!isMissingModuleError(retryError)) throw retryError;

        // Still unresolved after a full rebuild from source, and the resolver
        // recorded leaving a specifier as authored: a path the project wrote
        // that points at nothing. Classify it explicitly, because
        // `ERR_MODULE_NOT_FOUND` is not a VeryfrontError and slug-based
        // classification cannot see it.
        if (isUnresolvedTenantImport(retryError, unresolvedSpecifiers, rebuiltPath)) {
          throw markTenantBuildFailure(retryError);
        }

        // A resolution failure the tenant did not cause: an HTTP bundle miss, a
        // cycle-break alias that did not resolve, or an artifact the rebuild
        // failed to persist. Still a build failure, but a framework-owned one,
        // so it keeps error-level severity.
        throw markBuildFailure(retryError);
      }
    }

    logger.error("Failed to import module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
