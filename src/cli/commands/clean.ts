import { exists } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { getConfig } from "@veryfront/config";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cliLogger } from "@veryfront/utils";
import { CacheCoordinator, type CacheStore } from "@veryfront/rendering/cache/index.ts";
import {
  FilesystemCacheStore,
  KVCacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from "@veryfront/rendering/cache/stores/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

interface RenderCacheConfig {
  type?: "memory" | "filesystem" | "kv" | "redis";
  ttl?: number;
  maxEntries?: number;
  kvPath?: string;
  redisUrl?: string;
  redisKeyPrefix?: string;
}

interface CleanOptions {
  projectDir: string;
  cache?: boolean;
  build?: boolean;
  all?: boolean;
}

export async function cleanCommand(options: CleanOptions) {
  const { projectDir, cache: cleanCache = false, build: cleanBuild = false, all = false } = options;

  if (cleanBuild || all) {
    await cleanDirectory(join(projectDir, "dist"));
  }

  if (cleanCache || all) {
    await cleanCacheStore(projectDir);
  }

  if (all) {
    const tempDirs = [".veryfront", "node_modules", ".deno"].map((dir) => join(projectDir, dir));
    await Promise.all(tempDirs.map(cleanDirectory));
  }
}

async function cleanDirectory(path: string): Promise<void> {
  if (!(await exists(path))) return;

  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    // Log the error but don't throw - cleanup should be best effort
    cliLogger.error(`Failed to clean directory ${path}:`, error);
  }
}

async function cleanCacheStore(projectDir: string): Promise<void> {
  const fallbackCacheDir = join(projectDir, ".veryfront", "cache");
  try {
    const adapter = await getAdapter();
    const config = await getConfig(projectDir, adapter);
    const cacheDir = config.cache?.dir ?? ".veryfront/cache";
    const renderConfig = (config.cache?.render ?? {}) as RenderCacheConfig;

    const store = createRenderCacheStore(renderConfig.type, {
      projectDir,
      cacheDir,
      adapter,
      renderConfig,
    });

    if (store) {
      const coordinator = new CacheCoordinator({
        store,
        ttlMs: renderConfig.ttl,
      });
      await coordinator.clearAll();
      await coordinator.destroy();
    }

    await cleanDirectory(join(projectDir, cacheDir));
  } catch (error) {
    // Fall back to removing default cache directory on error
    cliLogger.error("Failed to clean cache store, falling back to default cache directory:", error);
    await cleanDirectory(fallbackCacheDir);
  }
}

function createRenderCacheStore(
  type: string | undefined,
  context: {
    projectDir: string;
    cacheDir: string;
    adapter: RuntimeAdapter;
    renderConfig: RenderCacheConfig;
  },
): CacheStore | null {
  const { projectDir, cacheDir, adapter, renderConfig } = context;
  switch (type) {
    case "filesystem":
      return new FilesystemCacheStore({
        baseDir: join(projectDir, cacheDir, "render"),
        adapter,
      });
    case "kv":
      return new KVCacheStore({
        path: (renderConfig.kvPath as string | undefined) ?? undefined,
      });
    case "redis":
      if (!renderConfig.redisUrl) {
        return null;
      }
      return new RedisCacheStore({
        url: renderConfig.redisUrl,
        keyPrefix: renderConfig.redisKeyPrefix ?? "veryfront:render:",
      });
    case "memory":
    default:
      return new MemoryCacheStore({
        maxEntries: renderConfig.maxEntries as number | undefined,
        ttlMs: renderConfig.ttl as number | undefined,
      });
  }
}
