import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT, PLATFORM_ERROR } from "#veryfront/errors";
import type { RuntimeAdapter, RuntimeId } from "./base.ts";
import { detectRuntime } from "./runtime-detection.ts";

const logger = baseLogger.component("registry");

type AdapterLoader = () => Promise<RuntimeAdapter>;

class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private initialized = false;
  private initializationPromise: Promise<RuntimeAdapter> | null = null;
  private loaders = new Map<RuntimeId, AdapterLoader>();

  constructor() {
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

    // Cloudflare requires manual initialization with env context

    this.loaders.set("memory", async () => {
      const { createMockAdapter } = await import("./mock.ts");
      return createMockAdapter();
    });
  }

  async get(): Promise<RuntimeAdapter> {
    if (this.instance && this.initialized) return this.instance;
    if (this.initializationPromise) return this.initializationPromise;

    const initializationPromise = withSpan("platform.registry.get", () => this.doInitialize());
    this.initializationPromise = initializationPromise;

    try {
      return await initializationPromise;
    } catch (error) {
      if (this.initializationPromise === initializationPromise) {
        this.initializationPromise = null;
      }
      throw error;
    }
  }

  private doInitialize(): Promise<RuntimeAdapter> {
    const runtimeId = detectRuntime();

    return withSpan(
      "platform.registry.doInitialize",
      async () => {
        if (runtimeId === "unknown") {
          throw PLATFORM_ERROR.create({
            detail: "Unsupported runtime detected. Supported runtimes: deno, node, bun. " +
              "For Cloudflare Workers, call runtime.set(createCloudflareAdapter(env)).",
          });
        }

        if (runtimeId === "cloudflare") {
          throw INITIALIZATION_ERROR.create({
            detail: "Cloudflare Workers detected but requires manual initialization. " +
              "Use: await runtime.set(createCloudflareAdapter(env))",
          });
        }

        const loader = this.loaders.get(runtimeId);
        if (!loader) {
          throw PLATFORM_ERROR.create({
            detail: `No loader registered for runtime: ${runtimeId}. ` +
              `Registered runtimes: ${[...this.loaders.keys()].join(", ")}`,
          });
        }

        try {
          const adapter = await loader();
          this.instance = adapter;
          await adapter.initialize?.();
          this.initialized = true;
          return adapter;
        } catch (error) {
          this.instance = null;
          this.initialized = false;
          throw error;
        }
      },
      { "registry.runtime": runtimeId },
    );
  }

  set(adapter: RuntimeAdapter): Promise<void> {
    return withSpan(
      "platform.registry.set",
      async () => {
        if (!adapter.id || !adapter.name || !adapter.fs || !adapter.env || !adapter.server) {
          throw INVALID_ARGUMENT.create({
            detail:
              "Invalid adapter: must implement RuntimeAdapter interface with id, name, fs, env, and server properties",
          });
        }

        const oldAdapter = this.instance && this.initialized ? this.instance : null;

        this.instance = adapter;
        this.initialized = false;
        this.initializationPromise = null;

        try {
          await adapter.initialize?.();
          this.initialized = true;

          if (!oldAdapter) return;

          try {
            await oldAdapter.shutdown?.();
          } catch (shutdownError) {
            logger.warn("Failed to shutdown old adapter", shutdownError);
          }
        } catch (error) {
          this.instance = oldAdapter;
          this.initialized = oldAdapter != null;
          throw error;
        }
      },
      { "registry.adapter.id": adapter.id, "registry.adapter.name": adapter.name },
    );
  }

  getSync(): RuntimeAdapter {
    if (!this.instance || !this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "RuntimeAdapter not initialized. Call `await runtime.get()` first, " +
          "or use `await runtime.set(adapter)` to configure manually.",
      });
    }
    return this.instance;
  }

  isInitialized(): boolean {
    return this.instance != null && this.initialized;
  }

  reset(): Promise<void> {
    return withSpan("platform.registry.reset", async () => {
      if (this.instance && this.initialized) {
        try {
          await this.instance.shutdown?.();
        } catch (error) {
          logger.warn("Failed to shutdown adapter during reset", error);
        }
      }

      this.instance = null;
      this.initialized = false;
      this.initializationPromise = null;
    });
  }

  registerLoader(id: RuntimeId, loader: AdapterLoader, options?: { overwrite?: boolean }): void {
    if (this.loaders.has(id) && !options?.overwrite) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Loader for runtime '${id}' already registered. Use { overwrite: true } to replace.`,
      });
    }
    this.loaders.set(id, loader);
  }
}

export const runtime = new AdapterRegistry();

let localRegistry: AdapterRegistry | null = null;

export function getLocalAdapter(): Promise<RuntimeAdapter> {
  localRegistry ??= new AdapterRegistry();
  return localRegistry.get();
}

export async function resetLocalAdapter(): Promise<void> {
  if (!localRegistry) return;
  await localRegistry.reset();
  localRegistry = null;
}

export type { RuntimeAdapter, RuntimeId } from "./base.ts";
