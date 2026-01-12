/**
 * SSR Module Loader Class
 *
 * Loads and transforms React components for server-side rendering.
 *
 * @module module-system/react-loader/ssr-module-loader/loader
 */

import { join } from "@veryfront/platform/compat/path/index.ts";
import type * as React from "react";
import { transformToESM } from "@veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import {
  type CrossProjectImport,
  type MissingImport,
  parseLocalImports,
} from "@veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { getApiBaseUrlEnv } from "@veryfront/core/config/env.ts";
import { extractComponent } from "../extract-component.ts";
import { CIRCUIT_BREAKER_RESET_MS, CIRCUIT_BREAKER_THRESHOLD } from "./constants.ts";
import {
  failedComponents,
  getFromRedis,
  getRedisClientInstance,
  getRedisEnabled,
  globalCrossProjectCache,
  globalInProgress,
  globalModuleCache,
  globalTmpDirs,
  setInRedis,
  transformSemaphore,
} from "./cache/index.ts";
import type { ModuleCacheEntry, SSRModuleLoaderOptions } from "./types.ts";

/**
 * SSR Module Loader with Redis Support.
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 */
export class SSRModuleLoader {
  private fs = createFileSystem();
  private missingDependencies: MissingImport[] = [];

  constructor(private options: SSRModuleLoaderOptions) {}

  /**
   * Load and transform a module for SSR.
   */
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
      const cacheEntry = globalModuleCache.get(cacheKey);
      if (!cacheEntry) {
        throw toError(createError({
          type: "build",
          message: `Failed to transform module: ${filePath}`,
          context: { file: filePath, phase: "transform" },
        }));
      }

      const mod = await import(`file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}`);

      // Success - reset failure count
      failedComponents.delete(circuitKey);

      return extractComponent(mod, filePath);
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

  private getCacheKey(filePath: string): string {
    return filePath;
  }

  private getRegistryBaseUrl(): string {
    const apiBaseUrl = this.options.apiBaseUrl || getApiBaseUrlEnv();
    return apiBaseUrl.replace(/\/api\/?$/, "");
  }

  /**
   * Fetch and transform a cross-project import.
   */
  private async transformCrossProjectImport(
    crossProjectImport: CrossProjectImport,
  ): Promise<string> {
    const { specifier, projectSlug, version, path } = crossProjectImport;
    const cacheKey = specifier;

    const cachedEntry = globalCrossProjectCache.get(cacheKey);
    if (cachedEntry) {
      return cachedEntry.tempPath;
    }

    const registryBaseUrl = this.getRegistryBaseUrl();
    const projectRef = `${projectSlug}@${version}`;
    const registryUrl = `${registryBaseUrl}/${projectRef}/@/${path}`;

    logger.info("[SSR-MODULE-LOADER] Fetching cross-project import", {
      specifier,
      registryUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(registryUrl, {
        signal: controller.signal,
        headers: { Accept: "text/plain, application/javascript, */*" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${registryUrl}: ${response.status} ${response.statusText}`,
        );
      }

      const sourceCode = await response.text();
      const contentHash = this.hashCode(sourceCode);

      const extMatch = path.match(/\.(tsx?|jsx?|mdx)$/);
      const ext = extMatch?.[0] ?? ".tsx";

      const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
      const tempPath = await this.getTempPath(syntheticFilePath);
      const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
      await this.fs.mkdir(tempDir, { recursive: true });

      await transformSemaphore.acquire();
      try {
        const transformOpts: TransformOptions = {
          projectId: this.options.projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
        };

        const filePathWithExt = syntheticFilePath.endsWith(ext)
          ? syntheticFilePath
          : syntheticFilePath + ext;

        const transformed = await transformToESM(
          sourceCode,
          filePathWithExt,
          this.options.projectDir,
          this.options.adapter,
          transformOpts,
        );

        await this.fs.writeTextFile(tempPath, transformed);

        const entry: ModuleCacheEntry = { tempPath, contentHash };
        globalCrossProjectCache.set(cacheKey, entry);

        logger.info("[SSR-MODULE-LOADER] Cross-project import transformed", {
          specifier,
          tempPath,
        });

        return tempPath;
      } finally {
        transformSemaphore.release();
      }
    } catch (error) {
      clearTimeout(timeout);
      logger.error("[SSR-MODULE-LOADER] Failed to fetch cross-project import", {
        specifier,
        registryUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async transformWithDependencies(
    filePath: string,
    source?: string,
  ): Promise<void> {
    const code = source ?? await this.options.adapter.fs.readFile(filePath);

    const contentHash = this.hashCode(code);
    const contentCacheKey = this.getCacheKey(`${filePath}:${contentHash}`);
    const filePathCacheKey = this.getCacheKey(filePath);
    const inProgressKey = this.getCacheKey(filePath);

    // Check memory cache first
    const cachedEntry = globalModuleCache.get(contentCacheKey);
    if (cachedEntry) {
      globalModuleCache.set(filePathCacheKey, cachedEntry);
      await this.ensureDependenciesExist(code, filePath);
      return;
    }

    // Check Redis cache
    const redisEnabled = getRedisEnabled();
    const redisClient = getRedisClientInstance();
    if (redisEnabled && redisClient) {
      const redisCode = await getFromRedis(contentCacheKey);
      if (redisCode) {
        const tempPath = await this.getTempPath(filePath);
        const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
        await this.fs.mkdir(tempDir, { recursive: true });
        await this.fs.writeTextFile(tempPath, redisCode);

        const entry: ModuleCacheEntry = { tempPath, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);
        logger.debug("[SSR-MODULE-LOADER] Redis cache hit", { file: filePath.slice(-40) });
        await this.ensureDependenciesExist(code, filePath);
        return;
      }
    }

    // Wait for in-progress transform
    const existingTransform = globalInProgress.get(inProgressKey);
    if (existingTransform) {
      await existingTransform;
      return;
    }

    // Create completion promise
    let resolveTransform: () => void;
    let rejectTransform: (err: Error) => void;
    const transformPromise = new Promise<void>((resolve, reject) => {
      resolveTransform = resolve;
      rejectTransform = reject;
    });
    globalInProgress.set(inProgressKey, transformPromise);

    try {
      const parseResult = await parseLocalImports(
        code,
        filePath,
        this.options.projectDir,
        this.options.adapter,
      );

      if (parseResult.missing.length > 0) {
        this.missingDependencies.push(...parseResult.missing);
      }

      const crossProjectPaths = new Map<string, string>();
      const localFs = createFileSystem();

      await Promise.all([
        ...parseResult.imports.map(async (imp) => {
          try {
            let depSource: string;
            if (imp.absolutePath.startsWith("/")) {
              depSource = await localFs.readTextFile(imp.absolutePath);
            } else {
              depSource = await this.options.adapter.fs.readFile(imp.absolutePath);
            }
            await this.transformWithDependencies(imp.absolutePath, depSource);
          } catch (error) {
            this.missingDependencies.push({
              specifier: imp.specifier,
              fromFile: filePath,
              reason: `Failed to read file: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
        ...parseResult.crossProjectImports.map(async (crossImport) => {
          try {
            const tempPath = await this.transformCrossProjectImport(crossImport);
            crossProjectPaths.set(crossImport.specifier, tempPath);
          } catch (error) {
            this.missingDependencies.push({
              specifier: crossImport.specifier,
              fromFile: filePath,
              reason: `Failed to fetch cross-project import: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      ]);

      await transformSemaphore.acquire();

      try {
        const transformOpts: TransformOptions = {
          projectId: this.options.projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
        };

        let transformed = await transformToESM(
          code,
          filePath,
          this.options.projectDir,
          this.options.adapter,
          transformOpts,
        );

        // Rewrite cross-project imports to file:// paths
        for (const [specifier, tempPath] of crossProjectPaths.entries()) {
          const jsSpecifier = specifier.replace(/\.(tsx?|jsx|mdx)$/, ".js");
          const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedJsSpecifier = jsSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

          const pattern = new RegExp(
            `from\\s+["'](${escapedSpecifier}|${escapedJsSpecifier})["']`,
            "g",
          );
          transformed = transformed.replace(pattern, `from "file://${tempPath}"`);
        }

        const tempPath = await this.getTempPath(filePath);
        const tempDir = tempPath.substring(0, tempPath.lastIndexOf("/"));
        await this.fs.mkdir(tempDir, { recursive: true });
        await this.fs.writeTextFile(tempPath, transformed);

        if (redisEnabled && redisClient) {
          setInRedis(contentCacheKey, transformed).catch(() => {});
        }

        const entry: ModuleCacheEntry = { tempPath, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);
      } finally {
        transformSemaphore.release();
      }

      resolveTransform!();
    } catch (err) {
      rejectTransform!(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      globalInProgress.delete(inProgressKey);
    }
  }

  private async ensureDependenciesExist(
    code: string,
    filePath: string,
  ): Promise<void> {
    const parseResult = await parseLocalImports(
      code,
      filePath,
      this.options.projectDir,
      this.options.adapter,
    );

    if (parseResult.missing.length > 0) {
      this.missingDependencies.push(...parseResult.missing);
    }

    const localFs = createFileSystem();

    await Promise.all([
      ...parseResult.imports.map(async (imp) => {
        try {
          let depSource: string;
          if (imp.absolutePath.startsWith("/")) {
            depSource = await localFs.readTextFile(imp.absolutePath);
          } else {
            depSource = await this.options.adapter.fs.readFile(imp.absolutePath);
          }
          await this.transformWithDependencies(imp.absolutePath, depSource);
        } catch (error) {
          this.missingDependencies.push({
            specifier: imp.specifier,
            fromFile: filePath,
            reason: `Failed to read file: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }),
      ...parseResult.crossProjectImports.map(async (crossImport) => {
        try {
          await this.transformCrossProjectImport(crossImport);
        } catch (error) {
          this.missingDependencies.push({
            specifier: crossImport.specifier,
            fromFile: filePath,
            reason: `Failed to fetch cross-project import: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }),
    ]);
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

    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    return join(tmpDir, jsPath);
  }

  private async ensureTmpDir(): Promise<string> {
    const projectDir = this.options.projectDir;
    const projectId = this.options.projectId;

    const cacheKey = `${projectDir}:${projectId}`;

    const existingDir = globalTmpDirs.get(cacheKey);
    if (existingDir) {
      return existingDir;
    }

    const tmpDir = join(
      projectDir,
      ".cache",
      "veryfront-ssr",
      projectId || "default",
    );

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }
}
