import { join } from "@veryfront/platform/compat/path/index.ts";
import { getConfig } from "@veryfront/config";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cliLogger } from "@veryfront/utils";
import { DEFAULT_CACHE_DIR, PROJECT_DIRS } from "@veryfront/utils/constants/server.ts";
import { CacheCoordinator, type CacheStore } from "@veryfront/rendering/cache/index.ts";
import {
  FilesystemCacheStore,
  KVCacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from "@veryfront/rendering/cache/stores/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { confirmPrompt, createSpinner, logSuccess, logWarning } from "../utils/index.ts";

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
  force?: boolean; // Skip confirmation prompts
}

export async function cleanCommand(options: CleanOptions) {
  const {
    projectDir,
    cache: cleanCache = false,
    build: cleanBuild = false,
    all = false,
    force = false,
  } = options;

  // Require confirmation for destructive --all operation unless --force is used
  if (all && !force) {
    logWarning("This will remove node_modules, .deno, and .veryfront directories.");
    const confirmed = await confirmPrompt(
      "Are you sure you want to clean all project artifacts?",
      false,
    );
    if (!confirmed) {
      cliLogger.info("Clean operation cancelled.");
      return;
    }
  }

  const spinner = createSpinner("Cleaning project...");
  spinner.start();

  try {
    if (cleanBuild || all) {
      spinner.update("Cleaning dist directory...");
      await cleanDirectory(join(projectDir, "dist"));
    }

    if (cleanCache || all) {
      spinner.update("Cleaning cache...");
      await cleanCacheStore(projectDir);
    }

    if (all) {
      spinner.update("Cleaning node_modules and temp directories...");
      const tempDirs = [".veryfront", "node_modules", ".deno"].map((dir) => join(projectDir, dir));
      await Promise.all(tempDirs.map(cleanDirectory));
    }

    spinner.stop();
    logSuccess("Project cleaned successfully.");
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

async function cleanDirectory(path: string): Promise<void> {
  const fs = createFileSystem();
  if (!(await fs.exists(path))) return;

  try {
    await fs.remove(path, { recursive: true });
  } catch (error) {
    // Log the error but don't throw - cleanup should be best effort
    cliLogger.error(`Failed to clean directory ${path}:`, error);
  }
}

async function cleanCacheStore(projectDir: string): Promise<void> {
  const fallbackCacheDir = join(projectDir, PROJECT_DIRS.ROOT, "cache");
  try {
    const adapter = await getAdapter();
    const config = await getConfig(projectDir, adapter);
    const cacheDir = config.cache?.dir ?? DEFAULT_CACHE_DIR;
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
  const { projectDir, cacheDir, renderConfig } = context;
  switch (type) {
    case "filesystem":
      return new FilesystemCacheStore({
        baseDir: join(projectDir, cacheDir, "render"),
      });
    case "kv":
      return new KVCacheStore({
        path: renderConfig.kvPath,
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
        maxEntries: renderConfig.maxEntries,
        ttlMs: renderConfig.ttl,
      });
  }
}
