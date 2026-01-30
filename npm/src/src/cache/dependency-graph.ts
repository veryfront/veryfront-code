/**
 * Dependency graph for import tracking and cache invalidation.
 *
 * Used to compute depsHash for transform cache keys, ensuring that
 * cache entries are invalidated when any transitive dependency changes.
 */

import { computeHash } from "../utils/index.js";
import { parseAllImports } from "../transforms/import-rewriter/parse-cache.js";

/**
 * Dependency graph for a set of modules.
 */
export class DependencyGraph {
  /** Map from file path to its direct dependencies */
  private dependencies = new Map<string, Set<string>>();

  /** Map from file path to files that depend on it */
  private dependents = new Map<string, Set<string>>();

  /**
   * Add a module and its dependencies to the graph.
   */
  addModule(filePath: string, dependencies: string[]): void {
    // Initialize or get existing dependencies
    const deps = this.dependencies.get(filePath) ?? new Set();

    for (const dep of dependencies) {
      deps.add(dep);

      // Update reverse mapping
      const depsOfDep = this.dependents.get(dep) ?? new Set();
      depsOfDep.add(filePath);
      this.dependents.set(dep, depsOfDep);
    }

    this.dependencies.set(filePath, deps);
  }

  /**
   * Get direct dependencies of a module.
   */
  getDirectDependencies(filePath: string): string[] {
    const deps = this.dependencies.get(filePath);
    return deps ? Array.from(deps) : [];
  }

  /**
   * Get all transitive dependencies of a module (with cycle detection).
   */
  getTransitiveDependencies(filePath: string): string[] {
    const visited = new Set<string>();
    const path = new Set<string>(); // Current traversal path for cycle detection

    this.collectDeps(filePath, visited, path);

    // Remove the starting file from results
    visited.delete(filePath);
    return Array.from(visited);
  }

  /**
   * Get all modules that directly or transitively depend on a file.
   */
  getDependents(filePath: string): string[] {
    const visited = new Set<string>();
    const path = new Set<string>();

    this.collectDependents(filePath, visited, path);

    // Remove the starting file from results
    visited.delete(filePath);
    return Array.from(visited);
  }

  /**
   * Check if adding a dependency would create a cycle.
   */
  wouldCreateCycle(from: string, to: string): boolean {
    // A cycle exists if 'from' is reachable from 'to'
    const reachable = this.getTransitiveDependencies(to);
    return reachable.includes(from);
  }

  /**
   * Clear the graph.
   */
  clear(): void {
    this.dependencies.clear();
    this.dependents.clear();
  }

  /**
   * Get all modules in the graph.
   */
  getAllModules(): string[] {
    return Array.from(this.dependencies.keys());
  }

  private collectDeps(
    filePath: string,
    visited: Set<string>,
    path: Set<string>,
  ): void {
    // Cycle detected - already in current path
    if (path.has(filePath)) return;

    // Already fully processed
    if (visited.has(filePath)) return;

    visited.add(filePath);
    path.add(filePath);

    const deps = this.dependencies.get(filePath);
    if (deps) {
      for (const dep of deps) {
        this.collectDeps(dep, visited, path);
      }
    }

    path.delete(filePath);
  }

  private collectDependents(
    filePath: string,
    visited: Set<string>,
    path: Set<string>,
  ): void {
    if (path.has(filePath)) return;
    if (visited.has(filePath)) return;

    visited.add(filePath);
    path.add(filePath);

    const depsOfThis = this.dependents.get(filePath);
    if (depsOfThis) {
      for (const dep of depsOfThis) {
        this.collectDependents(dep, visited, path);
      }
    }

    path.delete(filePath);
  }
}

/**
 * Extract import specifiers from code.
 */
export async function extractImports(code: string): Promise<string[]> {
  const parsed = await parseAllImports(code);
  return parsed.imports.map((imp) => imp.specifier);
}

/**
 * Filter imports to only local/relative paths (not npm packages or URLs).
 */
export function filterLocalImports(specifiers: string[]): string[] {
  return specifiers.filter((spec) => {
    // Keep relative imports
    if (spec.startsWith("./") || spec.startsWith("../")) return true;
    // Keep @/ alias imports
    if (spec.startsWith("@/")) return true;
    // Keep #veryfront imports
    if (spec.startsWith("#veryfront/")) return true;
    // Keep file:// imports
    if (spec.startsWith("file://")) return true;
    // Skip everything else (npm packages, https://, etc.)
    return false;
  });
}

/**
 * Normalize import specifier to a file path.
 */
export function normalizeSpecifierToPath(
  specifier: string,
  fromFile: string,
  projectDir: string,
): string {
  // Handle @/ alias
  if (specifier.startsWith("@/")) {
    const path = specifier.slice(2);
    return normalizeExtension(`${projectDir}/${path}`);
  }

  // Handle relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
    const parts = fromDir.split("/").filter(Boolean);

    for (const part of specifier.split("/").filter(Boolean)) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }

    return normalizeExtension("/" + parts.join("/"));
  }

  // Handle file:// URLs
  if (specifier.startsWith("file://")) {
    return normalizeExtension(specifier.slice(7));
  }

  // Return as-is for other specifiers
  return specifier;
}

function normalizeExtension(path: string): string {
  // Normalize .ts/.tsx/.jsx to .js for cache key consistency
  return path.replace(/\.(tsx?|jsx)$/, ".js");
}

/**
 * Compute a hash of dependencies for a module.
 *
 * @param filePath - The module's file path
 * @param getContent - Function to get file content by path
 * @param projectDir - Project root directory
 * @returns Hash string representing all transitive dependencies
 */
export async function computeDepsHash(
  filePath: string,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
): Promise<string> {
  const graph = new DependencyGraph();
  const contentHashes = new Map<string, string>();

  // Build dependency graph starting from the file
  await buildDependencyGraph(filePath, graph, contentHashes, getContent, projectDir);

  // Get all transitive dependencies in sorted order
  const deps = [filePath, ...graph.getTransitiveDependencies(filePath)].sort();

  // Combine content hashes in deterministic order
  const combinedHash = deps
    .map((dep) => contentHashes.get(dep) ?? "")
    .filter(Boolean)
    .join(":");

  return computeHash(combinedHash);
}

async function buildDependencyGraph(
  filePath: string,
  graph: DependencyGraph,
  contentHashes: Map<string, string>,
  getContent: (path: string) => Promise<string>,
  projectDir: string,
  visited = new Set<string>(),
): Promise<void> {
  if (visited.has(filePath)) return;
  visited.add(filePath);

  try {
    const content = await getContent(filePath);
    contentHashes.set(filePath, await computeHash(content));

    const allImports = await extractImports(content);
    const localImports = filterLocalImports(allImports);

    const normalizedDeps = localImports.map((spec) =>
      normalizeSpecifierToPath(spec, filePath, projectDir)
    );

    graph.addModule(filePath, normalizedDeps);

    // Recursively process dependencies
    await Promise.all(
      normalizedDeps.map((dep) =>
        buildDependencyGraph(dep, graph, contentHashes, getContent, projectDir, visited)
      ),
    );
  } catch {
    // File doesn't exist or can't be read - skip
    graph.addModule(filePath, []);
  }
}
