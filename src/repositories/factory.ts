/**************************
 * Repository Factory
 *
 * Factory for creating repository instances with consistent configuration.
 * Provides helpers to extract RepositoryContext from handler context.
 *
 * @module repositories/factory
 **************************/

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "#veryfront/types";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
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
import { snapshotRepositoryContext } from "./context.ts";
import { DEFAULT_REPOSITORY_ENVIRONMENT, DEFAULT_REPOSITORY_VERSION_ID } from "./limits.ts";

export interface RepositoryFactoryConfig {
  adapter: RuntimeAdapter;
  baseDir: string;
  context: RepositoryContext;
}

export class RepositoryFactory {
  private readonly config: RepositoryFactoryConfig;

  constructor(config: RepositoryFactoryConfig) {
    this.config = Object.freeze({
      adapter: config.adapter,
      baseDir: config.baseDir,
      context: snapshotRepositoryContext(config.context),
    });
  }

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

  createCacheRepository(
    backend: CacheBackend,
    options?: CacheRepositoryOptions,
  ): CacheRepository<string> {
    return createMultiTierCacheRepository(this.config.context, backend, options);
  }

  createMemoryCacheRepository<T = string>(
    options?: CacheRepositoryOptions,
  ): CacheRepository<T> {
    return createMemoryCacheRepository<T>(this.config.context, options);
  }

  get context(): RepositoryContext {
    return this.config.context;
  }
}

export function extractRepositoryContext(ctx: HandlerContext): RepositoryContext {
  const projectId = ctx.enriched?.projectId ?? ctx.projectId ?? ctx.projectSlug ??
    ctx.requestContext?.slug;
  const environment = ctx.enriched?.environment ?? ctx.resolvedEnvironment ??
    (ctx.requestContext?.mode === "production" ? "production" : "preview");
  const versionId = ctx.enriched?.contentSourceId ?? computeContentSourceId(
    ctx.enriched?.isLocalProject ?? ctx.isLocalProject ?? false,
    environment,
    ctx.enriched?.branch ?? ctx.requestContext?.branch,
    ctx.enriched?.releaseId ?? ctx.releaseId,
  );

  return snapshotRepositoryContext({ projectId, environment, versionId });
}

export function createRepositoryFactory(ctx: HandlerContext): RepositoryFactory {
  return new RepositoryFactory({
    adapter: ctx.adapter,
    baseDir: ctx.projectDir,
    context: extractRepositoryContext(ctx),
  });
}

export function createRepositoryContext(
  projectId: string,
  environment: "production" | "preview" = DEFAULT_REPOSITORY_ENVIRONMENT,
  versionId = DEFAULT_REPOSITORY_VERSION_ID,
): RepositoryContext {
  return snapshotRepositoryContext({ projectId, environment, versionId });
}
