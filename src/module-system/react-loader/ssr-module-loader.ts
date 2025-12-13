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

/** Cache mapping file paths and content hashes to temp file paths */
const globalModuleCache = new Map<string, string>();
/** Set tracking files currently being transformed to prevent circular dependencies */
const globalInProgress = new Set<string>();
/** Cache of temp directories by project directory */
const globalTmpDirs = new Map<string, string>();

/**
 * Clear the SSR module cache.
 * Optionally clears temp directories as well.
 */
export function clearSSRModuleCache(options?: { clearTmpDirs?: boolean }): void {
  globalModuleCache.clear();
  globalInProgress.clear();
  if (options?.clearTmpDirs) {
    globalTmpDirs.clear();
  }
}

export class SSRModuleLoader {
  private localFs = createFileSystem();

  constructor(private options: SSRModuleLoaderOptions) {}

  async loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    await this.transformWithDependencies(filePath, source);

    const tempPath = globalModuleCache.get(filePath);
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

  private async transformWithDependencies(
    filePath: string,
    source?: string,
  ): Promise<void> {
    // Use adapter's fs for reading project files (supports remote FSAdapter)
    const code = source ?? await this.options.adapter.fs.readFile(filePath);

    const contentHash = this.hashCode(code);
    const cacheKey = `${filePath}:${contentHash}`;

    if (globalModuleCache.has(cacheKey)) {
      const tempPath = globalModuleCache.get(cacheKey)!;
      globalModuleCache.set(filePath, tempPath);
      return;
    }

    if (globalInProgress.has(filePath)) {
      return;
    }

    globalInProgress.add(filePath);

    try {
      const localImports = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
      );

      for (const imp of localImports) {
        await this.transformWithDependencies(imp.absolutePath);
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

      const tempPath = await this.getTempPath(filePath, contentHash);
      const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
      await this.localFs.mkdir(tempDir, { recursive: true });
      await this.localFs.writeTextFile(tempPath, transformed);

      globalModuleCache.set(cacheKey, tempPath);
      globalModuleCache.set(filePath, tempPath);
    } finally {
      globalInProgress.delete(filePath);
    }
  }

  /**
   * Generate a simple hash code for content-based cache keys.
   * Uses djb2 algorithm variant for better distribution.
   */
  private hashCode(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) + hash) ^ char;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }

  private async getTempPath(filePath: string, contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();

    let relativePath = filePath;
    const projectDir = this.options.projectDir.replace(/\/$/, "");
    if (filePath.startsWith(projectDir)) {
      relativePath = filePath.substring(projectDir.length);
    }

    const hashSuffix = contentHash ? `.${contentHash}` : "";
    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `${hashSuffix}.js`);
    return join(tmpDir, jsPath);
  }

  private async ensureTmpDir(): Promise<string> {
    const projectDir = this.options.projectDir;

    const existingDir = globalTmpDirs.get(projectDir);
    if (existingDir) {
      return existingDir;
    }

    const tmpDir = join(projectDir, "node_modules", ".cache", "veryfront-ssr");

    await this.localFs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(projectDir, tmpDir);
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
