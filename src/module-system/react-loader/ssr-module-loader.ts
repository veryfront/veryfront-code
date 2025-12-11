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

export const globalModuleCache = new Map<string, string>();
const globalInProgress = new Set<string>();
const globalTmpDirs = new Map<string, string>();

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
    const mod = await this.loadFullModule(filePath, source);
    return this.extractComponent(mod, filePath);
  }

  async loadFullModule(
    filePath: string,
    source?: string,
  ): Promise<Record<string, unknown>> {
    const fileContent = source ?? await this.options.adapter.fs.readFile(filePath);
    await this.transformWithDependencies(filePath, fileContent);

    const tempPath = globalModuleCache.get(filePath);
    if (!tempPath) {
      throw toError(createError({
        type: "build",
        message: `Failed to transform module: ${filePath}`,
        context: { file: filePath, phase: "transform" },
      }));
    }

    const cacheBuster = Date.now();
    return await import(`file://${tempPath}?t=${cacheBuster}`);
  }

  private async transformWithDependencies(
    filePath: string,
    source?: string,
  ): Promise<void> {
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
        { adapter: this.options.adapter },
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

      const tempPath = await this.getTempPath(filePath);
      const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
      await this.fs.mkdir(tempDir, { recursive: true });
      await this.fs.writeTextFile(tempPath, transformed);

      globalModuleCache.set(cacheKey, tempPath);
      globalModuleCache.set(filePath, tempPath);
    } finally {
      globalInProgress.delete(filePath);
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

  private async getTempPath(filePath: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();

    let relativePath = filePath;
    const projectDir = this.options.projectDir.replace(/\/$/, "");
    if (filePath.startsWith(projectDir)) {
      relativePath = filePath.substring(projectDir.length);
    }

    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    return join(tmpDir, jsPath);
  }

  private async ensureTmpDir(): Promise<string> {
    const projectDir = this.options.projectDir;

    const existingDir = globalTmpDirs.get(projectDir);
    if (existingDir) {
      return existingDir;
    }

    const tmpDir = join(projectDir, "node_modules", ".cache", "veryfront-ssr");

    await this.fs.mkdir(tmpDir, { recursive: true });
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
