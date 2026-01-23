/**
 * Adapter Registry - Singleton management for RuntimeAdapter
 *
 * Provides a centralized way to access and configure the runtime adapter.
 * Supports auto-detection, manual configuration, and testing overrides.
 *
 * @example
 * ```ts
 * // Auto-detect and get adapter
 * const adapter = await runtime.get();
 *
 * // Manual configuration (e.g., Cloudflare Workers)
 * await runtime.set(createCloudflareAdapter(env));
 *
 * // Testing override
 * await runtime.set(createMockAdapter());
 * ```
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter, RuntimeId } from "./base.ts";
import { detectRuntime } from "./runtime-detection.ts";

type AdapterLoader = () => Promise<RuntimeAdapter>;

/**
 * Registry for managing RuntimeAdapter singleton
 */
class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private initialized = false;
  private initializationPromise: Promise<RuntimeAdapter> | null = null;
  private loaders: Map<RuntimeId, AdapterLoader> = new Map();

  constructor() {
    // Register default loaders (lazy imports to avoid bundling unused adapters)
    this.loaders.set("deno", async () => {
      const { denoAdapter } = await import("./deno.ts");
      return denoAdapter;
    });

    this.loaders.set("node", async () => {
      const { nodeAdapter } = await import("./node.ts");
      return nodeAdapter;
    });

    this.loaders.set("bun", async () => {
      const { bunAdapter } = await import("./bun.ts");
      return bunAdapter;
    });

    // Note: Cloudflare requires manual initialization with env context
    // this.loaders.set("cloudflare", ...) - not auto-detectable

    this.loaders.set("memory", async () => {
      const { createMockAdapter } = await import("./mock.ts");
      return createMockAdapter();
    });
  }

  /**
   * Get the current adapter, auto-detecting if needed.
   * Thread-safe: concurrent calls return the same initialization promise.
   */
  async get(): Promise<RuntimeAdapter> {
    // Fast path: already initialized
    if (this.instance && this.initialized) {
      return this.instance;
    }

    // Guard against concurrent initialization
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = withSpan("platform.registry.get", () => {
      return this.doInitialize();
    });

    try {
      return await this.initializationPromise;
    } catch (error) {
      // Clear promise on failure to allow retry
      this.initializationPromise = null;
      throw error;
    }
  }

  /**
   * Internal initialization logic
   */
  private doInitialize(): Promise<RuntimeAdapter> {
    const runtimeId = detectRuntime();

    return withSpan("platform.registry.doInitialize", async () => {
      if (runtimeId === "unknown") {
        throw new Error(
          "Unsupported runtime detected. Supported runtimes: deno, node, bun. " +
            "For Cloudflare Workers, call runtime.set(createCloudflareAdapter(env)).",
        );
      }

      if (runtimeId === "cloudflare") {
        throw new Error(
          "Cloudflare Workers detected but requires manual initialization. " +
            "Use: await runtime.set(createCloudflareAdapter(env))",
        );
      }

      const loader = this.loaders.get(runtimeId);
      if (!loader) {
        throw new Error(
          `No loader registered for runtime: ${runtimeId}. ` +
            `Registered runtimes: ${[...this.loaders.keys()].join(", ")}`,
        );
      }

      try {
        this.instance = await loader();
        await this.instance.initialize?.();
        this.initialized = true;
        return this.instance;
      } catch (error) {
        // Clear state on failure to allow retry
        this.instance = null;
        this.initialized = false;
        throw error;
      }
    }, { "registry.runtime": runtimeId });
  }

  /**
   * Manually set the adapter (for Cloudflare Workers, testing, etc.)
   */
  set(adapter: RuntimeAdapter): Promise<void> {
    return withSpan("platform.registry.set", async () => {
      // Validate adapter has required properties
      if (!adapter.id || !adapter.name || !adapter.fs || !adapter.env || !adapter.server) {
        throw new Error(
          "Invalid adapter: must implement RuntimeAdapter interface with id, name, fs, env, and server properties",
        );
      }

      const oldAdapter = this.instance && this.initialized ? this.instance : null;

      // Set new adapter and initialize
      this.instance = adapter;
      this.initialized = false;
      this.initializationPromise = null;

      try {
        await adapter.initialize?.();
        this.initialized = true;

        // Shutdown old adapter after new one is initialized
        if (oldAdapter) {
          try {
            await oldAdapter.shutdown?.();
          } catch (shutdownError) {
            logger.warn("[Registry] Failed to shutdown old adapter", shutdownError);
          }
        }
      } catch (error) {
        // Restore old adapter on failure
        this.instance = oldAdapter;
        this.initialized = !!oldAdapter;
        throw error;
      }
    }, { "registry.adapter.id": adapter.id, "registry.adapter.name": adapter.name });
  }

  /**
   * Get adapter synchronously (throws if not initialized)
   */
  getSync(): RuntimeAdapter {
    if (!this.instance || !this.initialized) {
      throw new Error(
        "RuntimeAdapter not initialized. Call `await runtime.get()` first, " +
          "or use `await runtime.set(adapter)` to configure manually.",
      );
    }
    return this.instance;
  }

  /**
   * Check if adapter is initialized
   */
  isInitialized(): boolean {
    return this.instance !== null && this.initialized;
  }

  /**
   * Reset the registry (for testing)
   */
  reset(): Promise<void> {
    return withSpan("platform.registry.reset", async () => {
      if (this.instance && this.initialized) {
        try {
          await this.instance.shutdown?.();
        } catch (error) {
          logger.warn("[Registry] Failed to shutdown adapter during reset", error);
        }
      }
      this.instance = null;
      this.initialized = false;
      this.initializationPromise = null;
    });
  }

  /**
   * Register a custom adapter loader
   */
  registerLoader(id: RuntimeId, loader: AdapterLoader, options?: { overwrite?: boolean }): void {
    if (this.loaders.has(id) && !options?.overwrite) {
      throw new Error(
        `Loader for runtime '${id}' already registered. Use { overwrite: true } to replace.`,
      );
    }
    this.loaders.set(id, loader);
  }
}

/**
 * Global runtime adapter registry
 *
 * @example
 * ```ts
 * import { runtime } from "#veryfront/platform/adapters/registry.ts";
 *
 * // Get adapter (auto-detects runtime)
 * const adapter = await runtime.get();
 *
 * // Use filesystem
 * const content = await adapter.fs.readFile("./config.json");
 * ```
 */
export const runtime = new AdapterRegistry();

// Cached local registry to avoid memory leaks
let localRegistry: AdapterRegistry | null = null;

/**
 * Get the local runtime adapter (deno, node, bun).
 * Unlike runtime.get(), this always returns the base adapter without FSAdapter enhancement.
 * Use this for local-only operations like writing temp files or caching.
 */
export function getLocalAdapter(): Promise<RuntimeAdapter> {
  if (!localRegistry) {
    localRegistry = new AdapterRegistry();
  }
  return localRegistry.get();
}

/**
 * Reset the local adapter registry (for testing)
 */
export async function resetLocalAdapter(): Promise<void> {
  if (localRegistry) {
    await localRegistry.reset();
    localRegistry = null;
  }
}

// Re-export for convenience
export type { RuntimeAdapter, RuntimeId } from "./base.ts";
