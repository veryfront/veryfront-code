/**
 * Dependency graph for import tracking and cache invalidation.
 * Computes depsHash for transform cache keys.
 */

import { computeHash } from "#veryfront/utils";
import { parseAllImports } from "#veryfront/transforms/import-rewriter/parse-cache.ts";

export class DependencyGraph {
  private dependencies = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();

  addModule(filePath: string, dependencies: string[]): void {
    const deps = this.dependencies.get(filePath) ?? new Set<string>();

    for (const dep of dependencies) {
      deps.add(dep);

      const depsOfDep = this.dependents.get(dep) ?? new Set<string>();
      depsOfDep.add(filePath);
      this.dependents.set(dep, depsOfDep);
    }

    this.dependencies.set(filePath, deps);
  }

  getDirectDependencies(filePath: string): string[] {
    return Array.from(this.dependencies.get(filePath) ?? []);
  }

  getTransitiveDependencies(filePath: string): string[] {
    const visited = new Set<string>();
    const path = new Set<string>();

    this.collectDeps(filePath, visited, path);
    visited.delete(filePath);

    return Array.from(visited);
  }

  getDependents(filePath: string): string[] {
    const visited = new Set<string>();
    const path = new Set<string>();

    this.collectDependents(filePath, visited, path);
    visited.delete(filePath);

    return Array.from(visited);
  }

  wouldCreateCycle(from: string, to: string): boolean {
    return this.hasTransitiveDependency(to, from, new Set(), new Set());
  }

  clear(): void {
    this.dependencies.clear();
    this.dependents.clear();
  }

  getAllModules(): string[] {
    return Array.from(this.dependencies.keys());
  }

  private collectDeps(
    filePath: string,
    visited: Set<string>,
    path: Set<string>,
  ): void {
    if (path.has(filePath) || visited.has(filePath)) return;

    visited.add(filePath);
    path.add(filePath);

    for (const dep of this.dependencies.get(filePath) ?? []) {
      this.collectDeps(dep, visited, path);
    }

    path.delete(filePath);
  }

  private hasTransitiveDependency(
    filePath: string,
    target: string,
    visited: Set<string>,
    path: Set<string>,
  ): boolean {
    if (path.has(filePath) || visited.has(filePath)) return false;

    visited.add(filePath);
    path.add(filePath);

    for (const dep of this.dependencies.get(filePath) ?? []) {
      if (dep === target || this.hasTransitiveDependency(dep, target, visited, path)) {
        path.delete(filePath);
        return true;
      }
    }

    path.delete(filePath);
    return false;
  }

  private collectDependents(
    filePath: string,
    visited: Set<string>,
    path: Set<string>,
  ): void {
    if (path.has(filePath) || visited.has(filePath)) return;

    visited.add(filePath);
    path.add(filePath);

    for (const dep of this.dependents.get(filePath) ?? []) {
      this.collectDependents(dep, visited, path);
    }

    path.delete(filePath);
  }
}

export interface DependencyHashCache {
  graph: DependencyGraph;
  contentHashes: Map<string, string>;
  completedModules: Set<string>;
  inProgressModules: Map<string, Promise<void>>;
  buildQueue: Promise<void>;
}

export function createDependencyHashCache(): DependencyHashCache {
  return {
    graph: new DependencyGraph(),
    contentHashes: new Map<string, string>(),
    completedModules: new Set<string>(),
    inProgressModules: new Map<string, Promise<void>>(),
    buildQueue: Promise.resolve(),
  };
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
  await enqueueDependencyGraphBuild(cache, () =>
    buildDependencyGraph(
      filePath,
      cache,
      getContent,
      projectDir,
    ));

  const deps = [filePath, ...cache.graph.getTransitiveDependencies(filePath)].sort();
  const combinedHash = deps
    .map((dep) => cache.contentHashes.get(dep) ?? "")
    .filter(Boolean)
    .join(":");

  return computeHash(combinedHash);
}

async function enqueueDependencyGraphBuild(
  cache: DependencyHashCache,
  build: () => Promise<void>,
): Promise<void> {
  const queuedBuild = cache.buildQueue.then(build);
  cache.buildQueue = queuedBuild.catch(() => {});
  await queuedBuild;
}

async function buildDependencyGraph(
  filePath: string,
  cache: DependencyHashCache,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  visited: Set<string> = new Set<string>(),
): Promise<void> {
  if (cache.completedModules.has(filePath)) return;
  if (visited.has(filePath)) return;
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
  );
  cache.inProgressModules.set(filePath, buildPromise);

  try {
    await buildPromise;
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
): Promise<void> {
  try {
    const content = await getContent(filePath);
    cache.contentHashes.set(filePath, await computeHash(content));

    const allImports = await extractImports(content);
    const normalizedDeps = filterLocalImports(allImports).map((spec) =>
      normalizeSpecifierToPath(spec, filePath, projectDir)
    );

    cache.graph.addModule(filePath, normalizedDeps);

    await Promise.all(
      normalizedDeps.map((dep) =>
        buildDependencyGraph(dep, cache, getContent, projectDir, visited)
      ),
    );
  } catch (_) {
    // expected: file may not exist or imports may fail to parse
    cache.graph.addModule(filePath, []);
  } finally {
    cache.completedModules.add(filePath);
  }
}
