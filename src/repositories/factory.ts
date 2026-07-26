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
import { INVALID_ARGUMENT } from "#veryfront/errors";
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

export interface RepositoryFactoryConfig {
  adapter: RuntimeAdapter;
  baseDir: string;
  context: RepositoryContext;
}

export class RepositoryFactory {
  private readonly adapter: RuntimeAdapter;
  private readonly baseDir: string;
  readonly context: RepositoryContext;

  constructor(config: RepositoryFactoryConfig) {
    this.adapter = config.adapter;
    this.baseDir = config.baseDir;
    this.context = snapshotRepositoryContext(config.context);
  }

  createFileSystemRepository(
    securityContext: SecurityContext,
  ): FileSystemRepository {
    return createFileSystemRepository({
      baseDir: this.baseDir,
      adapter: this.adapter,
      context: this.context,
      securityContext,
    });
  }

  createCacheRepository(
    backend: CacheBackend,
    options?: CacheRepositoryOptions,
  ): CacheRepository<string> {
    return createMultiTierCacheRepository(this.context, backend, options);
  }

  createMemoryCacheRepository<T = string>(
    options?: CacheRepositoryOptions,
  ): CacheRepository<T> {
    return createMemoryCacheRepository<T>(this.context, options);
  }
}

export function extractRepositoryContext(ctx: HandlerContext): RepositoryContext {
  if (ctx.enriched) {
    return createRepositoryContext(
      ctx.enriched.projectId,
      ctx.enriched.environment,
      ctx.enriched.contentSourceId,
    );
  }

  const projectId = ctx.projectId ?? ctx.projectSlug;
  if (!projectId) {
    throw INVALID_ARGUMENT.create({
      detail: "Repository context requires projectId or projectSlug",
    });
  }

  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
  if (environment !== "preview" && environment !== "production") {
    throw INVALID_ARGUMENT.create({
      detail: "Repository context requires an explicit preview or production environment",
    });
  }
  const versionId = computeContentSourceId(
    ctx.isLocalProject === true,
    environment,
    ctx.requestContext?.branch,
    ctx.releaseId,
  );

  return createRepositoryContext(projectId, environment, versionId);
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
  environment: "production" | "preview",
  versionId: string,
): RepositoryContext {
  return snapshotRepositoryContext({ projectId, environment, versionId });
}
