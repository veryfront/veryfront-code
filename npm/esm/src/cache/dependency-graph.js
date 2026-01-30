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
    dependencies = new Map();
    /** Map from file path to files that depend on it */
    dependents = new Map();
    /**
     * Add a module and its dependencies to the graph.
     */
    addModule(filePath, dependencies) {
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
    getDirectDependencies(filePath) {
        const deps = this.dependencies.get(filePath);
        return deps ? Array.from(deps) : [];
    }
    /**
     * Get all transitive dependencies of a module (with cycle detection).
     */
    getTransitiveDependencies(filePath) {
        const visited = new Set();
        const path = new Set(); // Current traversal path for cycle detection
        this.collectDeps(filePath, visited, path);
        // Remove the starting file from results
        visited.delete(filePath);
        return Array.from(visited);
    }
    /**
     * Get all modules that directly or transitively depend on a file.
     */
    getDependents(filePath) {
        const visited = new Set();
        const path = new Set();
        this.collectDependents(filePath, visited, path);
        // Remove the starting file from results
        visited.delete(filePath);
        return Array.from(visited);
    }
    /**
     * Check if adding a dependency would create a cycle.
     */
    wouldCreateCycle(from, to) {
        // A cycle exists if 'from' is reachable from 'to'
        const reachable = this.getTransitiveDependencies(to);
        return reachable.includes(from);
    }
    /**
     * Clear the graph.
     */
    clear() {
        this.dependencies.clear();
        this.dependents.clear();
    }
    /**
     * Get all modules in the graph.
     */
    getAllModules() {
        return Array.from(this.dependencies.keys());
    }
    collectDeps(filePath, visited, path) {
        // Cycle detected - already in current path
        if (path.has(filePath))
            return;
        // Already fully processed
        if (visited.has(filePath))
            return;
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
    collectDependents(filePath, visited, path) {
        if (path.has(filePath))
            return;
        if (visited.has(filePath))
            return;
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
export async function extractImports(code) {
    const parsed = await parseAllImports(code);
    return parsed.imports.map((imp) => imp.specifier);
}
/**
 * Filter imports to only local/relative paths (not npm packages or URLs).
 */
export function filterLocalImports(specifiers) {
    return specifiers.filter((spec) => {
        // Keep relative imports
        if (spec.startsWith("./") || spec.startsWith("../"))
            return true;
        // Keep @/ alias imports
        if (spec.startsWith("@/"))
            return true;
        // Keep #veryfront imports
        if (spec.startsWith("#veryfront/"))
            return true;
        // Keep file:// imports
        if (spec.startsWith("file://"))
            return true;
        // Skip everything else (npm packages, https://, etc.)
        return false;
    });
}
/**
 * Normalize import specifier to a file path.
 */
export function normalizeSpecifierToPath(specifier, fromFile, projectDir) {
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
            if (part === "..")
                parts.pop();
            else if (part !== ".")
                parts.push(part);
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
function normalizeExtension(path) {
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
export async function computeDepsHash(filePath, getContent, projectDir) {
    const graph = new DependencyGraph();
    const contentHashes = new Map();
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
async function buildDependencyGraph(filePath, graph, contentHashes, getContent, projectDir, visited = new Set()) {
    if (visited.has(filePath))
        return;
    visited.add(filePath);
    try {
        const content = await getContent(filePath);
        contentHashes.set(filePath, await computeHash(content));
        const allImports = await extractImports(content);
        const localImports = filterLocalImports(allImports);
        const normalizedDeps = localImports.map((spec) => normalizeSpecifierToPath(spec, filePath, projectDir));
        graph.addModule(filePath, normalizedDeps);
        // Recursively process dependencies
        await Promise.all(normalizedDeps.map((dep) => buildDependencyGraph(dep, graph, contentHashes, getContent, projectDir, visited)));
    }
    catch {
        // File doesn't exist or can't be read - skip
        graph.addModule(filePath, []);
    }
}
