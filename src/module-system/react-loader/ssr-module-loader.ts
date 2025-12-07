import { join } from "std/path/mod.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/transform-core.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { parseLocalImports } from "@veryfront/transforms/esm/import-parser.ts";
import { isNodeRuntime } from "../../platform/compat/runtime.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export interface SSRModuleLoaderOptions {
  projectDir: string;
  projectId: string;
  adapter: RuntimeAdapter;
  dev: boolean;
}

export class SSRModuleLoader {
  private loadedModules = new Map<string, string>();
  private inProgress = new Set<string>();
  private tmpDir: string | null = null;
  private fs = createFileSystem();

  constructor(private options: SSRModuleLoaderOptions) {}

  async loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    await this.transformWithDependencies(filePath, source);

    const tempPath = this.loadedModules.get(filePath);
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
    if (this.loadedModules.has(filePath)) {
      return;
    }

    if (this.inProgress.has(filePath)) {
      return;
    }

    this.inProgress.add(filePath);

    try {
      const code = source ?? await this.fs.readTextFile(filePath);

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

      const tempPath = await this.getTempPath(filePath);
      const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
      await this.fs.mkdir(tempDir, { recursive: true });
      await this.fs.writeTextFile(tempPath, transformed);

      this.loadedModules.set(filePath, tempPath);
    } finally {
      this.inProgress.delete(filePath);
    }
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
    if (this.tmpDir) {
      return this.tmpDir;
    }

    const isNode = isNodeRuntime();

    if (isNode) {
      this.tmpDir = join(
        this.options.projectDir,
        "node_modules",
        ".cache",
        "veryfront-ssr",
      );
    } else {
      const os = await import("node:os");
      const tmpBase = os.tmpdir();
      const tmpName = `vf-ssr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      this.tmpDir = join(tmpBase, tmpName);
    }

    await this.fs.mkdir(this.tmpDir, { recursive: true });
    return this.tmpDir;
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
