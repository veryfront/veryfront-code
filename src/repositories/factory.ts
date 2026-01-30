/**
 * Repository Factory
 *
 * Factory for creating repository instances with consistent configuration.
 * Provides helpers to extract RepositoryContext from handler context.
 *
 * @module repositories/factory
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "#veryfront/types";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import type { SecurityContext } from "#veryfront/security/secure-fs.ts";
import type {
  CacheRepository,
  CacheRepositoryOptions,
  FileSystemRepository,
  RepositoryContext,
} from "./types.ts";
import { createFileSystemRepository } from "./filesystem/filesystem-repository.ts";
import {
  createMemoryCacheRepository,
  createMultiTierCacheRepository,
} from "./cache/cache-repository.ts";

/**
 * Configuration for RepositoryFactory
 */
export interface RepositoryFactoryConfig {
  /** Runtime adapter for file system access */
  adapter: RuntimeAdapter;
  /** Base directory for file operations */
  baseDir: string;
  /** Repository context for key/path scoping */
  context: RepositoryContext;
}

/**
 * Repository Factory
 *
 * Creates configured repository instances with consistent context.
 *
 * @example
 * ```typescript
 * const factory = new RepositoryFactory({
 *   adapter: runtime.adapter,
 *   baseDir: "/path/to/project",
 *   context: extractRepositoryContext(handlerCtx),
 * });
 *
 * const fsRepo = factory.createFileSystemRepository("static-serving");
 * const cacheRepo = await factory.createCacheRepository(backend);
 * ```
 */
export class RepositoryFactory {
  private readonly config: RepositoryFactoryConfig;

  constructor(config: RepositoryFactoryConfig) {
    this.config = config;
  }

  /**
   * Create a filesystem repository with the given security context
   */
  createFileSystemRepository(
    securityContext?: SecurityContext,
  ): FileSystemRepository {
    return createFileSystemRepository({
      baseDir: this.config.baseDir,
      adapter: this.config.adapter,
      context: this.config.context,
      securityContext,
    });
  }

  /**
   * Create a multi-tier cache repository with the given backend
   */
  createCacheRepository(
    backend: CacheBackend,
    options?: CacheRepositoryOptions,
  ): CacheRepository<string> {
    return createMultiTierCacheRepository(
      this.config.context,
      backend,
      options,
    );
  }

  /**
   * Create an in-memory cache repository (for testing or local dev)
   */
  createMemoryCacheRepository<T = string>(
    options?: CacheRepositoryOptions,
  ): CacheRepository<T> {
    return createMemoryCacheRepository<T>(this.config.context, options);
  }

  /**
   * Get the factory's repository context
   */
  get context(): RepositoryContext {
    return this.config.context;
  }
}

/**
 * Extract RepositoryContext from HandlerContext
 *
 * Maps handler context fields to repository context:
 * - projectSlug → projectId
 * - resolvedEnvironment or requestContext.mode → environment
 * - releaseId or versionId header or "draft" → versionId
 *
 * @example
 * ```typescript
 * const ctx = extractRepositoryContext(handlerCtx);
 * // { projectId: "my-project", environment: "preview", versionId: "draft" }
 * ```
 */
export function extractRepositoryContext(
  ctx: HandlerContext,
): RepositoryContext {
  // Project ID from projectSlug or projectId
  const projectId = ctx.projectSlug ?? ctx.projectId ?? "unknown";

  // Environment from resolvedEnvironment or requestContext.mode
  let environment: "production" | "preview" = "preview";
  if (ctx.resolvedEnvironment) {
    environment = ctx.resolvedEnvironment;
  } else if (ctx.requestContext?.mode) {
    environment = ctx.requestContext.mode === "production" ? "production" : "preview";
  }

  // Version ID from releaseId (production) or enriched context contentSourceId or "draft" (preview)
  let versionId = "draft";
  if (ctx.releaseId) {
    versionId = ctx.releaseId;
  } else if (ctx.enriched?.contentSourceId) {
    versionId = ctx.enriched.contentSourceId;
  } else if (ctx.enriched?.releaseId) {
    versionId = ctx.enriched.releaseId;
  }

  return { projectId, environment, versionId };
}

/**
 * Create a RepositoryFactory from HandlerContext
 *
 * Convenience function that extracts context and creates factory in one step.
 *
 * @example
 * ```typescript
 * const factory = createRepositoryFactory(handlerCtx);
 * const fsRepo = factory.createFileSystemRepository("static-serving");
 * ```
 */
export function createRepositoryFactory(
  ctx: HandlerContext,
): RepositoryFactory {
  return new RepositoryFactory({
    adapter: ctx.adapter,
    baseDir: ctx.projectDir,
    context: extractRepositoryContext(ctx),
  });
}

/**
 * Create a RepositoryContext directly (for testing or manual configuration)
 *
 * @example
 * ```typescript
 * const context = createRepositoryContext("my-project", "preview", "v1");
 * ```
 */
export function createRepositoryContext(
  projectId: string,
  environment: "production" | "preview" = "preview",
  versionId = "draft",
): RepositoryContext {
  return { projectId, environment, versionId };
}
