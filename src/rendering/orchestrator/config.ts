/**
 * Configuration Manager
 * Handles configuration loading, validation, and environment variable resolution
 */

import { isAbsolute, join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
// import { handleErrorWithFallback } from "@veryfront/internal/errors.ts"; // Removed: use error-handling/index.ts
import { handleErrorWithFallback } from "@veryfront/errors/index.ts";
import { getContentHash } from "../utils/index.ts";
import { getConfig } from "@veryfront/config";
import { initializeBundleManifest } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";

export interface ConfigurationOptions {
  projectDir: string;
  mode: "development" | "production";
  adapter: RuntimeAdapter;
}

/**
 * Manages renderer configuration and environment settings
 */
export class ConfigurationManager {
  private projectDir: string;
  private mode: "development" | "production";
  private adapter: RuntimeAdapter;
  private config!: VeryfrontConfig;
  private projectCacheKey: string | null = null;
  private cacheBaseDir: string | undefined;
  private lastEnvCacheValue: string | undefined;
  private lastConfigCacheValue: string | undefined;

  constructor(options: ConfigurationOptions) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.adapter = options.adapter;
  }

  /**
   * Load and initialize configuration
   */
  async initialize(): Promise<void> {
    logger.info("Loading configuration", {
      projectDir: this.projectDir,
      mode: this.mode,
    });

    // Load config
    this.config = await getConfig(this.projectDir, this.adapter);

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

  /**
   * Get loaded configuration
   */
  getConfig(): VeryfrontConfig {
    if (!this.config) {
      throw toError(createError({
        type: "render",
        message: "Configuration not initialized. Call initialize() first.",
      }));
    }
    return this.config;
  }

  /**
   * Get project cache key
   */
  getProjectCacheKey(): string | null {
    return this.projectCacheKey;
  }

  /**
   * Get cache base directory with memoization
   * Computes the cache directory from environment variables or config
   */
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

  /**
   * Check if debug mode is enabled
   */
  isDebugMode(): boolean {
    return this.adapter.env?.get?.("VERYFRONT_DEBUG") === "1" ||
      this.adapter.env?.get?.("VERYFRONT_DEEP_INSPECT") === "1";
  }

  /**
   * Get project directory
   */
  getProjectDir(): string {
    return this.projectDir;
  }

  /**
   * Get mode
   */
  getMode(): "development" | "production" {
    return this.mode;
  }

  /**
   * Get adapter
   */
  getAdapter(): RuntimeAdapter {
    return this.adapter;
  }
}
