/**
 * Consolidated file discovery utility
 *
 * Provides unified file walking, filtering, and pattern matching
 * for route discovery, build asset scanning, and module discovery.
 */

import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { denoAdapter } from "@veryfront/platform/adapters/runtime/deno";

export interface FileDiscoveryOptions {
  /**
   * Base directory to start searching from
   */
  baseDir: string;

  /**
   * File extensions to include (e.g., [".ts", ".tsx", ".mdx"])
   * If not specified, all files are included
   */
  extensions?: string[];

  /**
   * File name patterns to match (e.g., ["page", "layout", "route"])
   * Files must match at least one pattern if specified
   */
  patterns?: string[];

  /**
   * Whether to recursively traverse subdirectories
   * @default true
   */
  recursive?: boolean;

  /**
   * Maximum depth for recursive traversal
   * @default Infinity
   */
  maxDepth?: number;

  /**
   * Directory or file name patterns to ignore (e.g., ["node_modules", ".git"])
   */
  ignorePatterns?: string[];

  /**
   * Include directories in the results
   * @default false
   */
  includeDirs?: boolean;

  /**
   * Follow symbolic links
   * @default false
   */
  followSymlinks?: boolean;

  /**
   * Runtime adapter for filesystem operations
   * If not provided, uses the default Deno adapter (for backward compatibility)
   */
  adapter?: RuntimeAdapter;
}

export interface FileDiscoveryResult {
  /**
   * Absolute path to the file or directory
   */
  path: string;

  /**
   * File or directory name
   */
  name: string;

  /**
   * Whether this is a file
   */
  isFile: boolean;

  /**
   * Whether this is a directory
   */
  isDirectory: boolean;

  /**
   * Current depth from base directory
   */
  depth: number;
}

/**
 * Check if a file matches the given extensions
 */
function matchesExtensions(fileName: string, extensions: string[] | undefined): boolean {
  if (!extensions || extensions.length === 0) {
    return true;
  }
  return extensions.some((ext) => fileName.endsWith(ext));
}

/**
 * Check if a file matches the given patterns
 */
function matchesPatterns(fileName: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => fileName.includes(pattern));
}

/**
 * Check if a path should be ignored
 */
function shouldIgnore(name: string, ignorePatterns: string[] | undefined): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return false;
  }
  return ignorePatterns.some((pattern) => name.includes(pattern));
}

/**
 * Discover files matching the given criteria
 *
 * @example
 * ```ts
 * // Find all TypeScript route files
 * for await (const file of discoverFiles({
 *   baseDir: "./app",
 *   extensions: [".ts", ".tsx"],
 *   patterns: ["route"],
 * })) {
 *   console.log(file.path);
 * }
 * ```
 */
export async function* discoverFiles(
  options: FileDiscoveryOptions,
): AsyncGenerator<FileDiscoveryResult> {
  const {
    baseDir,
    extensions,
    patterns,
    recursive = true,
    maxDepth = Infinity,
    ignorePatterns,
    includeDirs = false,
    followSymlinks = false,
    adapter = denoAdapter,
  } = options;

  yield* walkDirectory(
    baseDir,
    0,
    maxDepth,
    extensions,
    patterns,
    ignorePatterns,
    includeDirs,
    recursive,
    followSymlinks,
    adapter,
  );
}

/**
 * Internal recursive directory walker
 */
async function* walkDirectory(
  dir: string,
  currentDepth: number,
  maxDepth: number,
  extensions: string[] | undefined,
  patterns: string[] | undefined,
  ignorePatterns: string[] | undefined,
  includeDirs: boolean,
  recursive: boolean,
  followSymlinks: boolean,
  adapter: RuntimeAdapter,
): AsyncGenerator<FileDiscoveryResult> {
  // Check depth limit
  if (currentDepth > maxDepth) {
    return;
  }

  try {
    // Use adapter for cross-platform filesystem access
    const entries = adapter.fs.readDir(dir);

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Check if should be ignored
      if (shouldIgnore(entry.name, ignorePatterns)) {
        continue;
      }

      // Handle directories
      if (entry.isDirectory) {
        // Yield directory if requested
        if (includeDirs) {
          yield {
            path: fullPath,
            name: entry.name,
            isFile: false,
            isDirectory: true,
            depth: currentDepth,
          };
        }

        // Recurse into directory if enabled
        if (recursive) {
          yield* walkDirectory(
            fullPath,
            currentDepth + 1,
            maxDepth,
            extensions,
            patterns,
            ignorePatterns,
            includeDirs,
            recursive,
            followSymlinks,
            adapter,
          );
        }
      } // Handle files
      else if (entry.isFile) {
        // Check extension and pattern matches
        if (
          matchesExtensions(entry.name, extensions) &&
          matchesPatterns(entry.name, patterns)
        ) {
          yield {
            path: fullPath,
            name: entry.name,
            isFile: true,
            isDirectory: false,
            depth: currentDepth,
          };
        }
      } // Handle symlinks (if following is enabled)
      else if (entry.isSymlink && followSymlinks) {
        // For symlinks, we need to check what they point to
        try {
          const stat = await adapter.fs.stat(fullPath);

          if (stat.isDirectory && recursive) {
            yield* walkDirectory(
              fullPath,
              currentDepth + 1,
              maxDepth,
              extensions,
              patterns,
              ignorePatterns,
              includeDirs,
              recursive,
              followSymlinks,
              adapter,
            );
          } else if (stat.isFile) {
            if (
              matchesExtensions(entry.name, extensions) &&
              matchesPatterns(entry.name, patterns)
            ) {
              yield {
                path: fullPath,
                name: entry.name,
                isFile: true,
                isDirectory: false,
                depth: currentDepth,
              };
            }
          }
        } catch {
          // Ignore broken symlinks
        }
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
    // Silently skip - this is expected behavior for optional directories
  }
}

/**
 * Collect all files matching criteria into an array
 *
 * @example
 * ```ts
 * const mdxFiles = await collectFiles({
 *   baseDir: "./pages",
 *   extensions: [".mdx"],
 * });
 * ```
 */
export async function collectFiles(
  options: FileDiscoveryOptions,
): Promise<FileDiscoveryResult[]> {
  const results: FileDiscoveryResult[] = [];
  for await (const file of discoverFiles(options)) {
    results.push(file);
  }
  return results;
}

/**
 * Check if a directory has files matching criteria
 *
 * @example
 * ```ts
 * const hasRoutes = await hasMatchingFiles({
 *   baseDir: "./app",
 *   patterns: ["page", "layout"],
 * });
 * ```
 */
export async function hasMatchingFiles(
  options: FileDiscoveryOptions,
): Promise<boolean> {
  for await (const _file of discoverFiles(options)) {
    return true; // Found at least one matching file
  }
  return false;
}

/**
 * Count files matching criteria
 */
export async function countFiles(options: FileDiscoveryOptions): Promise<number> {
  let count = 0;
  for await (const _file of discoverFiles(options)) {
    count++;
  }
  return count;
}
