/**
 * Project-level Tailwind Class Cache
 *
 * Extracts and caches all Tailwind class names from project source files.
 * This ensures CSS is generated for ALL classes, including those only
 * used in client-side components (skeletons, loading states, etc.).
 *
 * Cache invalidation is triggered by file changes via WebSocket pokes.
 */

import { extractCandidates } from "./tailwind-compiler.ts";
import { logger } from "#veryfront/utils";

/** In-memory cache of extracted classes per project */
const projectClassCache = new Map<string, Set<string>>();

/** Source file extensions to scan for classes */
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

/**
 * Check if a file should be scanned for Tailwind classes.
 */
function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Extract classes from a list of project files.
 * Called when project files are loaded or invalidated.
 */
export function extractClassesFromFiles(
  files: Array<{ path: string; content?: string }>,
): Set<string> {
  const classes = new Set<string>();

  for (const file of files) {
    if (!file.content || !isSourceFile(file.path)) continue;

    // Use simple plain-text extraction like Tailwind does
    // Tailwind's build() will filter out invalid classes
    const extracted = extractCandidates(file.content);
    for (const cls of extracted) {
      classes.add(cls);
    }
  }

  return classes;
}

/**
 * Update the class cache for a project.
 * Called when project files are loaded or invalidated.
 */
export function updateProjectClasses(
  projectKey: string,
  files: Array<{ path: string; content?: string }>,
): void {
  const startTime = performance.now();
  const classes = extractClassesFromFiles(files);

  projectClassCache.set(projectKey, classes);

  const duration = Math.round(performance.now() - startTime);
  logger.debug("[ClassCache] Updated project classes", {
    projectKey,
    classCount: classes.size,
    fileCount: files.length,
    sourceFiles: files.filter((f) => isSourceFile(f.path)).length,
    durationMs: duration,
  });
}

/**
 * Get cached classes for a project.
 * Returns undefined if not cached.
 */
export function getProjectClasses(projectKey: string): Set<string> | undefined {
  return projectClassCache.get(projectKey);
}

/**
 * Clear the class cache for a project.
 * Called when files change.
 */
export function clearProjectClasses(projectKey: string): void {
  const had = projectClassCache.has(projectKey);
  projectClassCache.delete(projectKey);
  if (had) {
    logger.debug("[ClassCache] Cleared project classes", { projectKey });
  }
}

/**
 * Clear all cached classes.
 */
export function clearAllClasses(): void {
  const count = projectClassCache.size;
  projectClassCache.clear();
  if (count > 0) {
    logger.debug("[ClassCache] Cleared all project classes", { projectCount: count });
  }
}

/**
 * Get cache stats for monitoring.
 */
export function getClassCacheStats(): {
  projectCount: number;
  totalClasses: number;
  projects: Array<{ key: string; classCount: number }>;
} {
  const projects: Array<{ key: string; classCount: number }> = [];
  let totalClasses = 0;

  for (const [key, classes] of projectClassCache) {
    projects.push({ key, classCount: classes.size });
    totalClasses += classes.size;
  }

  return {
    projectCount: projectClassCache.size,
    totalClasses,
    projects,
  };
}
