import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT, PLATFORM_ERROR } from "#veryfront/errors";
import type { RuntimeAdapter, RuntimeId } from "./base.ts";
import { detectRuntime } from "./runtime-detection.ts";

const logger = baseLogger.component("registry");

type AdapterLoader = () => Promise<RuntimeAdapter>;

/** @internal Runtime-adapter lifecycle coordinator. */
export class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private initialized = false;
  private operationTail: Promise<void> = Promise.resolve();
  private pendingOperations = 0;
  private pendingGet: Promise<RuntimeAdapter> | null = null;
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
    if (this.instance && this.initialized && this.pendingOperations === 0) {
      return this.instance;
    }
    if (this.pendingGet) return await this.pendingGet;

    const pendingGet = withSpan(
      "platform.registry.get",
      () =>
        this.enqueue(async () => {
          if (this.instance && this.initialized) return this.instance;
          return await this.doInitialize();
        }),
    );
    this.pendingGet = pendingGet;
    pendingGet.then(
      () => {
        if (this.pendingGet === pendingGet) this.pendingGet = null;
      },
      () => {
        if (this.pendingGet === pendingGet) this.pendingGet = null;
      },
    );
    return await pendingGet;
  }

  private async doInitialize(): Promise<RuntimeAdapter> {
    const runtimeId = detectRuntime();

    return await withSpan(
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

        const adapter = await loader();
        await this.initializeAdapter(adapter);
        this.instance = adapter;
        this.initialized = true;
        return adapter;
      },
      { "registry.runtime": runtimeId },
    );
  }

  set(adapter: RuntimeAdapter): Promise<void> {
    // A get invoked after this set must observe the replacement operation,
    // rather than coalescing with an earlier automatic initialization.
    this.pendingGet = null;
    return withSpan(
      "platform.registry.set",
      () =>
        this.enqueue(async () => {
          if (
            typeof adapter !== "object" ||
            adapter === null ||
            !adapter.id ||
            !adapter.name ||
            !adapter.fs ||
            !adapter.env ||
            !adapter.server
          ) {
            throw INVALID_ARGUMENT.create({
              detail:
                "Invalid adapter: must implement RuntimeAdapter interface with id, name, fs, env, and server properties",
            });
          }

          const oldAdapter = this.instance && this.initialized ? this.instance : null;
          if (oldAdapter === adapter) return;

          await this.initializeAdapter(adapter);
          this.instance = adapter;
          this.initialized = true;

          if (oldAdapter) {
            await this.shutdownAdapter(oldAdapter, "Failed to shutdown old adapter");
          }
        }),
    );
  }

  getSync(): RuntimeAdapter {
    if (!this.instance || !this.initialized || this.pendingOperations > 0) {
      throw INITIALIZATION_ERROR.create({
        detail:
          "RuntimeAdapter not initialized or is transitioning. Call `await runtime.get()` first, " +
          "or use `await runtime.set(adapter)` to configure manually.",
      });
    }
    return this.instance;
  }

  isInitialized(): boolean {
    return this.instance != null && this.initialized && this.pendingOperations === 0;
  }

  reset(): Promise<void> {
    // A later get must queue behind this reset instead of sharing an earlier get.
    this.pendingGet = null;
    return withSpan(
      "platform.registry.reset",
      () =>
        this.enqueue(async () => {
          const adapter = this.instance && this.initialized ? this.instance : null;
          this.instance = null;
          this.initialized = false;

          if (adapter) {
            await this.shutdownAdapter(adapter, "Failed to shutdown adapter during reset");
          }
        }),
    );
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingOperations++;
    const result = this.operationTail.then(async () => {
      try {
        return await operation();
      } finally {
        this.pendingOperations--;
      }
    });
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async initializeAdapter(adapter: RuntimeAdapter): Promise<void> {
    try {
      await adapter.initialize?.();
    } catch (error) {
      await this.shutdownAdapter(
        adapter,
        "Failed to shutdown adapter after initialization failure",
      );
      throw error;
    }
  }

  private async shutdownAdapter(adapter: RuntimeAdapter, message: string): Promise<void> {
    try {
      await adapter.shutdown?.();
    } catch (error) {
      logger.warn(message, error);
    }
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
