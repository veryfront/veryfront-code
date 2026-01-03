import { join } from "std/path/mod.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/transform-core.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { type MissingImport, parseLocalImports } from "@veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { LRUCache } from "../../core/utils/lru-wrapper.ts";
import { registerCache } from "../../core/memory/index.ts";

export interface SSRModuleLoaderOptions {
  projectDir: string;
  projectId: string;
  adapter: RuntimeAdapter;
  dev: boolean;
}

// Cache limits to prevent unbounded memory growth
const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;
const SSR_MODULE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SSR_TMP_DIRS_MAX_ENTRIES = 100;

// Shared cache across all SSRModuleLoader instances (persists across requests)
// Keys include projectId to isolate caches between different projects
// Using LRU cache to prevent unbounded memory growth
const globalModuleCache = new LRUCache<string, string>({
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
  ttlMs: SSR_MODULE_CACHE_TTL_MS,
  cleanupIntervalMs: 60000,
}); // projectId:absolutePath -> tempPath
const globalInProgress = new Set<string>(); // projectId:absolutePath (bounded by concurrent requests)
const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
  ttlMs: 60 * 60 * 1000, // 1 hour
}); // projectDir:projectId -> tmpDir

// Register caches with memory profiler
registerCache("ssr-module-cache", () => ({
  name: "ssr-module-cache",
  entries: globalModuleCache.size,
  maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
}));

registerCache("ssr-tmp-dirs", () => ({
  name: "ssr-tmp-dirs",
  entries: globalTmpDirs.size,
  maxEntries: SSR_TMP_DIRS_MAX_ENTRIES,
}));

// Track failed components to implement circuit breaker
const failedComponents = new Map<string, { count: number; lastFailure: number }>();
const CIRCUIT_BREAKER_THRESHOLD = 3; // Failures before circuit opens
const CIRCUIT_BREAKER_RESET_MS = 60 * 1000; // 1 minute reset window

/**
 * Clear the global SSR module cache.
 * This should be called when file contents change and modules need to be re-transformed.
 */
export function clearSSRModuleCache(): void {
  globalModuleCache.clear();
  globalInProgress.clear();
  failedComponents.clear();
  logger.info("[SSR-MODULE-LOADER] Cache cleared");
}

// Note: LRU cache handles cleanup automatically via TTL and max entries

export class SSRModuleLoader {
  private fs = createFileSystem();
  private missingDependencies: MissingImport[] = [];

  constructor(private options: SSRModuleLoaderOptions) {}

  async loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    // Check circuit breaker before attempting load
    const circuitKey = this.getCacheKey(filePath);
    const failureRecord = failedComponents.get(circuitKey);
    if (failureRecord) {
      const timeSinceFailure = Date.now() - failureRecord.lastFailure;
      if (
        failureRecord.count >= CIRCUIT_BREAKER_THRESHOLD &&
        timeSinceFailure < CIRCUIT_BREAKER_RESET_MS
      ) {
        throw toError(createError({
          type: "build",
          message:
            `Component ${filePath} is temporarily blocked due to repeated failures. Will retry in ${
              Math.ceil((CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000)
            }s.`,
          context: { file: filePath, phase: "circuit-breaker", failures: failureRecord.count },
        }));
      }
      // Reset circuit breaker if enough time has passed
      if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
        failedComponents.delete(circuitKey);
      }
    }

    // Reset missing dependencies for this load
    this.missingDependencies = [];

    try {
      await this.transformWithDependencies(filePath, source);

      // Check if any dependencies were missing
      if (this.missingDependencies.length > 0) {
        const missingList = this.missingDependencies
          .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
          .join("\n");

        logger.error("[SSR-MODULE-LOADER] Missing dependencies detected", {
          file: filePath.slice(-60),
          missing: this.missingDependencies.length,
          details: this.missingDependencies,
        });

        throw toError(createError({
          type: "build",
          message: `Component has missing dependencies:\n${missingList}`,
          context: {
            file: filePath,
            phase: "dependency-resolution",
            missing: this.missingDependencies,
          },
        }));
      }

      const cacheKey = this.getCacheKey(filePath);
      const tempPath = globalModuleCache.get(cacheKey);
      if (!tempPath) {
        throw toError(createError({
          type: "build",
          message: `Failed to transform module: ${filePath}`,
          context: { file: filePath, phase: "transform" },
        }));
      }

      const cacheBuster = Date.now();
      const mod = await import(`file://${tempPath}?t=${cacheBuster}`);

      // Success - reset failure count
      failedComponents.delete(circuitKey);

      return this.extractComponent(mod, filePath);
    } catch (error) {
      // Track failure for circuit breaker
      const existing = failedComponents.get(circuitKey);
      failedComponents.set(circuitKey, {
        count: (existing?.count ?? 0) + 1,
        lastFailure: Date.now(),
      });
      throw error;
    }
  }

  /**
   * Create a cache key that includes projectId to isolate between projects
   */
  private getCacheKey(filePath: string): string {
    return `${this.options.projectId}:${filePath}`;
  }

  private async transformWithDependencies(
    filePath: string,
    source?: string,
  ): Promise<void> {
    const code = source ?? await this.options.adapter.fs.readFile(filePath);

    const contentHash = this.hashCode(code);
    // Include projectId in cache keys to isolate between projects
    const contentCacheKey = this.getCacheKey(`${filePath}:${contentHash}`);
    const filePathCacheKey = this.getCacheKey(filePath);
    const inProgressKey = this.getCacheKey(filePath);

    const cachedEntry = globalModuleCache.get(contentCacheKey);
    if (cachedEntry) {
      // LRU cache handles TTL refresh on access
      // Also store under filePathCacheKey for lookup by filePath
      globalModuleCache.set(filePathCacheKey, cachedEntry);
      return;
    }

    if (globalInProgress.has(inProgressKey)) {
      return;
    }

    globalInProgress.add(inProgressKey);

    try {
      const parseResult = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );

      // Track missing dependencies
      if (parseResult.missing.length > 0) {
        this.missingDependencies.push(...parseResult.missing);
      }

      // Transform all resolved dependencies in parallel
      // The globalInProgress set prevents duplicate work
      await Promise.all(
        parseResult.imports.map(async (imp) => {
          try {
            const depSource = await this.options.adapter.fs.readFile(imp.absolutePath);
            await this.transformWithDependencies(imp.absolutePath, depSource);
          } catch (error) {
            // Track failed dependency reads
            this.missingDependencies.push({
              specifier: imp.specifier,
              fromFile: filePath,
              reason: `Failed to read file: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );

      const transformOpts: TransformOptions = {
        projectId: this.options.projectId,
        dev: this.options.dev,
        ssr: true,
      };

      const transformed = await transformToESM(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
        transformOpts,
      );

      // Write to temp path without content hash in filename
      // The imports are resolved to plain .js paths (e.g., ../components/Welcome.js)
      // so the file must be written with matching name (no hash suffix)
      // Cache busting is handled by the ?t=<timestamp> query string on import
      const tempPath = await this.getTempPath(filePath);
      const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
      await this.fs.mkdir(tempDir, { recursive: true });
      await this.fs.writeTextFile(tempPath, transformed);

      // Store both the content-keyed and filePath-keyed entries
      // LRU cache stores tempPath directly and handles TTL internally
      globalModuleCache.set(contentCacheKey, tempPath);
      globalModuleCache.set(filePathCacheKey, tempPath);
    } finally {
      globalInProgress.delete(inProgressKey);
    }
  }

  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private async getTempPath(filePath: string, _contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();

    let relativePath = filePath;
    const projectDir = this.options.projectDir.replace(/\/$/, "");
    if (filePath.startsWith(projectDir)) {
      relativePath = filePath.substring(projectDir.length);
    }

    // Don't include content hash in filename - it breaks import resolution
    // between transformed modules. The content-based cache keys in
    // globalModuleCache handle correctness, and the query param cache buster
    // on loadModule handles Deno's module cache.
    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    return join(tmpDir, jsPath);
  }

  private async ensureTmpDir(): Promise<string> {
    const projectDir = this.options.projectDir;
    const projectId = this.options.projectId;

    // Include projectId in cache key to isolate between projects
    const cacheKey = `${projectDir}:${projectId}`;

    // Check global cache first (shared across loader instances for same project)
    const existingDir = globalTmpDirs.get(cacheKey);
    if (existingDir) {
      return existingDir;
    }

    // Use node_modules/.cache for consistent temp directory across Node/Deno
    // This avoids temp dir leaks and enables cross-request caching
    // Include projectId in path to isolate temp files between projects
    const tmpDir = join(
      projectDir,
      "node_modules",
      ".cache",
      "veryfront-ssr",
      projectId || "default",
    );

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }

  private extractComponent(
    mod: unknown,
    filePath: string,
  ): React.ComponentType<Record<string, unknown>> {
    const moduleObj = mod as Record<string, unknown>;

    let component = moduleObj.default;

    if (!component) {
      const keys = Object.keys(moduleObj);
      const firstKey = keys[0];
      if (firstKey) {
        component = moduleObj[firstKey];
      }
    }

    if (!component) {
      throw toError(createError({
        type: "build",
        message: `No component exported from ${filePath}`,
        context: { file: filePath, phase: "transform" },
      }));
    }

    return component as React.ComponentType<Record<string, unknown>>;
  }
}
