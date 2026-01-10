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

import type { RuntimeAdapter, RuntimeId } from "./base.ts";

type AdapterLoader = () => Promise<RuntimeAdapter>;

/**
 * Registry for managing RuntimeAdapter singleton
 */
class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private initialized = false;
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
   * Get the current adapter, auto-detecting if needed
   */
  async get(): Promise<RuntimeAdapter> {
    if (this.instance) {
      return this.instance;
    }

    // Auto-detect runtime
    const runtimeId = this.detectRuntime();
    const loader = this.loaders.get(runtimeId);

    if (!loader) {
      throw new Error(
        `Unsupported runtime: ${runtimeId}. ` +
          `Supported runtimes: ${[...this.loaders.keys()].join(", ")}. ` +
          `For Cloudflare Workers, use runtime.set(createCloudflareAdapter(env)).`,
      );
    }

    this.instance = await loader();
    await this.initialize();
    return this.instance;
  }

  /**
   * Manually set the adapter (for Cloudflare Workers, testing, etc.)
   */
  async set(adapter: RuntimeAdapter): Promise<void> {
    // Shutdown existing adapter if any
    if (this.instance && this.initialized) {
      await this.instance.shutdown?.();
    }

    this.instance = adapter;
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Get adapter synchronously (throws if not initialized)
   */
  getSync(): RuntimeAdapter {
    if (!this.instance) {
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
  async reset(): Promise<void> {
    if (this.instance && this.initialized) {
      await this.instance.shutdown?.();
    }
    this.instance = null;
    this.initialized = false;
  }

  /**
   * Register a custom adapter loader
   */
  registerLoader(id: RuntimeId, loader: AdapterLoader): void {
    this.loaders.set(id, loader);
  }

  /**
   * Detect current runtime
   */
  private detectRuntime(): RuntimeId {
    // Deno
    if (typeof Deno !== "undefined" && typeof Deno.version === "object") {
      return "deno";
    }

    // Bun
    if ("Bun" in globalThis) {
      return "bun";
    }

    // Node.js
    if (typeof process !== "undefined" && process.versions?.node) {
      return "node";
    }

    // Cloudflare Workers (detected but requires manual init)
    if ("caches" in globalThis && "WebSocketPair" in globalThis) {
      throw new Error(
        "Cloudflare Workers detected but requires manual initialization. " +
          "Use: await runtime.set(createCloudflareAdapter(env))",
      );
    }

    throw new Error(
      "Unsupported runtime detected. Supported runtimes: deno, node, bun. " +
        "For Cloudflare Workers, call runtime.set(createCloudflareAdapter(env)).",
    );
  }

  /**
   * Initialize the adapter
   */
  private async initialize(): Promise<void> {
    if (!this.instance || this.initialized) {
      return;
    }

    await this.instance.initialize?.();
    this.initialized = true;
  }
}

/**
 * Global runtime adapter registry
 *
 * @example
 * ```ts
 * import { runtime } from "@veryfront/platform/adapters/registry.ts";
 *
 * // Get adapter (auto-detects runtime)
 * const adapter = await runtime.get();
 *
 * // Use filesystem
 * const content = await adapter.fs.readFile("./config.json");
 * ```
 */
export const runtime = new AdapterRegistry();

/**
 * Get the local runtime adapter (deno, node, bun).
 * Unlike runtime.get(), this always returns the base adapter without FSAdapter enhancement.
 * Use this for local-only operations like writing temp files or caching.
 */
export function getLocalAdapter(): Promise<RuntimeAdapter> {
  // Create a fresh registry instance to avoid getting the enhanced adapter
  const localRegistry = new AdapterRegistry();
  return localRegistry.get();
}

// Re-export for convenience
export type { RuntimeAdapter, RuntimeId } from "./base.ts";
