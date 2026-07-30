import { rendererLogger } from "#veryfront/utils/logger/index.ts";
import { tryResolve as tryResolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedCacheAdministration,
  captureDistributedRuntimeProvider,
  type DistributedCacheAdministration,
  type DistributedCacheListOptions,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  type DistributedCacheEnvironment,
  type DistributedCacheNamespaceDescriptor,
  type DistributedCacheProjectIdentity,
  getOwnedDistributedCacheNamespaceDescriptors,
  stripOwnedDistributedCacheKeyPrefix,
  validateDistributedCacheProjectIdentity,
} from "./backends/distributed-keyspace.ts";
import { encodeCacheSourceIdentity } from "./keys/source-identity.ts";
import { decodeCacheKeyPercentSegment } from "./keys/segment-codec.ts";
import {
  type CacheStoreProjectOwnership,
  getSharedLocalCacheRegistryState,
  LocalCacheRegistry,
  type LocalCacheRegistryState,
} from "./local-registry.ts";

export {
  type CacheStatsSource,
  type CacheStore,
  type CacheStoreProjectOwnership,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
} from "./local-registry.ts";

const logger = rendererLogger.component("cache-registry");

const DEFAULT_DISTRIBUTED_LIST_LIMIT = 1_000;
const MAX_DISTRIBUTED_SCANNED_KEYS = 100_000;

function matchesDistributedProjectIdentity(
  descriptor: DistributedCacheNamespaceDescriptor,
  descriptors: readonly DistributedCacheNamespaceDescriptor[],
  key: string,
  identity: DistributedCacheProjectIdentity,
  environment?: DistributedCacheEnvironment,
): boolean {
  if (!descriptor.matchProjectOwnership || !key.startsWith(descriptor.prefix)) return false;

  // A key belongs to the longest registered namespace. Without this guard, an
  // opaque custom namespace nested below a built-in one (for example
  // `vf:cache:render:private:`) could be reinterpreted using the parent schema
  // and deleted as project data. Descriptors are sorted longest-first.
  if (descriptors.find((candidate) => key.startsWith(candidate.prefix)) !== descriptor) {
    return false;
  }

  const ownership = descriptor.matchProjectOwnership(key.slice(descriptor.prefix.length));
  if (!ownership) return false;

  const projectMatches =
    (identity.projectId !== undefined && ownership.projectId === identity.projectId) ||
    (identity.projectSlug !== undefined && ownership.projectSlug === identity.projectSlug);
  if (!projectMatches) return false;
  return environment === undefined || ownership.environment === environment;
}

function distributedProjectSpanAttributes(
  identity: DistributedCacheProjectIdentity,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (identity.projectId !== undefined) attributes["cache.project_id"] = identity.projectId;
  if (identity.projectSlug !== undefined) attributes["cache.project_slug"] = identity.projectSlug;
  return attributes;
}

function normalizeDistributedProjectIdentity(
  identity: DistributedCacheProjectIdentity,
): DistributedCacheProjectIdentity {
  return validateDistributedCacheProjectIdentity(identity);
}

export interface CacheRegistryDistributedProvider extends DistributedCacheAdministration {}

function resolveDistributedCacheAdministration(): Readonly<DistributedCacheAdministration> {
  const registered = tryResolveExtensionContract<DistributedRuntimeProvider>(
    DistributedRuntimeProviderName,
  );
  if (registered === undefined) {
    throw new Error(`Missing extension for contract "${DistributedRuntimeProviderName}"`);
  }
  return captureDistributedCacheAdministration(
    captureDistributedRuntimeProvider(registered).getCacheAdministration(),
  );
}

const defaultDistributedProvider: CacheRegistryDistributedProvider = {
  isConfigured() {
    const registered = tryResolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    );
    if (registered === undefined) return false;
    const provider = captureDistributedRuntimeProvider(registered);
    return captureDistributedCacheAdministration(
      provider.getCacheAdministration(),
    ).isConfigured();
  },
  listKeys(options: DistributedCacheListOptions) {
    return resolveDistributedCacheAdministration().listKeys(options);
  },
  deleteKeys(keys: readonly string[]) {
    return resolveDistributedCacheAdministration().deleteKeys(keys);
  },
};

export class CacheRegistry extends LocalCacheRegistry {
  constructor(
    private readonly distributedProvider: CacheRegistryDistributedProvider =
      defaultDistributedProvider,
    localState?: LocalCacheRegistryState,
  ) {
    super(localState);
  }

  listDistributedKeys(
    prefix: string,
    limit = DEFAULT_DISTRIBUTED_LIST_LIMIT,
    predicate: (key: string) => boolean = () => true,
  ): Promise<string[]> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      return Promise.reject(
        new RangeError("Distributed cache list limit must be a non-negative integer"),
      );
    }
    if (limit === 0 || !this.distributedProvider.isConfigured()) return Promise.resolve([]);

    return withSpan(
      SpanNames.CACHE_REGISTRY_LIST_DISTRIBUTED_KEYS,
      async (span?: Span) => {
        const listing = await this.distributedProvider.listKeys({
          prefix,
          limit: MAX_DISTRIBUTED_SCANNED_KEYS,
        });
        if (listing.truncated) {
          throw new RangeError("Distributed cache listing exceeded the key traversal limit");
        }
        const keys = new Set<string>();
        for (const key of listing.keys) {
          if (predicate(key)) keys.add(key);
          if (keys.size === limit) break;
        }
        span?.setAttribute("cache.distributed.keys_found", keys.size);
        return [...keys];
      },
      { "cache.distributed.prefix_length": prefix.length, "cache.distributed.limit": limit },
    );
  }

  async getDistributedKeysForProject(
    projectIdentity: DistributedCacheProjectIdentity,
  ): Promise<Map<string, string[]>> {
    const identity = normalizeDistributedProjectIdentity(projectIdentity);
    return await withSpan(
      SpanNames.CACHE_REGISTRY_GET_DISTRIBUTED_KEYS,
      async (span?: Span) => {
        const result = new Map<string, string[]>();
        const descriptors = getOwnedDistributedCacheNamespaceDescriptors();

        let totalKeys = 0;
        const listedKeys = new Set<string>();
        for (const descriptor of descriptors) {
          if (!descriptor.matchProjectOwnership) continue;
          const keys = await this.listDistributedKeys(
            descriptor.prefix,
            DEFAULT_DISTRIBUTED_LIST_LIMIT,
            (key) => {
              if (
                listedKeys.has(key) ||
                !matchesDistributedProjectIdentity(descriptor, descriptors, key, identity)
              ) return false;
              listedKeys.add(key);
              return true;
            },
          );
          if (!keys.length) continue;

          result.set(descriptor.prefix.slice(0, -1), keys);
          totalKeys += keys.length;
        }

        span?.setAttribute("cache.distributed.total_keys", totalKeys);
        span?.setAttribute("cache.distributed.prefix_count", result.size);
        return result;
      },
      distributedProjectSpanAttributes(identity),
    );
  }

  getAllKeysForProjectAsync(
    projectId: string,
    includeDistributed = false,
    projectSlug?: string,
  ): Promise<{ memory: Map<string, string[]>; distributed: Map<string, string[]> }> {
    return withSpan(
      SpanNames.CACHE_KEYS_GET_ALL_ASYNC,
      async (span?: Span) => {
        const memory = this.getKeysForProject(projectId);

        span?.setAttribute("cache.include_distributed", includeDistributed);
        if (!includeDistributed) return { memory, distributed: new Map() };

        const distributed = await this.getDistributedKeysForProject({ projectId, projectSlug });
        return { memory, distributed };
      },
      { "cache.project_id": projectId },
    );
  }

  async deleteDistributedKeysForProject(
    projectIdentity: DistributedCacheProjectIdentity,
  ): Promise<number> {
    const identity = normalizeDistributedProjectIdentity(projectIdentity);
    if (!this.distributedProvider.isConfigured()) return 0;

    return await withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_DISTRIBUTED_KEYS,
      async (span?: Span) => {
        try {
          const deleted = await this.deleteDistributedKeysMatching(identity);

          span?.setAttribute("cache.distributed.deleted", deleted);
          return deleted;
        } catch (error) {
          logger.warn("Distributed cache delete failed", {
            ...identity,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          span?.setAttribute("cache.distributed.error", true);
          throw error;
        }
      },
      distributedProjectSpanAttributes(identity),
    );
  }

  deleteAllKeysForProjectAsync(projectId: string, projectSlug?: string): Promise<{
    memoryDeleted: number;
    distributedDeleted: number;
  }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const distributedDeleted = await this.deleteDistributedKeysForProject({
          projectId,
          projectSlug,
        });
        // Traverse and mutate the failure-prone shared tier first. A provider
        // listing error must not leave the deterministic local tier partially
        // invalidated while shared entries remain untouched.
        const memoryDeleted = this.deleteKeysForProject(projectId);

        span?.setAttribute("cache.memory.deleted", memoryDeleted);
        span?.setAttribute("cache.distributed.deleted", distributedDeleted);
        return { memoryDeleted, distributedDeleted };
      },
      { "cache.project_id": projectId },
    );
  }

  /** Delete all cache entries for a specific project and environment. */
  deleteAllKeysForProjectEnvironmentAsync(
    projectId: string,
    environment: "production" | "preview",
    projectSlug?: string,
  ): Promise<{ memoryDeleted: number; distributedDeleted: number }> {
    return withSpan(
      SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
      async (span?: Span) => {
        const distributedDeleted = await this.deleteDistributedKeysForProjectEnvironment(
          { projectId, projectSlug },
          environment,
        );
        const memoryDeleted = this.deleteKeysForProjectEnvironment(projectId, environment);

        span?.setAttribute("cache.memory.deleted", memoryDeleted);
        span?.setAttribute("cache.distributed.deleted", distributedDeleted);
        span?.setAttribute("cache.environment", environment);

        logger.info("Invalidated cache for project environment", {
          projectId,
          environment,
          memoryDeleted,
          distributedDeleted,
        });

        return { memoryDeleted, distributedDeleted };
      },
      { "cache.project_id": projectId, "cache.environment": environment },
    );
  }

  async deleteDistributedKeysForProjectEnvironment(
    projectIdentity: DistributedCacheProjectIdentity,
    environment: "production" | "preview",
  ): Promise<number> {
    const identity = validateDistributedCacheProjectIdentity(projectIdentity);
    if (!this.distributedProvider.isConfigured()) return 0;

    return await withSpan(
      SpanNames.CACHE_REGISTRY_DELETE_DISTRIBUTED_KEYS,
      async (span?: Span) => {
        try {
          const deleted = await this.deleteDistributedKeysMatching(identity, environment);

          span?.setAttribute("cache.distributed.deleted", deleted);
          span?.setAttribute("cache.environment", environment);
          return deleted;
        } catch (error) {
          logger.warn("Distributed cache delete for environment failed", {
            ...identity,
            environment,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          span?.setAttribute("cache.distributed.error", true);
          throw error;
        }
      },
      { ...distributedProjectSpanAttributes(identity), "cache.environment": environment },
    );
  }

  private async deleteDistributedKeysMatching(
    identity: DistributedCacheProjectIdentity,
    environment?: DistributedCacheEnvironment,
  ): Promise<number> {
    const matchingKeys = new Set<string>();
    const descriptors = getOwnedDistributedCacheNamespaceDescriptors();
    let totalListedKeys = 0;

    for (const descriptor of descriptors) {
      if (!descriptor.matchProjectOwnership) continue;
      const listing = await this.distributedProvider.listKeys({
        prefix: descriptor.prefix,
        limit: MAX_DISTRIBUTED_SCANNED_KEYS,
      });
      if (listing.truncated) {
        throw new RangeError("Distributed cache listing exceeded the key traversal limit");
      }
      totalListedKeys += listing.keys.length;
      if (totalListedKeys > MAX_DISTRIBUTED_SCANNED_KEYS) {
        throw new RangeError("Distributed cache listing exceeded the key traversal limit");
      }
      for (const key of listing.keys) {
        if (
          matchingKeys.has(key) ||
          !matchesDistributedProjectIdentity(
            descriptor,
            descriptors,
            key,
            identity,
            environment,
          )
        ) continue;
        matchingKeys.add(key);
      }
    }

    // Complete every bounded provider listing before mutating shared storage.
    const keys = [...matchingKeys];
    return await this.distributedProvider.deleteKeys(keys);
  }
}

export function isKeyForProject(key: string, projectId: string): boolean {
  if (projectId.trim().length === 0) return false;
  const normalizedKey = stripDistributedPrefix(key);
  const parts = normalizedKey.split(":");
  if (parts.length < 2) return false;

  // Versioned cache keys: v{version}:{projectId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId) return true;

  // Render/module cache keys where projectId is first segment and next is env/content source
  const decodedFirstSegment = parts[0]
    ? decodeCacheKeyPercentSegment(parts[0]) ?? undefined
    : undefined;
  if (decodedFirstSegment === projectId) {
    if (parts[1] === "production" || parts[1] === "preview") return true;
    if (getEnvironmentFromContentSourceId(parts[1])) return true;
  }

  // Common prefixes where projectId is second segment (layout/component/proxy/etc.)
  if (parts[1] === projectId) return true;

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:...
  if (parts.length > 2 && parts[2] === projectId) return true;

  return false;
}

type CacheEnvironment = "production" | "preview";

/** Check if a cache key belongs to a specific project and environment */
export function isKeyForProjectEnvironment(
  key: string,
  projectId: string,
  environment: "production" | "preview",
): boolean {
  if (!isKeyForProject(key, projectId)) return false;

  const detected = getEnvironmentFromKey(key, projectId);
  return detected === environment;
}

/**
 * Descriptor for stores whose keys are produced by the structured cache-key
 * builders recognized below. Registration must opt in explicitly.
 */
export const structuredCacheStoreProjectOwnership: CacheStoreProjectOwnership = Object.freeze({
  isKeyForProject,
  isKeyForProjectEnvironment,
  isKeyForContentSource,
});

export function extractProjectIdFromKey(key: string): string | null {
  const parts = key.split(":");
  return parts[1] ?? null;
}

function stripDistributedPrefix(key: string): string {
  return stripOwnedDistributedCacheKeyPrefix(key);
}

function getEnvironmentFromContentSourceId(
  contentSourceId: string | undefined,
): CacheEnvironment | null {
  if (!contentSourceId) return null;

  if (
    contentSourceId.startsWith("preview-") ||
    contentSourceId === "preview" ||
    contentSourceId === "preview-draft"
  ) {
    return "preview";
  }

  if (
    contentSourceId.startsWith("release-") ||
    contentSourceId.startsWith("production-") ||
    contentSourceId.startsWith("prod-") ||
    contentSourceId === "production" ||
    contentSourceId === "latest"
  ) {
    return "production";
  }

  return null;
}

function getEnvironmentFromKey(key: string, projectId: string): CacheEnvironment | null {
  const normalizedKey = stripDistributedPrefix(key);
  const parts = normalizedKey.split(":");
  if (parts.length < 2) return null;
  const decodedFirstSegment = parts[0] ? decodeCacheKeyPercentSegment(parts[0]) : null;

  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}:...
  if (
    decodedFirstSegment === projectId &&
    (parts[1] === "production" || parts[1] === "preview")
  ) {
    return parts[1] as CacheEnvironment;
  }

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId && parts[2]) {
    return getEnvironmentFromContentSourceId(parts[2]);
  }

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  if (parts[0] === "layout" && parts[1] === projectId) {
    return getEnvironmentFromContentSourceId(parts[2]);
  }

  // Proxy manager cache keys: proxy:{projectSlug}:{environment}:{qualifier}
  if (parts[0] === "proxy" && (parts[2] === "production" || parts[2] === "preview")) {
    return parts[2] as CacheEnvironment;
  }

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:{qualifier}:...
  if (parts[0] === "file" || parts[0] === "stat" || parts[0] === "dir" || parts[0] === "files") {
    const sourceType = parts[1];
    if (sourceType === "branch") return "preview";
    if (sourceType === "release") return "production";
    if (sourceType === "env") return "production";
  }

  return null;
}

function isKeyForContentSource(
  key: string,
  projectId: string,
  contentSourceId: string,
): boolean {
  const normalizedKey = stripDistributedPrefix(key);
  const parts = normalizedKey.split(":");
  const decodedFirstSegment = parts[0] ? decodeCacheKeyPercentSegment(parts[0]) : null;
  const encodedContentSourceId = encodeCacheSourceIdentity({
    type: "branch",
    branch: contentSourceId,
  }).qualifier;

  const candidates = new Set<string>([
    contentSourceId,
    encodedContentSourceId,
    `preview-${contentSourceId}`,
    `preview-${encodedContentSourceId}`,
    `release-${contentSourceId}`,
    `release-${encodedContentSourceId}`,
    `production-${contentSourceId}`,
    `production-${encodedContentSourceId}`,
    `prod-${contentSourceId}`,
    `prod-${encodedContentSourceId}`,
  ]);

  // Render cache keys: {projectId}:{environment}:{releaseKey}:{version}:...
  if (
    decodedFirstSegment === projectId &&
    (parts[1] === "production" || parts[1] === "preview") &&
    parts[2]
  ) {
    return candidates.has(parts[2]);
  }

  // SSR module cache keys: v{version}:{projectId}:{contentSourceId}:...
  if (parts[0]?.startsWith("v") && parts[1] === projectId && parts[2]) {
    return candidates.has(parts[2]);
  }

  // Layout component cache keys: layout:{projectId}:{contentSourceId}:...
  if (parts[0] === "layout" && parts[1] === projectId && parts[2]) {
    return candidates.has(parts[2]);
  }

  // File/dir/stat/list cache keys: {prefix}:{sourceType}:{projectSlug}:{qualifier}:...
  if (parts[0] === "file" || parts[0] === "stat" || parts[0] === "dir" || parts[0] === "files") {
    const sourceType = parts[1];

    if ((sourceType === "branch" || sourceType === "release") && parts[3]) {
      return candidates.has(parts[3]);
    }

    if (sourceType === "env" && parts[3]) {
      return candidates.has(parts[3]) || candidates.has(parts[4] ?? "");
    }
  }

  return false;
}

export const cacheRegistry = new CacheRegistry(
  defaultDistributedProvider,
  getSharedLocalCacheRegistryState(),
);
