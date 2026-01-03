import { join } from "std/path/mod.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/transform-core.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { parseLocalImports } from "@veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export interface SSRModuleLoaderOptions {
  projectDir: string;
  projectId: string;
  adapter: RuntimeAdapter;
  dev: boolean;
}

// Shared cache across all SSRModuleLoader instances (persists across requests)
// Keys include projectId to isolate caches between different projects
const globalModuleCache = new Map<string, string>(); // projectId:absolutePath -> tempPath
const globalInProgress = new Set<string>(); // projectId:absolutePath
const globalTmpDirs = new Map<string, string>(); // projectDir:projectId -> tmpDir

/**
 * Clear the global SSR module cache.
 * This should be called when file contents change and modules need to be re-transformed.
 */
export function clearSSRModuleCache(): void {
  globalModuleCache.clear();
  globalInProgress.clear();
}

export class SSRModuleLoader {
  private fs = createFileSystem();

  constructor(private options: SSRModuleLoaderOptions) {}

  async loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    await this.transformWithDependencies(filePath, source);

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

    return this.extractComponent(mod, filePath);
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

    const cachedTempPath = globalModuleCache.get(contentCacheKey);
    if (cachedTempPath) {
      globalModuleCache.set(filePathCacheKey, cachedTempPath);
      return;
    }

    if (globalInProgress.has(inProgressKey)) {
      return;
    }

    globalInProgress.add(inProgressKey);

    try {
      const localImports = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );

      for (const imp of localImports) {
        const depSource = await this.options.adapter.fs.readFile(imp.absolutePath);
        await this.transformWithDependencies(imp.absolutePath, depSource);
      }

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

      // Include content hash in temp path to avoid Deno module cache issues
      const tempPath = await this.getTempPath(filePath, contentHash);
      const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
      await this.fs.mkdir(tempDir, { recursive: true });
      await this.fs.writeTextFile(tempPath, transformed);

      // Store both the content-keyed and filePath-keyed entries
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

  private async getTempPath(filePath: string, contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();

    let relativePath = filePath;
    const projectDir = this.options.projectDir.replace(/\/$/, "");
    if (filePath.startsWith(projectDir)) {
      relativePath = filePath.substring(projectDir.length);
    }

    // Include content hash in filename to avoid Deno module cache issues
    // Different file versions get different temp paths
    const hashSuffix = contentHash ? `.${contentHash}` : "";
    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `${hashSuffix}.js`);
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
