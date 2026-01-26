import { join } from "../../platform/compat/path/index.js";
import { getConfig } from "../../config/index.js";
import { runtime } from "../../platform/adapters/detect.js";
import { cliLogger } from "../../utils/index.js";
import { DEFAULT_CACHE_DIR } from "../../utils/constants/server.js";
import { CacheCoordinator } from "../../rendering/cache/index.js";
import { FilesystemCacheStore, KVCacheStore, MemoryCacheStore, RedisCacheStore, } from "../../rendering/cache/stores/index.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { confirmPrompt, createSpinner, logSuccess, logWarning } from "../utils/index.js";
export async function cleanCommand(options) {
    const { projectDir, cache: cleanCache = false, build: cleanBuild = false, all = false, force = false, } = options;
    if (all && !force) {
        logWarning("This will remove node_modules, .deno, and .veryfront directories.");
        const confirmed = await confirmPrompt("Are you sure you want to clean all project artifacts?", false);
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
    }
    catch (error) {
        spinner.stop();
        throw error;
    }
}
async function cleanDirectory(path) {
    const fs = createFileSystem();
    if (!(await fs.exists(path)))
        return;
    try {
        await fs.remove(path, { recursive: true });
    }
    catch (error) {
        cliLogger.error(`Failed to clean directory ${path}:`, error);
    }
}
async function cleanCacheStore(projectDir) {
    try {
        const adapter = await runtime.get();
        const config = await getConfig(projectDir, adapter);
        const cacheDir = config.cache?.dir ?? DEFAULT_CACHE_DIR;
        const renderConfig = config.cache?.render ?? {};
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
        await cleanDirectory(join(projectDir, cacheDir));
    }
    catch (error) {
        cliLogger.error("Failed to clean cache store:", error);
        throw error;
    }
}
function createRenderCacheStore(type, context) {
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
            if (!renderConfig.redisUrl)
                return null;
            return new RedisCacheStore({
                url: renderConfig.redisUrl,
                keyPrefix: renderConfig.redisKeyPrefix ?? "veryfront:render:",
                enableFallback: false,
            });
        case "memory":
        default:
            return new MemoryCacheStore({
                maxEntries: renderConfig.maxEntries,
                ttlMs: renderConfig.ttl,
            });
    }
}
