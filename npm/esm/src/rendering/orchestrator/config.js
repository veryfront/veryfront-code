import { isAbsolute, join } from "../../platform/compat/path-helper.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { handleErrorWithFallback } from "../../errors/index.js";
import { computeHash } from "../utils/index.js";
import { getConfig } from "../../config/index.js";
import { initializeBundleManifest } from "../../utils/bundle-manifest-init.js";
import { isAnyDebugEnabled } from "../../utils/constants/env.js";
import { getCacheDirFromContext } from "../../utils/cache-dir.js";
export class ConfigurationManager {
    projectDir;
    mode;
    adapter;
    config;
    preloadedConfig;
    projectCacheKey = null;
    cacheBaseDir;
    lastEnvCacheValue;
    lastConfigCacheValue;
    constructor(options) {
        this.projectDir = options.projectDir;
        this.mode = options.mode;
        this.adapter = options.adapter;
        this.preloadedConfig = options.config;
    }
    async initialize() {
        logger.debug("Loading configuration", {
            projectDir: this.projectDir,
            mode: this.mode,
        });
        this.config = this.preloadedConfig ?? (await getConfig(this.projectDir, this.adapter));
        await initializeBundleManifest(this.config, this.mode, this.adapter);
        this.projectCacheKey = await handleErrorWithFallback(() => computeHash(this.projectDir), this.projectDir, logger);
        logger.debug("Configuration loaded successfully", {
            hasConfig: !!this.config,
            projectCacheKey: this.projectCacheKey,
        });
    }
    getConfig() {
        if (this.config)
            return this.config;
        throw toError(createError({
            type: "render",
            message: "Configuration not initialized. Call initialize() first.",
        }));
    }
    getProjectCacheKey() {
        return this.projectCacheKey;
    }
    getCacheBaseDir() {
        const contextCacheDir = getCacheDirFromContext();
        if (contextCacheDir) {
            return isAbsolute(contextCacheDir) ? contextCacheDir : join(this.projectDir, contextCacheDir);
        }
        const baseDirFromEnv = this.adapter.env?.get?.("VERYFRONT_CACHE_DIR") ??
            this.adapter.env?.get?.("VF_CACHE_DIR");
        const configDir = this.config.cache?.dir;
        if (this.cacheBaseDir !== undefined &&
            this.lastEnvCacheValue === baseDirFromEnv &&
            this.lastConfigCacheValue === configDir) {
            return this.cacheBaseDir;
        }
        const candidate = baseDirFromEnv ?? configDir;
        const result = candidate
            ? isAbsolute(candidate) ? candidate : join(this.projectDir, candidate)
            : join(this.projectDir, ".veryfront", "cache");
        this.cacheBaseDir = result;
        this.lastEnvCacheValue = baseDirFromEnv;
        this.lastConfigCacheValue = configDir;
        return result;
    }
    isDebugMode() {
        return isAnyDebugEnabled(this.adapter.env ?? { get: () => undefined });
    }
    getProjectDir() {
        return this.projectDir;
    }
    getMode() {
        return this.mode;
    }
    getAdapter() {
        return this.adapter;
    }
}
