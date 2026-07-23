/**
 * Dependency graph for import tracking and cache invalidation.
 * Computes depsHash for transform cache keys.
 */

import { computeHash, logger as baseLogger } from "#veryfront/utils";
import { parseAllImports } from "#veryfront/transforms/import-rewriter/parse-cache.ts";
import { dirname, extname, fromFileUrl, isAbsolute, join, resolve } from "#veryfront/compat/path";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { Semaphore } from "#veryfront/utils/semaphore.ts";

const logger = baseLogger.component("dependency-graph");
const MAX_DEPENDENCIES_PER_MODULE = 1_000;
const MAX_DEPENDENCIES_PER_TRAVERSAL = 100_000;
const MAX_MODULES_PER_TRAVERSAL = 10_000;
const MAX_DEPENDENCY_DEPTH = 256;
const MAX_CACHED_MODULES = 50_000;
const MAX_DEPENDENCY_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_DEPENDENCY_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT_DEPENDENCY_READS = 8;
const dependencyEncoder = new TextEncoder();
const RESOLUTION_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;

export class DependencyGraph {
  private dependencies = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();

  addModule(filePath: string, dependencies: string[]): void {
    if (dependencies.length > MAX_DEPENDENCIES_PER_MODULE) {
      throw new RangeError(`Module contains too many dependencies: ${filePath}`);
    }
    // REPLACE the dependency set rather than unioning: when a module is edited
    // and re-added, imports it no longer has must be dropped, otherwise removed
    // edges linger and invalidation is computed against stale dependencies.
    const nextDeps = new Set(dependencies);

    const prevDeps = this.dependencies.get(filePath);
    if (prevDeps) {
      for (const oldDep of prevDeps) {
        if (!nextDeps.has(oldDep)) {
          const dependents = this.dependents.get(oldDep);
          dependents?.delete(filePath);
          if (dependents?.size === 0) this.dependents.delete(oldDep);
        }
      }
    }

    for (const dep of nextDeps) {
      const depsOfDep = this.dependents.get(dep) ?? new Set<string>();
      depsOfDep.add(filePath);
      this.dependents.set(dep, depsOfDep);
    }

    this.dependencies.set(filePath, nextDeps);
  }

  getDirectDependencies(filePath: string): string[] {
    return Array.from(this.dependencies.get(filePath) ?? []);
  }

  getTransitiveDependencies(filePath: string): string[] {
    const visited = this.collectReachable(filePath, this.dependencies);
    visited.delete(filePath);
    return Array.from(visited);
  }

  getDependents(filePath: string): string[] {
    const visited = this.collectReachable(filePath, this.dependents);
    visited.delete(filePath);
    return Array.from(visited);
  }

  removeModule(filePath: string): void {
    const previousDeps = this.dependencies.get(filePath);
    if (previousDeps) {
      for (const dep of previousDeps) {
        const dependents = this.dependents.get(dep);
        dependents?.delete(filePath);
        if (dependents?.size === 0) this.dependents.delete(dep);
      }
    }

    this.dependencies.delete(filePath);
  }

  wouldCreateCycle(from: string, to: string): boolean {
    if (from === to) return true;
    const visited = new Set<string>();
    const stack = [to];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const dependency of this.dependencies.get(current) ?? []) {
        if (dependency === from) return true;
        if (!visited.has(dependency)) stack.push(dependency);
      }
    }
    return false;
  }

  clear(): void {
    this.dependencies.clear();
    this.dependents.clear();
  }

  getAllModules(): string[] {
    return Array.from(this.dependencies.keys());
  }

  private collectReachable(
    root: string,
    edges: ReadonlyMap<string, ReadonlySet<string>>,
  ): Set<string> {
    const visited = new Set<string>();
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of edges.get(current) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
    }
    return visited;
  }
}

export interface DependencyHashCache {
  graph: DependencyGraph;
  contentHashes: Map<string, string>;
  completedModules: Set<string>;
  inProgressModules: Map<string, Promise<void>>;
  buildQueue: Promise<void>;
  generation: number;
  resolutionIdentity?: string;
}

export function createDependencyHashCache(): DependencyHashCache {
  return {
    graph: new DependencyGraph(),
    contentHashes: new Map<string, string>(),
    completedModules: new Set<string>(),
    inProgressModules: new Map<string, Promise<void>>(),
    buildQueue: Promise.resolve(),
    generation: 0,
  };
}

export function invalidateDependencyHashCache(
  cache: DependencyHashCache,
  changedPaths: Iterable<string>,
): number {
  // In-flight reads cannot be cancelled. Advancing the generation ensures they
  // cannot commit stale graph/hash state after this invalidation returns.
  cache.generation++;
  const modulesToInvalidate = new Set<string>();

  for (const changedPath of changedPaths) {
    modulesToInvalidate.add(changedPath);
    for (const dependent of cache.graph.getDependents(changedPath)) {
      modulesToInvalidate.add(dependent);
    }
  }

  for (const filePath of modulesToInvalidate) {
    cache.completedModules.delete(filePath);
    cache.contentHashes.delete(filePath);
    cache.inProgressModules.delete(filePath);
    cache.graph.removeModule(filePath);
  }

  return modulesToInvalidate.size;
}

export async function extractImports(code: string): Promise<string[]> {
  const parsed = await parseAllImports(code);
  return parsed.imports.map((imp) => imp.specifier);
}

function getLongestMatchingScope(
  importMap: ImportMapConfig,
  fromFile: string,
): Record<string, string> | undefined {
  let bestKey: string | undefined;
  for (const scope of Object.keys(importMap.scopes ?? {})) {
    if (fromFile.startsWith(scope) && (bestKey === undefined || scope.length > bestKey.length)) {
      bestKey = scope;
    }
  }
  return bestKey === undefined ? undefined : importMap.scopes?.[bestKey];
}

function resolveImportMapEntry(
  specifier: string,
  importMap: ImportMapConfig | undefined,
  fromFile: string,
): string {
  if (!importMap) return specifier;
  const scoped = getLongestMatchingScope(importMap, fromFile);
  const resolveMappings = (mappings: Record<string, string> | undefined): string | undefined => {
    if (!mappings) return undefined;
    if (Object.prototype.hasOwnProperty.call(mappings, specifier)) {
      return mappings[specifier];
    }

    let bestPrefix: string | undefined;
    let bestValue: string | undefined;
    for (const [prefix, value] of Object.entries(mappings)) {
      if (
        prefix.endsWith("/") && specifier.startsWith(prefix) &&
        (bestPrefix === undefined || prefix.length > bestPrefix.length)
      ) {
        bestPrefix = prefix;
        bestValue = value;
      }
    }
    return bestPrefix === undefined || bestValue === undefined
      ? undefined
      : `${bestValue}${specifier.slice(bestPrefix.length)}`;
  };

  // Import-map scopes are an override layer: once a scoped prefix matches,
  // a global exact or longer global prefix must not replace it.
  return resolveMappings(scoped) ?? resolveMappings(importMap.imports) ?? specifier;
}

function isLocalSpecifier(specifier: string): boolean {
  if (specifier.startsWith("/_vf_modules/")) return false;
  return specifier.startsWith("./") || specifier.startsWith("../") ||
    specifier.startsWith("@/") || specifier.startsWith("file://") ||
    isAbsolute(specifier);
}

/**
 * Filter imports to local files after applying import-map aliases. Remote,
 * npm, data, and framework-runtime imports are intentionally excluded.
 */
export function filterLocalImports(
  specifiers: string[],
  importMap?: ImportMapConfig,
  fromFile = "",
): string[] {
  const local: string[] = [];
  for (const specifier of specifiers) {
    if (specifier.startsWith("#veryfront/")) continue;
    const mapped = resolveImportMapEntry(specifier, importMap, fromFile);
    if (isLocalSpecifier(mapped)) local.push(mapped);
  }
  return local;
}

export function normalizeSpecifierToPath(
  specifier: string,
  fromFile: string,
  projectDir: string,
): string {
  const fromPath = fromFile.startsWith("file://") ? fromFileUrl(fromFile) : fromFile;

  if (specifier.startsWith("@/")) {
    return resolve(projectDir, specifier.slice(2).replace(/[?#].*$/, ""));
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const pathPart = specifier.replace(/[?#].*$/, "");
    return resolve(dirname(fromPath), pathPart);
  }

  if (specifier.startsWith("file://")) {
    return fromFileUrl(specifier);
  }

  if (isAbsolute(specifier)) return resolve(specifier.replace(/[?#].*$/, ""));

  return specifier;
}

function importMapRelativePath(
  specifier: string,
  originalSpecifier: string,
  projectDir: string,
): string {
  if (
    specifier !== originalSpecifier &&
    (specifier.startsWith("./") || specifier.startsWith("../"))
  ) {
    return resolve(projectDir, specifier.replace(/[?#].*$/, ""));
  }
  return specifier;
}

export interface DependencyResolutionOptions {
  importMap?: ImportMapConfig;
  /** Stable identity for all resolver inputs, including the import map. */
  resolutionIdentity?: string;
}

interface DependencyTraversalState {
  modules: number;
  imports: number;
  sourceBytes: number;
  readonly prefetchedContent: Map<string, string>;
  readonly contentReads: Map<string, Promise<string>>;
  readonly readSemaphore: Semaphore;
}

function createTraversalState(): DependencyTraversalState {
  return {
    modules: 0,
    imports: 0,
    sourceBytes: 0,
    prefetchedContent: new Map(),
    contentReads: new Map(),
    readSemaphore: new Semaphore(MAX_CONCURRENT_DEPENDENCY_READS, {
      name: "dependency-graph-reads",
    }),
  };
}

async function readContentOnce(
  path: string,
  getContent: (path: string) => Promise<string>,
  traversal: DependencyTraversalState,
): Promise<string> {
  const prefetched = traversal.prefetchedContent.get(path);
  if (prefetched !== undefined) return prefetched;
  let read = traversal.contentReads.get(path);
  if (!read) {
    read = traversal.readSemaphore.acquire(() => getContent(path));
    traversal.contentReads.set(path, read);
  }
  try {
    const content = await read;
    if (typeof content !== "string") {
      throw new TypeError(`Dependency reader returned a non-string value for ${path}`);
    }
    if (content.length > MAX_DEPENDENCY_SOURCE_BYTES) {
      throw new RangeError(`Dependency source exceeds its byte limit: ${path}`);
    }
    const sourceBytes = dependencyEncoder.encode(content).byteLength;
    if (sourceBytes > MAX_DEPENDENCY_SOURCE_BYTES) {
      throw new RangeError(`Dependency source exceeds its byte limit: ${path}`);
    }
    traversal.sourceBytes += sourceBytes;
    if (traversal.sourceBytes > MAX_TOTAL_DEPENDENCY_SOURCE_BYTES) {
      throw new RangeError("Dependency traversal exceeds its aggregate source byte limit");
    }
    traversal.prefetchedContent.set(path, content);
    return content;
  } catch (error) {
    if (traversal.contentReads.get(path) === read) traversal.contentReads.delete(path);
    throw error;
  }
}

function dependencyCandidates(path: string): string[] {
  if (extname(path) !== "") return [path];
  const candidates = [path];
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(`${path}${extension}`);
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(join(path, `index${extension}`));
  return candidates;
}

async function resolveDependencyPath(
  normalizedPath: string,
  cache: DependencyHashCache,
  getContent: (path: string) => Promise<string>,
  traversal: DependencyTraversalState,
): Promise<string> {
  let lastError: unknown;
  for (const candidate of dependencyCandidates(normalizedPath)) {
    if (cache.completedModules.has(candidate) && cache.contentHashes.has(candidate)) {
      return candidate;
    }
    try {
      await readContentOnce(candidate, getContent, traversal);
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not resolve local dependency ${normalizedPath}`, { cause: lastError });
}

export async function computeDepsHash(
  filePath: string,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  cache: DependencyHashCache = createDependencyHashCache(),
  options: DependencyResolutionOptions = {},
): Promise<string> {
  // The final graph snapshot and digest belong inside the serialized generation
  // guard. Otherwise an invalidation after the queued build, but before this
  // snapshot, can clear the hashes and make us return SHA-256(empty).
  while (true) {
    const snapshot = await enqueueDependencyGraphBuild(cache, async () => {
      if (cache.resolutionIdentity !== options.resolutionIdentity) {
        resetDependencyHashCache(cache);
        cache.resolutionIdentity = options.resolutionIdentity;
      } else if (cache.graph.getAllModules().length > MAX_CACHED_MODULES) {
        resetDependencyHashCache(cache);
        cache.resolutionIdentity = options.resolutionIdentity;
      }

      while (true) {
        const generation = cache.generation;
        const traversal = createTraversalState();
        await buildDependencyGraph(
          filePath,
          cache,
          getContent,
          projectDir,
          generation,
          options,
          traversal,
        );
        if (cache.generation !== generation) continue;

        const deps = [filePath, ...cache.graph.getTransitiveDependencies(filePath)].sort();
        if (cache.generation !== generation) continue;
        const combinedIdentity = deps.map((dependency) => {
          const contentHash = cache.contentHashes.get(dependency);
          if (!contentHash) {
            throw new Error(`Dependency graph is missing a content hash for ${dependency}`);
          }
          return [dependency, contentHash] as const;
        });
        const combinedHash = JSON.stringify(combinedIdentity);
        const hash = await computeHash(combinedHash);

        if (cache.generation === generation) return { generation, hash };
      }
    });

    // Promise continuation ordering leaves one final boundary after the queued
    // callback resolves. Recheck it here; returning after this read is synchronous.
    if (cache.generation === snapshot.generation) return snapshot.hash;
  }
}

function resetDependencyHashCache(cache: DependencyHashCache): void {
  cache.generation++;
  cache.graph.clear();
  cache.contentHashes.clear();
  cache.completedModules.clear();
  cache.inProgressModules.clear();
}

async function enqueueDependencyGraphBuild<T>(
  cache: DependencyHashCache,
  build: () => Promise<T>,
): Promise<T> {
  const queuedBuild = cache.buildQueue.then(build);
  // Keep the queue chain alive for the next enqueue even if this build rejects,
  // but log rather than silently swallowing so build failures are observable.
  cache.buildQueue = queuedBuild.then(
    () => undefined,
    (error) => {
      logger.debug("Dependency graph build failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    },
  );
  return await queuedBuild;
}

async function buildDependencyGraph(
  filePath: string,
  cache: DependencyHashCache,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  generation: number,
  options: DependencyResolutionOptions,
  traversal: DependencyTraversalState,
  visited: Set<string> = new Set<string>(),
  depth = 0,
): Promise<void> {
  if (cache.generation !== generation) return;
  if (cache.completedModules.has(filePath)) return;
  if (visited.has(filePath)) return;
  if (depth > MAX_DEPENDENCY_DEPTH) {
    throw new RangeError(`Dependency graph exceeds its maximum depth at ${filePath}`);
  }
  traversal.modules++;
  if (traversal.modules > MAX_MODULES_PER_TRAVERSAL) {
    throw new RangeError("Dependency graph contains too many modules");
  }
  // NOTE: a completed module whose file is edited in place while the SAME cache
  // is reused keeps its stale content hash here. That staleness must be resolved
  // by evicting the edited file (and its dependents) from the cache at the
  // watch/transform layer on the edit event — NOT by re-reading every completed
  // module on each traversal, which would defeat cross-root read de-duplication.
  // The stale-EDGE half of that hazard is handled in addModule() above, which
  // replaces (rather than unions) a module's dependency set when it is re-added.

  visited.add(filePath);

  const inProgress = cache.inProgressModules.get(filePath);
  if (inProgress) {
    await inProgress;
    return;
  }

  const buildPromise = buildDependencyGraphFresh(
    filePath,
    cache,
    getContent,
    projectDir,
    visited,
    generation,
    options,
    traversal,
    depth,
  );
  cache.inProgressModules.set(filePath, buildPromise);

  try {
    await buildPromise;
  } finally {
    if (cache.inProgressModules.get(filePath) === buildPromise) {
      cache.inProgressModules.delete(filePath);
    }
  }
}

async function buildDependencyGraphFresh(
  filePath: string,
  cache: DependencyHashCache,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  visited: Set<string>,
  generation: number,
  options: DependencyResolutionOptions,
  traversal: DependencyTraversalState,
  depth: number,
): Promise<void> {
  let content: string;
  try {
    content = await readContentOnce(filePath, getContent, traversal);
  } catch (error) {
    // If this traversal was invalidated while the read was pending, let the
    // outer generation loop retry instead of reporting a stale read failure.
    if (cache.generation !== generation) return;

    // Omitting an unreadable module would produce a valid-looking digest for an
    // incomplete graph. Propagate the failure so callers can bypass caching or
    // fail the operation; a later call can safely retry with the same cache.
    throw new Error(
      `Failed to compute dependency cache identity: could not read ${filePath}`,
      { cause: error },
    );
  }

  if (cache.generation !== generation) return;
  cache.contentHashes.set(filePath, await computeHash(content));
  if (cache.generation !== generation) return;

  let normalizedDeps: string[];
  try {
    const allImports = await extractImports(content);
    if (allImports.length > MAX_DEPENDENCIES_PER_MODULE) {
      throw new RangeError(`Module contains too many imports: ${filePath}`);
    }
    traversal.imports += allImports.length;
    if (traversal.imports > MAX_DEPENDENCIES_PER_TRAVERSAL) {
      throw new RangeError("Dependency graph contains too many imports");
    }

    const localDependencies = new Map<string, string>();
    for (const originalSpecifier of allImports) {
      if (originalSpecifier.startsWith("#veryfront/")) continue;
      const mappedSpecifier = resolveImportMapEntry(
        originalSpecifier,
        options.importMap,
        filePath,
      );
      if (!isLocalSpecifier(mappedSpecifier)) continue;
      const pathSpecifier = importMapRelativePath(
        mappedSpecifier,
        originalSpecifier,
        projectDir,
      );
      const normalized = normalizeSpecifierToPath(pathSpecifier, filePath, projectDir);
      localDependencies.set(normalized, normalized);
    }

    normalizedDeps = await Promise.all(
      [...localDependencies.values()].map((dependency) =>
        resolveDependencyPath(dependency, cache, getContent, traversal)
      ),
    );
  } catch (error) {
    if (cache.generation !== generation) return;
    throw new Error(`Failed to resolve dependencies for ${filePath}`, { cause: error });
  }

  if (cache.generation !== generation) return;
  cache.graph.addModule(filePath, normalizedDeps);

  await Promise.all(
    normalizedDeps.map((dep) =>
      buildDependencyGraph(
        dep,
        cache,
        getContent,
        projectDir,
        generation,
        options,
        traversal,
        visited,
        depth + 1,
      )
    ),
  );

  if (cache.generation === generation) cache.completedModules.add(filePath);
}
