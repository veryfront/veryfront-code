/**
 * SSR Module Loader Class
 *
 * Loads and transforms React components for server-side rendering.
 *
 * @module module-system/react-loader/ssr-module-loader/loader
 */

import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type * as React from "react";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { TRANSFORM_CACHE_VERSION } from "#veryfront/transforms/esm/package-registry.ts";
import { buildSSRModuleCacheKey, buildSSRModuleProjectKey } from "../../../cache/keys.ts";
import {
  type CrossProjectImport,
  type MissingImport,
  parseLocalImports,
} from "#veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { extractComponent } from "../extract-component.ts";
import {
  CIRCUIT_BREAKER_RESET_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  IN_PROGRESS_WAIT_TIMEOUT_MS,
  MAX_CONCURRENT_TRANSFORMS,
  MAX_TRANSFORM_DEPTH,
  TRANSFORM_ACQUIRE_TIMEOUT_MS,
  TRANSFORM_BATCH_SIZE,
} from "./constants.ts";
import { withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
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
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";

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
  loadModule(
    filePath: string,
    source: string,
  ): Promise<React.ComponentType<Record<string, unknown>>> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_LOAD_MODULE,
      async () => {
        const circuitKey = this.getCacheKey(filePath);
        this.checkCircuitBreaker(circuitKey, filePath);

        this.missingDependencies = [];

        try {
          await this.transformWithDependencies(filePath, source);

          if (this.missingDependencies.length > 0) {
            this.throwMissingDependencies(filePath);
          }

          const cacheKey = this.getCacheKey(filePath);
          const cacheEntry = globalModuleCache.get(cacheKey);
          if (!cacheEntry) {
            throw toError(
              createError({
                type: "build",
                message: `Failed to transform module: ${filePath}`,
                context: { file: filePath, phase: "transform" },
              }),
            );
          }

          const mod = await withSpan(
            SpanNames.SSR_DYNAMIC_IMPORT,
            () => import(`file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}`),
            { "ssr.file": fileName },
          );

          failedComponents.delete(circuitKey);
          return extractComponent(mod, filePath);
        } catch (error) {
          const existing = failedComponents.get(circuitKey);
          failedComponents.set(circuitKey, {
            count: (existing?.count ?? 0) + 1,
            lastFailure: Date.now(),
          });
          throw error;
        }
      },
      {
        "ssr.file": fileName,
        "ssr.project_id": this.options.projectId,
        "ssr.source_length": source.length,
      },
    );
  }

  private checkCircuitBreaker(circuitKey: string, filePath: string): void {
    const failureRecord = failedComponents.get(circuitKey);
    if (!failureRecord) return;

    const timeSinceFailure = Date.now() - failureRecord.lastFailure;

    if (
      failureRecord.count >= CIRCUIT_BREAKER_THRESHOLD &&
      timeSinceFailure < CIRCUIT_BREAKER_RESET_MS
    ) {
      throw toError(
        createError({
          type: "build",
          message:
            `Component ${filePath} is temporarily blocked due to repeated failures. Will retry in ${
              Math.ceil(
                (CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000,
              )
            }s.`,
          context: {
            file: filePath,
            phase: "circuit-breaker",
            failures: failureRecord.count,
          },
        }),
      );
    }

    if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
      failedComponents.delete(circuitKey);
    }
  }

  private throwMissingDependencies(filePath: string): never {
    const missingList = this.missingDependencies
      .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
      .join("\n");

    logger.error("[SSR-MODULE-LOADER] Missing dependencies detected", {
      file: filePath.slice(-60),
      missing: this.missingDependencies.length,
      details: this.missingDependencies,
    });

    throw toError(
      createError({
        type: "build",
        message: `Component has missing dependencies:\n${missingList}`,
        context: {
          file: filePath,
          phase: "dependency-resolution",
          missing: this.missingDependencies,
        },
      }),
    );
  }

  private getCacheKey(filePath: string): string {
    const sourceId = this.options.contentSourceId ?? "default";
    return buildSSRModuleCacheKey(
      TRANSFORM_CACHE_VERSION,
      this.options.projectId,
      `${sourceId}:${filePath}`,
    );
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
    if (cachedEntry) return cachedEntry.tempPath;

    const registryBaseUrl = this.getRegistryBaseUrl();
    const projectRef = `${projectSlug}@${version}`;
    const registryUrl = `${registryBaseUrl}/${projectRef}/@/${path}`;

    logger.debug("[SSR-MODULE-LOADER] Fetching cross-project import", {
      specifier,
      registryUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const headers = new Headers({
        Accept: "text/plain, application/javascript, */*",
      });
      injectContext(headers);

      const response = await fetch(registryUrl, { signal: controller.signal, headers });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${registryUrl}: ${response.status} ${response.statusText}`,
        );
      }

      const sourceCode = await response.text();
      const contentHash = await this.hashContentAsync(sourceCode);

      const ext = path.match(/\.(tsx?|jsx?|mdx)$/)?.[0] ?? ".tsx";
      const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
      const tempPath = await this.getTempPath(syntheticFilePath);
      await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });

      const useSemaphore = MAX_CONCURRENT_TRANSFORMS > 0;
      if (useSemaphore) {
        const acquired = await transformSemaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          throw new Error(
            `Transform capacity exceeded (${transformSemaphore.waiting} waiting). Service is overloaded.`,
          );
        }
      }

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

        globalCrossProjectCache.set(cacheKey, { tempPath, contentHash });

        logger.debug("[SSR-MODULE-LOADER] Cross-project import transformed", {
          specifier,
          tempPath,
        });

        return tempPath;
      } finally {
        if (useSemaphore) transformSemaphore.release();
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

  private transformWithDependencies(
    filePath: string,
    source?: string,
    depth: number = 0,
  ): Promise<void> {
    const fileName = filePath.split("/").pop() || filePath;

    return withSpan(
      SpanNames.SSR_TRANSFORM_DEPENDENCIES,
      () => this.doTransformWithDependencies(filePath, source, depth),
      {
        "ssr.file": fileName,
        "ssr.depth": depth,
      },
    );
  }

  private async doTransformWithDependencies(
    filePath: string,
    source?: string,
    depth: number = 0,
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) {
      logger.warn("[SSR-MODULE-LOADER] Max transform depth exceeded", {
        file: filePath.slice(-40),
        depth,
        maxDepth: MAX_TRANSFORM_DEPTH,
      });
      throw toError(
        createError({
          type: "build",
          message:
            `Max transform depth exceeded (${MAX_TRANSFORM_DEPTH}, depth=${depth}) for ${filePath}. Check for circular dependencies.`,
          context: { file: filePath, phase: "transform" },
        }),
      );
    }

    const code = source ?? (await this.options.adapter.fs.readFile(filePath));

    const contentHash = await this.hashContentAsync(code);
    const contentCacheKey = this.getCacheKey(`${filePath}:${contentHash}`);
    const filePathCacheKey = this.getCacheKey(filePath);
    const inProgressKey = filePathCacheKey;

    const cachedEntry = globalModuleCache.get(contentCacheKey);
    if (cachedEntry) {
      globalModuleCache.set(filePathCacheKey, cachedEntry);
      await this.ensureDependenciesExist(code, filePath, depth);
      return;
    }

    const redisEnabled = getRedisEnabled();
    const redisClient = getRedisClientInstance();
    if (redisEnabled && redisClient) {
      const redisCode = await getFromRedis(contentCacheKey);
      if (redisCode) {
        const tempPath = await this.getTempPath(filePath);
        await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });
        await this.fs.writeTextFile(tempPath, redisCode);

        const entry: ModuleCacheEntry = { tempPath, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);

        logger.debug("[SSR-MODULE-LOADER] Redis cache hit", { file: filePath.slice(-40) });

        await this.ensureDependenciesExist(code, filePath, depth);
        return;
      }
    }

    const existingTransform = globalInProgress.get(inProgressKey);
    if (existingTransform) {
      try {
        await withSpan(
          SpanNames.SSR_WAIT_IN_PROGRESS,
          () =>
            withTimeoutThrow(
              existingTransform,
              IN_PROGRESS_WAIT_TIMEOUT_MS,
              `Waiting for in-progress transform of ${filePath}`,
            ),
          { "ssr.file": filePath.split("/").pop() || filePath },
        );
        return;
      } catch (error) {
        globalInProgress.delete(inProgressKey);
        logger.warn("[SSR-MODULE-LOADER] In-progress transform timed out, retrying", {
          file: filePath.slice(-40),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let resolveTransform!: () => void;
    let rejectTransform!: (err: Error) => void;
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

      await this.processLocalImports(parseResult.imports, filePath, depth, localFs);

      for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
        const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
        await Promise.all(
          batch.map(async (crossImport) => {
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
        );
      }

      const useSemaphore = MAX_CONCURRENT_TRANSFORMS > 0;
      if (useSemaphore) {
        const acquired = await transformSemaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          throw toError(
            createError({
              type: "build",
              message:
                `Transform capacity exceeded (${transformSemaphore.waiting} waiting). Service is overloaded.`,
              context: { file: filePath, phase: "transform" },
            }),
          );
        }
      }

      try {
        const transformOpts: TransformOptions = {
          projectId: this.options.projectId,
          dev: this.options.dev,
          ssr: true,
          apiBaseUrl: this.options.apiBaseUrl,
        };

        let transformed = await withSpan(
          SpanNames.SSR_TRANSFORM_SINGLE,
          () =>
            transformToESM(
              code,
              filePath,
              this.options.projectDir,
              this.options.adapter,
              transformOpts,
            ),
          { "ssr.file": filePath.split("/").pop() || filePath },
        );

        for (const [specifier, tempPath] of crossProjectPaths.entries()) {
          transformed = this.rewriteCrossProjectImport(transformed, specifier, tempPath);
        }

        const tempPath = await this.getTempPath(filePath);
        await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });
        await this.fs.writeTextFile(tempPath, transformed);

        if (redisEnabled && redisClient) {
          setInRedis(contentCacheKey, transformed).catch(() => {});
        }

        const entry: ModuleCacheEntry = { tempPath, contentHash };
        globalModuleCache.set(contentCacheKey, entry);
        globalModuleCache.set(filePathCacheKey, entry);
      } finally {
        if (useSemaphore) transformSemaphore.release();
      }

      resolveTransform();
    } catch (error) {
      rejectTransform(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      globalInProgress.delete(inProgressKey);
    }
  }

  private async processLocalImports(
    imports: Array<{ absolutePath: string; specifier: string }>,
    fromFilePath: string,
    depth: number,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<void> {
    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (imp) => {
          try {
            const depSource = imp.absolutePath.startsWith("/")
              ? await localFs.readTextFile(imp.absolutePath)
              : await this.options.adapter.fs.readFile(imp.absolutePath);

            await this.transformWithDependencies(imp.absolutePath, depSource, depth + 1);
          } catch (error) {
            this.missingDependencies.push({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: `Failed to read file: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
    }
  }

  private rewriteCrossProjectImport(
    transformed: string,
    specifier: string,
    tempPath: string,
  ): string {
    const jsSpecifier = specifier.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedJsSpecifier = jsSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`from\\s+["'](${escapedSpecifier}|${escapedJsSpecifier})["']`, "g");
    return transformed.replace(pattern, `from "file://${tempPath}"`);
  }

  private async ensureDependenciesExist(
    code: string,
    filePath: string,
    depth: number = 0,
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) return;

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
    await this.processLocalImports(parseResult.imports, filePath, depth, localFs);

    for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (crossImport) => {
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
      );
    }
  }

  /**
   * Fast sync hash for small strings (project IDs, etc.)
   * Use hashContentAsync for large file content.
   */
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Async hash for large content using Web Crypto API.
   * Doesn't block event loop for large files.
   */
  private async hashContentAsync(content: string): Promise<string> {
    if (content.length < 10000) return this.hashCode(content);

    try {
      const data = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray
        .slice(0, 8)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return this.hashCode(content);
    }
  }

  private async getTempPath(filePath: string, _contentHash?: string): Promise<string> {
    const tmpDir = await this.ensureTmpDir();

    const projectDir = this.options.projectDir.replace(/\/$/, "");
    const relativePath = filePath.startsWith(projectDir)
      ? filePath.substring(projectDir.length)
      : filePath;

    const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    return join(tmpDir, jsPath);
  }

  private async ensureTmpDir(): Promise<string> {
    let projectDir = this.options.projectDir;
    const { projectId, contentSourceId } = this.options;

    if (!projectDir.startsWith("/")) {
      projectDir = join(cwd(), projectDir);
    }

    const cacheBaseDir = getCacheBaseDir();
    const baseDir = isAbsolute(cacheBaseDir) ? cacheBaseDir : join(cwd(), cacheBaseDir);

    const cacheKey = `${baseDir}|${buildSSRModuleProjectKey(projectDir, projectId)}|${
      contentSourceId ?? "default"
    }`;

    const existingDir = globalTmpDirs.get(cacheKey);
    if (existingDir) return existingDir;

    const projectKey = projectId ? this.hashCode(projectId) : "default";
    const sourceKey = contentSourceId ? this.hashCode(contentSourceId) : "default";
    const tmpDir = join(baseDir, "veryfront-ssr", projectKey, sourceKey);

    await this.fs.mkdir(tmpDir, { recursive: true });
    globalTmpDirs.set(cacheKey, tmpDir);
    return tmpDir;
  }
}
