import { isAbsolute, join } from "@veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { handleErrorWithFallback } from "@veryfront/errors/index.ts";
import { getContentHash } from "../utils/index.ts";
import { getConfig } from "@veryfront/config";
import { initializeBundleManifest } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { isAnyDebugEnabled } from "@veryfront/utils/constants/env.ts";

export interface ConfigurationOptions {
  projectDir: string;
  mode: "development" | "production";
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
}

export class ConfigurationManager {
  private projectDir: string;
  private mode: "development" | "production";
  private adapter: RuntimeAdapter;
  private config!: VeryfrontConfig;
  private preloadedConfig?: VeryfrontConfig;
  private projectCacheKey: string | null = null;
  private cacheBaseDir: string | undefined;
  private lastEnvCacheValue: string | undefined;
  private lastConfigCacheValue: string | undefined;

  constructor(options: ConfigurationOptions) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.adapter = options.adapter;
    this.preloadedConfig = options.config;
  }

  async initialize(): Promise<void> {
    logger.info("Loading configuration", {
      projectDir: this.projectDir,
      mode: this.mode,
    });

    // Use pre-loaded config if provided (avoids FSAdapter re-loading issues)
    this.config = this.preloadedConfig ?? await getConfig(this.projectDir, this.adapter);

    // Initialize bundle manifest store
    await initializeBundleManifest(this.config, this.mode, this.adapter);

    // Compute project cache key
    this.projectCacheKey = await handleErrorWithFallback(
      async () => await getContentHash(this.projectDir),
      this.projectDir,
      logger,
    );

    logger.info("Configuration loaded successfully", {
      hasConfig: !!this.config,
      projectCacheKey: this.projectCacheKey,
    });
  }

  getConfig(): VeryfrontConfig {
    if (!this.config) {
      throw toError(createError({
        type: "render",
        message: "Configuration not initialized. Call initialize() first.",
      }));
    }
    return this.config;
  }

  getProjectCacheKey(): string | null {
    return this.projectCacheKey;
  }

  getCacheBaseDir(): string {
    const baseDirFromEnv = this.adapter.env?.get?.("VERYFRONT_CACHE_DIR");
    const configDir = this.config?.cache?.dir;

    // Return cached result if inputs haven't changed
    if (
      this.cacheBaseDir !== undefined &&
      this.lastEnvCacheValue === baseDirFromEnv &&
      this.lastConfigCacheValue === configDir
    ) {
      return this.cacheBaseDir;
    }

    // Recompute and cache
    const candidate = baseDirFromEnv || configDir;
    const result = candidate
      ? (isAbsolute(candidate) ? candidate : join(this.projectDir, candidate))
      : join(this.projectDir, ".veryfront", "cache");

    this.cacheBaseDir = result;
    this.lastEnvCacheValue = baseDirFromEnv;
    this.lastConfigCacheValue = configDir;

    return result;
  }

  isDebugMode(): boolean {
    return isAnyDebugEnabled(this.adapter.env ?? { get: () => undefined });
  }

  getProjectDir(): string {
    return this.projectDir;
  }

  getMode(): "development" | "production" {
    return this.mode;
  }

  getAdapter(): RuntimeAdapter {
    return this.adapter;
  }
}
