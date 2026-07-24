import { serverLogger } from "#veryfront/utils";
import {
  clearMdxEsmCacheNamespace,
  clearMdxEsmCacheNamespacesForProject,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { clearModuleCacheForProject } from "#veryfront/cache/module-cache.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { cacheRegistry } from "#veryfront/cache";
import { clearRendererCacheForProject } from "#veryfront/rendering/renderer.ts";
import { clearRouterDetectionCacheForProject } from "#veryfront/rendering/router-detection.ts";
import { clearSnippetCacheForProject } from "#veryfront/rendering/snippet-renderer.ts";
import { resetApiHandlerForProject } from "#veryfront/server/handlers/request/api/pages-api-handler.ts";
import { clearSourceMissCacheForProject } from "#veryfront/modules/server/module-source-resolution-cache.ts";
import { invalidateProjectMiddlewareCache } from "#veryfront/server/runtime-handler/project-middleware.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const logger = serverLogger.component("cache-invalidation");

interface InvalidationOptions {
  /** Environment scope: only invalidate caches for this environment */
  environment?: "production" | "preview";
  /** Branch ID for preview mode scoping */
  branchId?: string | null;
  /** Project ID for registry-based invalidation */
  projectId?: string;
  /** Project directory for scoped local source-resolution invalidation. */
  projectDir?: string;
  /** Exact render/module content source identity (for example preview-main). */
  contentSourceId?: string;
  /** Release ID used to derive a production content source when needed. */
  releaseId?: string | null;
}

export class ProjectCacheInvalidationError extends AggregateError {
  constructor(
    readonly projectIdentity: { projectId?: string; projectSlug?: string },
    errors: unknown[],
  ) {
    super(
      errors,
      `One or more cache invalidation phases failed for ${
        projectIdentity.projectId ?? projectIdentity.projectSlug ?? "unknown project"
      }`,
    );
    this.name = "ProjectCacheInvalidationError";
  }
}

/**
 * Invalidate caches owned by one project. Environment/content-source-aware
 * registries are narrowed when that identity is available. Caches whose schema
 * contains only project identity are necessarily evicted project-wide; no
 * operation may fall back to a process-global wipe.
 */
export async function invalidateProjectCaches(
  projectSlug: string,
  changedPaths?: string[],
  options?: InvalidationOptions,
): Promise<void> {
  const startTime = Date.now();
  const projectId = options?.projectId?.trim() || undefined;
  const normalizedSlug = projectSlug.trim();
  const realProjectSlug = normalizedSlug && normalizedSlug !== "preview"
    ? normalizedSlug
    : undefined;
  if (!projectId && !realProjectSlug) {
    throw INVALID_ARGUMENT.create({
      detail: "Cache invalidation requires a non-placeholder project ID or slug",
    });
  }

  const scopedProjectSlug = realProjectSlug ?? projectId!;
  const environment = options?.environment;
  const branchId = options?.branchId?.trim() || undefined;
  const releaseId = options?.releaseId?.trim() || undefined;
  const contentSourceId = options?.contentSourceId?.trim() ||
    (environment === "production" && releaseId
      ? `release-${releaseId}`
      : environment === "preview" && branchId
      ? `preview-${branchId}`
      : undefined);
  if (projectId && environment && !contentSourceId) {
    throw INVALID_ARGUMENT.create({
      detail: `Cache invalidation for ${environment} requires an exact contentSourceId`,
    });
  }
  const failures: unknown[] = [];

  const runPhase = async (
    phase: string,
    operation: () => unknown | Promise<unknown>,
  ): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push(new Error(`Cache invalidation phase failed: ${phase}`, { cause: error }));
      logger.error("Cache invalidation phase failed", {
        phase,
        projectId,
        projectSlug: realProjectSlug,
        error,
      });
    }
  };

  logger.debug("▶ Starting cache invalidation", {
    projectSlug: realProjectSlug,
    projectId,
    environment: environment ?? "all",
    changedPaths: changedPaths?.length ?? "all",
    contentSourceId,
  });

  if (projectId && contentSourceId) {
    await runPhase("MDX ESM namespace", async () => {
      await clearMdxEsmCacheNamespace(projectId, contentSourceId);
    });
  } else if (projectId && environment === undefined) {
    await runPhase("all MDX ESM namespaces", async () => {
      await clearMdxEsmCacheNamespacesForProject(projectId);
    });
  }
  await runPhase("module source misses", () => {
    clearSourceMissCacheForProject({
      projectDir: options?.projectDir,
      projectId,
      projectSlug: realProjectSlug,
    });
  });
  await runPhase("project middleware", () => {
    invalidateProjectMiddlewareCache(scopedProjectSlug, projectId);
  });

  if (projectId) {
    await runPhase("SSR module cache", () => clearSSRModuleCacheForProject(projectId));
    await runPhase("render-pipeline module cache", () => clearModuleCacheForProject(projectId));
    await runPhase("router detection cache", () => clearRouterDetectionCacheForProject(projectId));
  }

  await runPhase(
    "renderer cache",
    () => clearRendererCacheForProject(projectId ?? scopedProjectSlug),
  );
  await runPhase("snippet cache", () => clearSnippetCacheForProject(scopedProjectSlug));
  await runPhase("API route handler cache", () => resetApiHandlerForProject(scopedProjectSlug));

  if (projectId) {
    if (environment) {
      await runPhase("registry environment cache", () => {
        cacheRegistry.deleteKeysForProjectEnvironment(projectId, environment);
      });
    } else {
      await runPhase("all local registry project caches", () => {
        cacheRegistry.deleteKeysForProject(projectId);
      });
    }

    if (contentSourceId) {
      await runPhase("registry content-source cache", () => {
        cacheRegistry.deleteKeysForContentSource(projectId, contentSourceId);
      });
    }
  }

  const redisProjectIdentity = {
    projectId,
    projectSlug: realProjectSlug,
  };
  await runPhase("distributed registry cache", async () => {
    if (environment) {
      await cacheRegistry.deleteRedisKeysForProjectEnvironment(
        redisProjectIdentity,
        environment,
      );
    } else {
      await cacheRegistry.deleteRedisKeysForProject(redisProjectIdentity);
    }
  });

  if (failures.length > 0) {
    throw new ProjectCacheInvalidationError(redisProjectIdentity, failures);
  }

  logger.debug("✓ Per-project cache invalidation complete", {
    projectSlug: realProjectSlug,
    projectId,
    durationMs: Date.now() - startTime,
  });
}
