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

export interface RepositoryFactoryConfig {
  adapter: RuntimeAdapter;
  baseDir: string;
  context: RepositoryContext;
}

export class RepositoryFactory {
  constructor(private readonly config: RepositoryFactoryConfig) {}

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
  const projectId = ctx.projectSlug ?? ctx.projectId ?? "unknown";

  let environment: "production" | "preview" = "preview";
  if (ctx.resolvedEnvironment) {
    environment = ctx.resolvedEnvironment;
  } else if (ctx.requestContext?.mode === "production") {
    environment = "production";
  }

  const versionId = ctx.releaseId ??
    ctx.enriched?.contentSourceId ??
    ctx.enriched?.releaseId ??
    "draft";

  return { projectId, environment, versionId };
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
  environment: "production" | "preview" = "preview",
  versionId = "draft",
): RepositoryContext {
  return { projectId, environment, versionId };
}
