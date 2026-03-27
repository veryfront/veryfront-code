import { join } from "veryfront/platform/path";
import { getConfig } from "veryfront/config";
import { runtime } from "veryfront/platform";
import { cliLogger } from "#cli/utils";
import { DEFAULT_CACHE_DIR } from "veryfront/utils/constants/server";
import { CacheCoordinator, type CacheStore } from "veryfront/rendering";
import {
  FilesystemCacheStore,
  KVCacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from "veryfront/rendering";
import type { RuntimeAdapter } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { confirmPrompt, logSuccess, logWarning } from "#cli/utils";
import { createSpinner } from "#cli/ui";

interface RenderCacheConfig {
  type?: "memory" | "filesystem" | "kv" | "redis";
  ttl?: number;
  maxEntries?: number;
  kvPath?: string;
  redisUrl?: string;
  redisKeyPrefix?: string;
}

export interface CleanOptions {
  projectDir: string;
  cache?: boolean;
  build?: boolean;
  all?: boolean;
  force?: boolean; // Skip confirmation prompts
}

export async function cleanCommand(options: CleanOptions): Promise<void> {
  const { projectDir, cache = false, build = false, all = false, force = false } = options;

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

  try {
    if (build || all) {
      spinner.update("Cleaning dist directory...");
      const base = path.resolve(projectDir);
      const target = path.resolve(base, "dist");
      const relative = path.relative(base, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Invalid path");
      }
      await cleanDirectory(target);
    }

    if (cache || all) {
      spinner.update("Cleaning cache...");
      await cleanCacheStore(projectDir);
    }

    if (all) {
      spinner.update("Cleaning node_modules and temp directories...");
      const base = path.resolve(projectDir);
      const tempDirs = [".veryfront", "node_modules", ".deno"].map((dir) => {
        const target = path.resolve(base, dir);
        const relative = path.relative(base, target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new Error("Invalid path");
        }
        return target;
      });
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
    cliLogger.error(`Failed to clean directory ${path}:`, error);
  }
}

async function cleanCacheStore(projectDir: string): Promise<void> {
  try {
    const adapter = await runtime.get();
    const config = await getConfig(projectDir, adapter);
    const cacheDir = config.cache?.dir ?? DEFAULT_CACHE_DIR;
    const renderConfig: RenderCacheConfig = config.cache?.render ?? {};

    const store = createRenderCacheStore(renderConfig.type, {
      projectDir,
      cacheDir,
      adapter,
      renderConfig,
    });

    if (store) {
      const coordinator = new CacheCoordinator({ store, ttlMs: renderConfig.ttl });
      await coordinator.clearAll();
      await coordinator.destroy();
    }

    const base = path.resolve(projectDir);
    const target = path.resolve(base, cacheDir);
    const relative = path.relative(base, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid cache directory path');
    }
    await cleanDirectory(target);
  } catch (error) {
    cliLogger.error("Failed to clean cache store:", error);
    throw error;
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

  if (type === "filesystem") {
    const base = path.resolve(projectDir);
    const target = path.resolve(base, cacheDir, "render");
    const relative = path.relative(base, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid cache directory');
    }
    return new FilesystemCacheStore({
      baseDir: target,
    });
  }

  if (type === "kv") {
    return new KVCacheStore({
      path: renderConfig.kvPath,
    });
  }

  if (type === "redis") {
    if (!renderConfig.redisUrl) return null;
    return new RedisCacheStore({
      url: renderConfig.redisUrl,
      keyPrefix: renderConfig.redisKeyPrefix ?? "veryfront:render:",
      enableFallback: false,
    });
  }

  return new MemoryCacheStore({
    maxEntries: renderConfig.maxEntries,
    ttlMs: renderConfig.ttl,
  });
}
