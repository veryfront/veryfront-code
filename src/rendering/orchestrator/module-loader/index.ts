/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling local imports (@/ alias and relative)
 * and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { join, relative, toFileUrl } from "#veryfront/compat/path/index.ts";
import { CACHE_ERROR } from "#veryfront/errors";
import { isTenantSourceBuildError } from "#veryfront/errors/tenant-classification.ts";
import { getProjectTmpDir } from "#veryfront/modules/react-loader/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import {
  rewriteSsrProjectAliasSpecifier,
} from "#veryfront/transforms/import-rewriter/strategies/alias-strategy.ts";
import {
  invalidateMdxEsmModule,
  registerCycleManifestSources,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";
import { rendererLogger, throwIfAborted } from "#veryfront/utils";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { MODULE_CACHE_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { markBuildFailure, markTenantBuildFailure } from "./build-failure.ts";
import {
  cycleArtifactBelongsToGraph,
  CycleManifestTransaction,
  inspectCycleManifestCache,
  needsCycleManifest,
} from "./cycle-manifest.ts";
import {
  type ResolvedModuleDependency,
  resolveModuleDependencies,
  rewriteResolvedDependencyImports,
  type TransformedModuleDependency,
} from "./dependency-resolver.ts";
import {
  persistTransformedModule,
  readPersistedUnresolvedSpecifiers,
  transformedModuleHasDefaultExport,
} from "./module-persistence.ts";
import { transformModuleCodeWithCache } from "./module-transform-cache.ts";
import {
  buildModuleTransformCacheVariant,
  getModuleCacheKey,
  resolveCachedModulePath,
} from "./module-cache-lookup.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";

export { isBuildFailure } from "./build-failure.ts";

const logger = rendererLogger.component("module-loader");
const JSONStringify = JSON.stringify;

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
const MAX_SOURCE_GRAPH_MODULES = 5_000;

function cacheUnresolvedSpecifiers(cacheKey: string, specifiers: readonly string[]): void {
  unresolvedSpecifiersByCacheKey.delete(cacheKey);
  unresolvedSpecifiersByCacheKey.set(cacheKey, specifiers);

  while (unresolvedSpecifiersByCacheKey.size > MODULE_CACHE_MAX_ENTRIES) {
    const oldestKey = unresolvedSpecifiersByCacheKey.keys().next().value;
    if (oldestKey === undefined) break;
    unresolvedSpecifiersByCacheKey.delete(oldestKey);
  }
}

export {
  __setModuleTransformActivityObserverForTests,
  __setModuleTransformStallTimeoutForTests,
} from "./transform-permit.ts";

function throwIfModuleLoadAborted(config: ModuleLoaderConfig): void {
  throwIfAborted(config.signal);
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

type SourceGraphNode =
  | {
    status: "ready";
    fileContent: string;
    resolvedDeps: readonly ResolvedModuleDependency[];
  }
  | { status: "failed"; fileContent?: string; error: unknown };

interface SourceGraphPlan {
  graphId: string;
  nodes: ReadonlyMap<string, SourceGraphNode>;
  cycleBoundSources: ReadonlySet<string>;
  artifactIds: ReadonlyMap<string, string>;
  transforms: Map<string, Promise<string>>;
  unresolvedBySource: Map<string, readonly string[]>;
}

const sourceGraphByCycleManifest = new WeakMap<CycleManifestTransaction, SourceGraphPlan>();

function computeCycleBoundSources(
  nodes: ReadonlyMap<string, SourceGraphNode>,
): ReadonlySet<string> {
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();
  const uniqueTargets = new Map<string, Set<string>>();
  for (const path of nodes.keys()) {
    adjacency.set(path, []);
    reverseAdjacency.set(path, []);
    uniqueTargets.set(path, new Set());
  }
  for (const [path, node] of nodes) {
    const targets = adjacency.get(path)!;
    const seenTargets = uniqueTargets.get(path)!;
    if (node.status === "failed") continue;
    for (const dependency of node.resolvedDeps) {
      const target = dependency.depFilePath;
      if (!target || !nodes.has(target) || seenTargets.has(target)) continue;
      seenTargets.add(target);
      targets.push(target);
      reverseAdjacency.get(target)!.push(path);
    }
  }

  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ path: string; next: number }> = [{ path: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const targets = adjacency.get(frame.path)!;
      const target = targets[frame.next];
      if (target !== undefined) {
        frame.next++;
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ path: target, next: 0 });
        }
        continue;
      }
      finishOrder.push(frame.path);
      stack.pop();
    }
  }

  const componentByPath = new Map<string, number>();
  const componentSizes: number[] = [];
  for (let orderIndex = finishOrder.length - 1; orderIndex >= 0; orderIndex--) {
    const start = finishOrder[orderIndex]!;
    if (componentByPath.has(start)) continue;
    const componentId = componentSizes.length;
    let size = 0;
    const pending = [start];
    componentByPath.set(start, componentId);
    while (pending.length > 0) {
      const path = pending.pop()!;
      size++;
      for (const importer of reverseAdjacency.get(path)!) {
        if (componentByPath.has(importer)) continue;
        componentByPath.set(importer, componentId);
        pending.push(importer);
      }
    }
    componentSizes.push(size);
  }

  const cycleBoundSources = new Set<string>();
  const pending: string[] = [];
  for (const [path, targets] of adjacency) {
    const componentId = componentByPath.get(path)!;
    if (componentSizes[componentId]! === 1 && !targets.includes(path)) continue;
    cycleBoundSources.add(path);
    pending.push(path);
  }
  for (let index = 0; index < pending.length; index++) {
    for (const importer of reverseAdjacency.get(pending[index]!)!) {
      if (cycleBoundSources.has(importer)) continue;
      cycleBoundSources.add(importer);
      pending.push(importer);
    }
  }
  return cycleBoundSources;
}

async function createSourceGraphPlan(
  rootFilePath: string,
  rootCacheKey: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  rootUsesLocalAdapter: boolean,
  recoveryNonce?: string,
): Promise<SourceGraphPlan> {
  const nodes = new Map<string, SourceGraphNode>();
  const pending = [{ filePath: rootFilePath, useLocalAdapter: rootUsesLocalAdapter }];
  const queued = new Set([rootFilePath]);

  for (let index = 0; index < pending.length; index++) {
    if (nodes.size >= MAX_SOURCE_GRAPH_MODULES) {
      throw CACHE_ERROR.create({ detail: "Module source graph limit exceeded" });
    }
    throwIfModuleLoadAborted(config);
    const current = pending[index]!;
    const readAdapter = current.useLocalAdapter ? localAdapter : config.adapter;
    let fileContent: string;
    try {
      fileContent = decodeFileContent(await readAdapter.fs.readFile(current.filePath));
      markModuleLoadProgress(config, "module:source-read", current.filePath);
    } catch (error) {
      nodes.set(current.filePath, { status: "failed", error });
      continue;
    }

    try {
      const resolvedDeps = await resolveModuleDependencies({
        adapter: config.adapter,
        fileContent,
        filePath: current.filePath,
        projectDir: config.projectDir,
      });
      nodes.set(current.filePath, { status: "ready", fileContent, resolvedDeps });
      markModuleLoadProgress(config, "module:dependencies-resolved", current.filePath);
      for (const dependency of resolvedDeps) {
        if (!dependency.depFilePath || queued.has(dependency.depFilePath)) continue;
        queued.add(dependency.depFilePath);
        pending.push({
          filePath: dependency.depFilePath,
          useLocalAdapter: dependency.isLocalLib,
        });
      }
    } catch (error) {
      nodes.set(current.filePath, { status: "failed", fileContent, error });
    }
  }

  const sortedPaths = [...nodes.keys()].sort(compareStrings);
  const artifactIds = new Map(
    sortedPaths.map((path, index) => [path, index.toString(36)]),
  );
  const identity = sortedPaths.map((path) => {
    const node = nodes.get(path)!;
    return [
      relative(config.projectDir, path).replaceAll("\\", "/"),
      node.fileContent ?? null,
      (node.status === "ready" ? node.resolvedDeps : []).map((dependency) => [
        dependency.path,
        dependency.depFilePath
          ? relative(config.projectDir, dependency.depFilePath).replaceAll("\\", "/")
          : null,
        dependency.isDynamic,
      ]),
    ];
  });
  const graphId = (await computeHash(
    JSONStringify([rootCacheKey, recoveryNonce ?? null, identity]),
  )).slice(0, 32);
  return {
    graphId,
    nodes,
    cycleBoundSources: computeCycleBoundSources(nodes),
    artifactIds,
    transforms: new Map(),
    unresolvedBySource: new Map(),
  };
}

function plannedEntryId(
  sourceGraph: SourceGraphPlan,
  importerFilePath: string,
  dependency: ResolvedModuleDependency,
): string {
  const artifactId = sourceGraph.artifactIds.get(importerFilePath) ?? "0";
  return `${artifactId}-${dependency.start.toString(36)}-${dependency.end.toString(36)}`;
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
async function transformModuleWithDepsUnmemoized(
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  useLocalAdapter = false,
  lineage: ReadonlySet<string> = new Set(),
  // Shared by reference across the whole transform tree. It reserves immutable
  // graph-local paths for cycle edges before their target hashes are known, then
  // publishes caches only after those manifest entries are durable.
  cycleManifest?: CycleManifestTransaction,
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
  const ownsCycleManifest = cycleManifest === undefined;
  let sourceGraph = cycleManifest ? sourceGraphByCycleManifest.get(cycleManifest) : undefined;
  let recoveryNonce: string | undefined;
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
    config.serverExternalPackages,
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
    serverExternalPackages: config.serverExternalPackages,
    dev: config.mode === "development",
  });
  if (cachedPath) {
    const cycleManifestState = await inspectCycleManifestCache(
      cachedPath,
      tmpDir,
      localAdapter,
    );
    let shouldRebuild = cycleManifestState === "invalid" ||
      cycleManifestState === "valid-root" && lineage.size > 0 ||
      sourceGraph?.cycleBoundSources.has(filePath) === true;
    if (!shouldRebuild && ownsCycleManifest && cycleManifestState === "valid-root") {
      sourceGraph = await createSourceGraphPlan(
        filePath,
        cacheKey,
        localAdapter,
        config,
        useLocalAdapter,
      );
      shouldRebuild = !cycleArtifactBelongsToGraph(
        cachedPath,
        tmpDir,
        sourceGraph.graphId,
      );
    }
    if (shouldRebuild) {
      if (ownsCycleManifest && cycleManifestState === "invalid") {
        recoveryNonce = crypto.randomUUID();
      }
      moduleCache.delete(cacheKey);
    } else {
      // Replay the evidence this module produced when it was last resolved. A
      // cache hit skips `resolveModuleDependencies`, so without this a dependency
      // that was already transformed contributes nothing and its tenant-authored
      // dangling import silently loses attribution.
      const memoizedUnresolvedSpecifiers = unresolvedSpecifiersByCacheKey.get(cacheKey);
      const cachedUnresolvedSpecifiers = memoizedUnresolvedSpecifiers ??
        await readPersistedUnresolvedSpecifiers(cachedPath, localAdapter);
      cacheUnresolvedSpecifiers(cacheKey, cachedUnresolvedSpecifiers);
      for (const specifier of cachedUnresolvedSpecifiers) {
        unresolvedSpecifiers.add(specifier);
      }
      sourceGraph?.unresolvedBySource.set(filePath, cachedUnresolvedSpecifiers);
      markModuleLoadProgress(config, "module:cache-hit", filePath);
      return cachedPath;
    }
  }

  if (ownsCycleManifest) {
    sourceGraph ??= await createSourceGraphPlan(
      filePath,
      cacheKey,
      localAdapter,
      config,
      useLocalAdapter,
      recoveryNonce,
    );
    cycleManifest = new CycleManifestTransaction(
      tmpDir,
      sourceGraph.graphId,
      sourceGraph.artifactIds,
    );
    sourceGraphByCycleManifest.set(cycleManifest, sourceGraph);
  }
  if (!cycleManifest || !sourceGraph) {
    throw CACHE_ERROR.create({ detail: "Module source graph was not initialized" });
  }

  // Collect this module and every recursively transformed descendant into an
  // isolated set. Once persistence succeeds, cache that complete subtree and
  // merge it into the caller's aggregate evidence.
  const moduleUnresolvedSpecifiers = new Set<string>();

  const sourceNode = sourceGraph.nodes.get(filePath);
  if (!sourceNode) {
    throw CACHE_ERROR.create({ detail: "Module source graph is incomplete" });
  }
  if (sourceNode.status === "failed") throw sourceNode.error;
  let fileContent = sourceNode.fileContent;
  const resolvedDeps = sourceNode.resolvedDeps;

  // The module cache is only written once a transform completes, so it cannot
  // break a cycle that is still in progress. Carry the chain instead.
  const nextLineage = new Set(lineage).add(filePath);

  // Fan the dependency subtree out without holding any concurrency permit:
  // each recursion level only coordinates its children, while the bounded
  // resource is the leaf transform work, which draws a permit from the shared
  // transform semaphore inside `transformModuleCodeWithCache`'s compute
  // callback. Holding a permit here while awaiting recursive transforms would
  // let wide module graphs exhaust the permits and starve their own
  // descendants.
  const transformedDeps = (await Promise.all(
    resolvedDeps.filter((d) => d.depFilePath).map(async (dep) => {
      const manifestDependency = (): TransformedModuleDependency | null => {
        if (!needsCycleManifest(dep.depFilePath!)) return null;
        return {
          ...dep,
          depTempPath: cycleManifest.registerEdge(
            dep.depFilePath!,
            filePath,
            dep.isDynamic,
            plannedEntryId(sourceGraph, filePath, dep),
          ),
        };
      };
      // `await import()` is how a module graph legitimately breaks an import
      // cycle, so following one eagerly can lead straight back to a module
      // further up this chain and recurse until the worker dies. Route that
      // edge through graph-scoped indirection while the target hash is pending.
      if (nextLineage.has(dep.depFilePath!)) {
        logger.debug("Skipping dependency already in the transform chain:", {
          path: dep.path,
          depFilePath: dep.depFilePath,
        });
        return manifestDependency();
      }

      logger.debug("Found dependency:", {
        path: dep.path,
        depFilePath: dep.depFilePath,
        isLocalLib: dep.isLocalLib,
      });

      const finishWait = cycleManifest.beginDependencyWait(filePath, dep.depFilePath!);
      if (!finishWait) return manifestDependency();
      try {
        const depTempPath = await transformModuleWithDeps(
          dep.depFilePath!,
          tmpDir,
          localAdapter,
          config,
          dep.isLocalLib,
          nextLineage,
          cycleManifest,
          moduleUnresolvedSpecifiers,
        );

        return { ...dep, depTempPath };
      } catch (error) {
        // A static import has to resolve for the importer to run at all. A
        // dynamic one may never be evaluated, so a module behind an untaken
        // branch must not fail the page that merely mentions it.
        if (!dep.isDynamic) throw error;

        // A tenant-source compile failure is deliberately non-fatal until this
        // dynamic edge executes. The importer remains authored, so retain that
        // provenance for the retry classification seam. Infrastructure errors
        // stay framework-owned even if the resulting edge is later missing.
        if (isTenantSourceBuildError(error)) {
          moduleUnresolvedSpecifiers.add(dep.path);
        }

        logger.warn("Leaving an unresolvable dynamic dependency as authored:", {
          path: dep.path,
          depFilePath: dep.depFilePath,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        finishWait();
      }
    }),
  )).filter((dep): dep is TransformedModuleDependency => dep !== null);
  if (
    transformedDeps.some((dep) =>
      dep.depFilePath !== null && cycleManifest.isCycleBound(dep.depFilePath)
    )
  ) {
    cycleManifest.markCycleBound(filePath);
  }
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
  const cycleBound = cycleManifest.isCycleBound(filePath);
  const useCycleArtifact = cycleBound;
  const effectiveProjectId = projectId ?? projectDir;
  let { code: transformedCode } = await transformModuleCodeWithCache({
    fileContent,
    filePath,
    projectDir,
    effectiveProjectId,
    mode,
    adapter,
    reactVersion: config.reactVersion,
    moduleServerOrigin: config.moduleServerOrigin,
    serverExternalPackages: config.serverExternalPackages,
    dependencyPinningCacheKey: config.dependencyPinningCacheKey,
    dependencyPinningDependencies: config.dependencyPinningDependencies,
    dependencyPinningSource: config.dependencyPinningSource,
    onProgress: config.onProgress,
    signal: config.signal,
  });
  const exposesDefault = (cycleManifest.referencesStaticTarget(filePath) ||
    cycleBound && ownsCycleManifest) &&
    transformedModuleHasDefaultExport(transformedCode);
  if (cycleBound) {
    transformedCode = ownsCycleManifest
      ? await cycleManifest.sealRootArtifactCode(
        transformedCode,
        filePath,
        exposesDefault,
        localAdapter,
      )
      : cycleManifest.markMemberArtifactCode(transformedCode);
  }
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
    serverExternalPackages: config.serverExternalPackages,
    dev: config.mode === "development",
    unresolvedSpecifiers: [...moduleUnresolvedSpecifiers],
    cycleArtifactPath: useCycleArtifact ? cycleManifest.reserveArtifactPath(filePath) : undefined,
    deferCachePublication: (publication) => {
      if (cycleBound && !ownsCycleManifest) return;
      cycleManifest.deferCachePublication(async () => {
        if (cycleBound && contentSourceId) {
          await registerCycleManifestSources(
            tmpDir,
            projectDir,
            sourceGraph.cycleBoundSources,
          );
        }
        await publication();
      });
    },
  });
  cycleManifest.recordArtifact(
    filePath,
    persistedPath,
    exposesDefault,
    ownsCycleManifest,
  );
  if (ownsCycleManifest) await cycleManifest.commit(localAdapter);
  cacheUnresolvedSpecifiers(cacheKey, [...moduleUnresolvedSpecifiers]);
  sourceGraph.unresolvedBySource.set(filePath, [...moduleUnresolvedSpecifiers]);
  for (const specifier of moduleUnresolvedSpecifiers) unresolvedSpecifiers.add(specifier);
  markModuleLoadProgress(config, "module:persisted", filePath);
  return persistedPath;
}

/** Transform a module graph while sharing each planned source's in-flight result. */
export function transformModuleWithDeps(
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  useLocalAdapter = false,
  lineage: ReadonlySet<string> = new Set(),
  cycleManifest?: CycleManifestTransaction,
  unresolvedSpecifiers: Set<string> = new Set(),
): Promise<string> {
  const sourceGraph = cycleManifest ? sourceGraphByCycleManifest.get(cycleManifest) : undefined;
  if (!sourceGraph) {
    return transformModuleWithDepsUnmemoized(
      filePath,
      tmpDir,
      localAdapter,
      config,
      useLocalAdapter,
      lineage,
      cycleManifest,
      unresolvedSpecifiers,
    );
  }

  const pending = sourceGraph.transforms.get(filePath);
  if (pending) {
    return pending.then((path) => {
      for (const specifier of sourceGraph.unresolvedBySource.get(filePath) ?? []) {
        unresolvedSpecifiers.add(specifier);
      }
      return path;
    });
  }

  const transform = transformModuleWithDepsUnmemoized(
    filePath,
    tmpDir,
    localAdapter,
    config,
    useLocalAdapter,
    lineage,
    cycleManifest,
    unresolvedSpecifiers,
  );
  sourceGraph.transforms.set(filePath, transform);
  void transform.catch(() => {
    if (sourceGraph.transforms.get(filePath) === transform) {
      sourceGraph.transforms.delete(filePath);
    }
  });
  return transform;
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
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
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

function normalizeMissingModuleTarget(message: string): string {
  const target = missingModuleTarget(message).replace(/[?#].*$/, "");
  if (target.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(target).pathname);
    } catch {
      return target.replace(/^file:\/+/, "/");
    }
  }
  return target;
}

function normalizeUnresolvedSpecifier(specifier: string): string {
  const withoutSuffix = specifier.replace(/[?#].*$/, "");
  return (rewriteSsrProjectAliasSpecifier(withoutSuffix) ?? withoutSuffix)
    .replace(/^(\.\/|\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

function missingTargetMatchesSpecifier(target: string, specifier: string): boolean {
  const normalizedSpecifier = normalizeUnresolvedSpecifier(specifier);
  if (!normalizedSpecifier) return false;
  return target === normalizedSpecifier || target.endsWith(`/${normalizedSpecifier}`);
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
  const missingTarget = normalizeMissingModuleTarget(message);
  return [...unresolvedSpecifiers].some((specifier) =>
    missingTargetMatchesSpecifier(missingTarget, specifier)
  );
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
  const prepared = getRuntimeModuleLoader(config.adapter);
  if (prepared) {
    markModuleLoadProgress(config, "module:import-start", filePath);
    const module = await prepared.importModule({ kind: "source", path: filePath });
    markModuleLoadProgress(config, "module:imported", filePath);
    return module;
  }
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
          config.serverExternalPackages,
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
          config.serverExternalPackages,
          config.mode === "development",
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
