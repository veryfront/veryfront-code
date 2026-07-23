/**
 * Dependency graph for import tracking and cache invalidation.
 * Computes depsHash for transform cache keys.
 */

import { logger as baseLogger } from "#veryfront/utils";
import { parseAllImports } from "#veryfront/transforms/import-rewriter/parse-cache.ts";
import { CACHE_ERROR, INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "./validation.ts";
import { sha256Hex } from "./hash.ts";

const logger = baseLogger.component("dependency-graph");
const DEFAULT_MAX_GRAPH_MODULES = 50_000;
const DEFAULT_MAX_DEPENDENCIES_PER_MODULE = 512;
const DEFAULT_MAX_GRAPH_EDGES = 500_000;
const MAX_GRAPH_CAPACITY = 1_000_000;
const MAX_DEPENDENCY_PATH_LENGTH = 4096;
const MAX_INVALIDATION_PATHS = 10_000;
const MAX_INVALIDATION_RETRIES = 3;

export interface DependencyGraphOptions {
  maxModules?: number;
  maxDependenciesPerModule?: number;
  maxEdges?: number;
}

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function dependencyFailure(operation: string): never {
  throw CACHE_ERROR.create({ detail: `Dependency graph ${operation} failed` });
}

function normalizeCapacity(value: unknown, fallback: number, label: string): number {
  const normalized = value ?? fallback;
  if (
    typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 1 ||
    normalized > MAX_GRAPH_CAPACITY
  ) {
    invalidArgument(`${label} must be a positive safe integer within the supported range`);
  }
  return normalized;
}

function assertDependencyPath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_DEPENDENCY_PATH_LENGTH || containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      "Dependency path must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

export class DependencyGraph {
  private dependencies = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();
  private readonly maxModules: number;
  private readonly maxDependenciesPerModule: number;
  private readonly maxEdges: number;
  private edgeCount = 0;

  constructor(options: DependencyGraphOptions = {}) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      invalidArgument("Dependency graph options must be an object");
    }
    let maxModules: unknown;
    let maxDependenciesPerModule: unknown;
    let maxEdges: unknown;
    try {
      maxModules = Reflect.get(options, "maxModules");
      maxDependenciesPerModule = Reflect.get(options, "maxDependenciesPerModule");
      maxEdges = Reflect.get(options, "maxEdges");
    } catch {
      invalidArgument("Dependency graph options must be readable");
    }
    this.maxModules = normalizeCapacity(
      maxModules,
      DEFAULT_MAX_GRAPH_MODULES,
      "Dependency graph module capacity",
    );
    this.maxDependenciesPerModule = normalizeCapacity(
      maxDependenciesPerModule,
      DEFAULT_MAX_DEPENDENCIES_PER_MODULE,
      "Dependency graph per-module dependency capacity",
    );
    this.maxEdges = normalizeCapacity(
      maxEdges,
      DEFAULT_MAX_GRAPH_EDGES,
      "Dependency graph edge capacity",
    );
  }

  addModule(filePath: string, dependencies: string[]): void {
    assertDependencyPath(filePath);
    if (!Array.isArray(dependencies)) invalidArgument("Module dependencies must be an array");
    if (dependencies.length > this.maxDependenciesPerModule) {
      throw SERVICE_OVERLOADED.create({
        message: "Module dependency capacity exceeded",
      });
    }
    const dependencySnapshot = dependencies.map((dependency) => {
      assertDependencyPath(dependency);
      return dependency;
    });
    // REPLACE the dependency set rather than unioning: when a module is edited
    // and re-added, imports it no longer has must be dropped, otherwise removed
    // edges linger and invalidation is computed against stale dependencies.
    const nextDeps = new Set(dependencySnapshot);

    const prevDeps = this.dependencies.get(filePath);
    if (!prevDeps && this.dependencies.size >= this.maxModules) {
      throw SERVICE_OVERLOADED.create({ message: "Dependency graph module capacity exceeded" });
    }
    const nextEdgeCount = this.edgeCount - (prevDeps?.size ?? 0) + nextDeps.size;
    if (nextEdgeCount > this.maxEdges) {
      throw SERVICE_OVERLOADED.create({ message: "Dependency graph edge capacity exceeded" });
    }
    if (prevDeps) {
      for (const oldDep of prevDeps) {
        if (!nextDeps.has(oldDep)) {
          const previousDependents = this.dependents.get(oldDep);
          previousDependents?.delete(filePath);
          if (previousDependents?.size === 0) this.dependents.delete(oldDep);
        }
      }
    }

    for (const dep of nextDeps) {
      const depsOfDep = this.dependents.get(dep) ?? new Set<string>();
      depsOfDep.add(filePath);
      this.dependents.set(dep, depsOfDep);
    }

    this.dependencies.set(filePath, nextDeps);
    this.edgeCount = nextEdgeCount;
  }

  getDirectDependencies(filePath: string): string[] {
    assertDependencyPath(filePath);
    return Array.from(this.dependencies.get(filePath) ?? []);
  }

  getTransitiveDependencies(filePath: string): string[] {
    assertDependencyPath(filePath);
    const visited = this.collectReachable(filePath, this.dependencies);
    visited.delete(filePath);

    return Array.from(visited);
  }

  getDependents(filePath: string): string[] {
    assertDependencyPath(filePath);
    const visited = this.collectReachable(filePath, this.dependents);
    visited.delete(filePath);

    return Array.from(visited);
  }

  removeModule(filePath: string): void {
    assertDependencyPath(filePath);
    const previousDeps = this.dependencies.get(filePath);
    if (previousDeps) {
      for (const dep of previousDeps) {
        const dependents = this.dependents.get(dep);
        dependents?.delete(filePath);
        if (dependents?.size === 0) this.dependents.delete(dep);
      }
    }

    this.dependencies.delete(filePath);
    this.edgeCount -= previousDeps?.size ?? 0;
  }

  wouldCreateCycle(from: string, to: string): boolean {
    assertDependencyPath(from);
    assertDependencyPath(to);
    if (from === to) return true;

    const visited = new Set<string>();
    const stack = [to];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const dependencies = Array.from(this.dependencies.get(current) ?? []);
      for (let index = dependencies.length - 1; index >= 0; index--) {
        const dependency = dependencies[index]!;
        if (dependency === from) return true;
        if (!visited.has(dependency)) stack.push(dependency);
      }
    }
    return false;
  }

  clear(): void {
    this.dependencies.clear();
    this.dependents.clear();
    this.edgeCount = 0;
  }

  getAllModules(): string[] {
    return Array.from(this.dependencies.keys());
  }

  private collectReachable(
    start: string,
    adjacency: Map<string, Set<string>>,
  ): Set<string> {
    const visited = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const neighbors = Array.from(adjacency.get(current) ?? []);
      for (let index = neighbors.length - 1; index >= 0; index--) {
        const neighbor = neighbors[index]!;
        if (!visited.has(neighbor)) stack.push(neighbor);
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
  const changedPathSnapshot: string[] = [];
  for (const changedPath of changedPaths) {
    assertDependencyPath(changedPath);
    changedPathSnapshot.push(changedPath);
    if (changedPathSnapshot.length > MAX_INVALIDATION_PATHS) {
      throw SERVICE_OVERLOADED.create({ message: "Dependency invalidation capacity exceeded" });
    }
  }
  cache.generation++;
  const modulesToInvalidate = new Set<string>();

  for (const changedPath of changedPathSnapshot) {
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

/**
 * Filter imports to only local/relative paths (excludes npm, URLs, and framework imports).
 */
export function filterLocalImports(specifiers: string[]): string[] {
  return specifiers.filter((spec) => {
    // Framework imports are resolved via import map, not filesystem
    if (spec.startsWith("#veryfront/")) return false;
    return (
      spec.startsWith("./") ||
      spec.startsWith("../") ||
      spec.startsWith("@/") ||
      spec.startsWith("file://")
    );
  });
}

export function normalizeSpecifierToPath(
  specifier: string,
  fromFile: string,
  projectDir: string,
): string {
  if (specifier.startsWith("@/")) {
    return normalizeExtension(`${projectDir}/${specifier.slice(2)}`);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
    const parts = fromDir.split("/").filter(Boolean);

    for (const part of specifier.split("/").filter(Boolean)) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }

    return normalizeExtension(`/${parts.join("/")}`);
  }

  if (specifier.startsWith("file://")) {
    return normalizeExtension(specifier.slice(7));
  }

  return specifier;
}

function normalizeExtension(path: string): string {
  return path.replace(/\.(tsx?|jsx)$/, ".js");
}

export async function computeDepsHash(
  filePath: string,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  cache: DependencyHashCache = createDependencyHashCache(),
): Promise<string> {
  assertDependencyPath(filePath);
  assertDependencyPath(projectDir);
  if (typeof getContent !== "function") {
    invalidArgument("Dependency content reader must be a function");
  }

  for (let attempt = 0; attempt < MAX_INVALIDATION_RETRIES; attempt++) {
    const generation = cache.generation;
    await enqueueDependencyGraphBuild(cache, () =>
      buildDependencyGraph(
        filePath,
        cache,
        getContent,
        projectDir,
        new Set<string>(),
        generation,
      ));
    if (generation !== cache.generation) continue;

    const deps = [filePath, ...cache.graph.getTransitiveDependencies(filePath)].sort();
    const hashes = deps.map((dep) => cache.contentHashes.get(dep));
    if (hashes.some((hash) => hash === undefined)) dependencyFailure("hash assembly");
    return sha256Hex(hashes.join(":"));
  }
  dependencyFailure("invalidation retry");
}

async function enqueueDependencyGraphBuild(
  cache: DependencyHashCache,
  build: () => Promise<void>,
): Promise<void> {
  const queuedBuild = cache.buildQueue.then(build);
  // Keep the queue chain alive for the next enqueue even if this build rejects,
  // but log rather than silently swallowing so build failures are observable.
  cache.buildQueue = queuedBuild.catch((error) => {
    logger.debug("Dependency graph build failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  });
  await queuedBuild;
}

async function buildDependencyGraph(
  filePath: string,
  cache: DependencyHashCache,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  visited: Set<string> = new Set<string>(),
  generation = cache.generation,
): Promise<void> {
  if (generation !== cache.generation) return;
  if (cache.completedModules.has(filePath)) return;
  if (visited.has(filePath)) return;
  // NOTE: a completed module whose file is edited in place while the SAME cache
  // is reused keeps its stale content hash here. That staleness must be resolved
  // by evicting the edited file (and its dependents) from the cache at the
  // watch/transform layer on the edit event, not by re-reading every completed
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
  );
  cache.inProgressModules.set(filePath, buildPromise);

  try {
    await buildPromise;
  } catch (error) {
    if (generation === cache.generation) {
      cache.completedModules.delete(filePath);
      cache.contentHashes.delete(filePath);
      cache.graph.removeModule(filePath);
    }
    throw error;
  } finally {
    cache.inProgressModules.delete(filePath);
  }
}

async function buildDependencyGraphFresh(
  filePath: string,
  cache: DependencyHashCache,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  visited: Set<string>,
  generation: number,
): Promise<void> {
  let content: string;
  try {
    content = await getContent(filePath);
  } catch (error) {
    logger.debug("Dependency read failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    dependencyFailure("read");
  }
  if (generation !== cache.generation) return;

  const contentHash = await sha256Hex(content);
  if (generation !== cache.generation) return;

  let normalizedDeps: string[];
  try {
    const allImports = await extractImports(content);
    normalizedDeps = filterLocalImports(allImports).map((spec) =>
      normalizeSpecifierToPath(spec, filePath, projectDir)
    );
  } catch (error) {
    logger.debug("Dependency parse failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    dependencyFailure("parse");
  }
  if (generation !== cache.generation) return;

  cache.contentHashes.set(filePath, contentHash);
  cache.graph.addModule(filePath, normalizedDeps);

  await Promise.all(
    normalizedDeps.map((dep) =>
      buildDependencyGraph(dep, cache, getContent, projectDir, visited, generation)
    ),
  );

  if (generation === cache.generation) cache.completedModules.add(filePath);
}
