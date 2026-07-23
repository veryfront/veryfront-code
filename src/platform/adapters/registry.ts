import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
} from "#veryfront/errors/error-registry/general.ts";
import { PLATFORM_ERROR } from "#veryfront/errors/error-registry/deploy.ts";
import type { RuntimeAdapter, RuntimeId } from "./base.ts";
import { detectRuntime } from "./runtime-detection.ts";

const logger = baseLogger.component("registry");

type AdapterLoader = () => Promise<RuntimeAdapter>;

interface AdapterInitialization {
  promise: Promise<RuntimeAdapter>;
}

interface PendingAdapterSet {
  generation: number;
  promise: Promise<void>;
}

type AdapterRegistryScope = "shared" | "isolated";

const RUNTIME_IDS = new Set<RuntimeId>(["deno", "node", "bun", "cloudflare", "memory"]);
const CAPABILITY_NAMES = [
  "typescript",
  "jsx",
  "http2",
  "websocket",
  "workers",
  "fileWatching",
  "shell",
  "kvStore",
  "writableFs",
] as const;
const FILE_SYSTEM_METHODS = [
  "readFile",
  "writeFile",
  "exists",
  "readDir",
  "stat",
  "mkdir",
  "remove",
  "makeTempDir",
  "watch",
] as const;

function readProperty(value: unknown, key: PropertyKey): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function hasMethods(value: unknown, names: readonly string[]): boolean {
  return names.every((name) => typeof readProperty(value, name) === "function");
}

function isRuntimeAdapter(value: unknown): value is RuntimeAdapter {
  const id = readProperty(value, "id");
  const name = readProperty(value, "name");
  const capabilities = readProperty(value, "capabilities");
  const fs = readProperty(value, "fs");
  const env = readProperty(value, "env");
  const server = readProperty(value, "server");
  const initialize = readProperty(value, "initialize");
  const shutdown = readProperty(value, "shutdown");

  return typeof id === "string" && RUNTIME_IDS.has(id as RuntimeId) &&
    typeof name === "string" && name.trim().length > 0 &&
    CAPABILITY_NAMES.every((capability) =>
      typeof readProperty(capabilities, capability) === "boolean"
    ) &&
    hasMethods(fs, FILE_SYSTEM_METHODS) &&
    hasMethods(env, ["get", "set", "toObject"]) &&
    hasMethods(server, ["upgradeWebSocket"]) &&
    typeof readProperty(value, "serve") === "function" &&
    (initialize === undefined || typeof initialize === "function") &&
    (shutdown === undefined || typeof shutdown === "function");
}

function assertRuntimeAdapter(value: unknown): asserts value is RuntimeAdapter {
  if (isRuntimeAdapter(value)) return;
  throw INVALID_ARGUMENT.create({
    message: "Invalid adapter: expected a complete RuntimeAdapter implementation",
  });
}

class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private initialized = false;
  private initializationPromise: AdapterInitialization | null = null;
  private pendingSets = new WeakMap<RuntimeAdapter, PendingAdapterSet>();
  private initializedAdapters = new WeakSet<RuntimeAdapter>();
  private lifecycleTails = new WeakMap<RuntimeAdapter, Promise<void>>();
  private mutationTail: Promise<void> = Promise.resolve();
  private pendingMutationCount = 0;
  private stateVersion = 0;
  private loaders = new Map<RuntimeId, AdapterLoader>();

  constructor(scope: AdapterRegistryScope = "isolated") {
    this.loaders.set("deno", async () => {
      const module = await import("./deno.ts");
      return scope === "shared" ? module.denoAdapter : new module.DenoAdapter();
    });

    this.loaders.set("node", async () => {
      const module = await import("./node.ts");
      return scope === "shared" ? module.nodeAdapter : new module.NodeAdapter();
    });

    this.loaders.set("bun", async () => {
      const module = await import("./bun.ts");
      return scope === "shared" ? module.bunAdapter : new module.BunAdapter();
    });

    // Cloudflare requires manual initialization with env context

    this.loaders.set("memory", async () => {
      const { createMockAdapter } = await import("./mock.ts");
      return createMockAdapter();
    });
  }

  async get(): Promise<RuntimeAdapter> {
    if (this.pendingMutationCount > 0) await this.mutationTail;
    if (this.instance && this.initialized) return this.instance;
    if (this.initializationPromise) return this.initializationPromise.promise;

    const stateVersion = this.stateVersion;
    const initialization = {
      promise: withSpan("platform.registry.get", () => this.doInitialize(stateVersion)),
    };
    this.initializationPromise = initialization;

    try {
      return await initialization.promise;
    } finally {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = null;
      }
    }
  }

  private doInitialize(stateVersion: number): Promise<RuntimeAdapter> {
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
          assertRuntimeAdapter(adapter);
          await this.initializeAdapter(adapter);

          if (stateVersion !== this.stateVersion) {
            await this.shutdownSupersededAdapter(adapter);
            if (this.pendingMutationCount > 0) await this.mutationTail;

            const currentAdapter = this.instance && this.initialized ? this.instance : null;
            if (currentAdapter) return currentAdapter;

            throw INITIALIZATION_ERROR.create({
              detail: "Runtime adapter initialization was superseded by a registry change.",
            });
          }

          this.instance = adapter;
          this.initialized = true;
          return adapter;
        } catch (error) {
          if (stateVersion === this.stateVersion) {
            this.instance = null;
            this.initialized = false;
          }
          throw error;
        }
      },
      { "registry.runtime": runtimeId },
    );
  }

  async set(adapter: RuntimeAdapter): Promise<void> {
    assertRuntimeAdapter(adapter);
    if (
      this.instance === adapter && this.initialized && this.pendingMutationCount === 0
    ) return;

    const pendingSet = this.pendingSets.get(adapter);
    if (pendingSet?.generation === this.stateVersion) return await pendingSet.promise;

    const generation = ++this.stateVersion;
    this.initializationPromise = null;

    const operation = this.enqueueMutation(() =>
      withSpan(
        "platform.registry.set",
        async () => {
          if (generation !== this.stateVersion) return;
          const oldAdapter = this.instance && this.initialized ? this.instance : null;

          await this.initializeAdapter(adapter);

          if (generation !== this.stateVersion) {
            await this.shutdownSupersededAdapter(adapter);
            return;
          }

          this.instance = adapter;
          this.initialized = true;

          if (!oldAdapter || oldAdapter === adapter) return;

          try {
            await this.shutdownAdapter(oldAdapter);
          } catch {
            logger.warn("Failed to shutdown old adapter");
          }
        },
        { "registry.adapter.id": adapter.id, "registry.adapter.name": adapter.name },
      )
    );
    const pending: PendingAdapterSet = { generation, promise: operation };
    this.pendingSets.set(adapter, pending);
    try {
      await operation;
    } finally {
      if (this.pendingSets.get(adapter) === pending) this.pendingSets.delete(adapter);
    }
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
    this.stateVersion++;
    const adapter = this.instance && this.initialized ? this.instance : null;

    this.instance = null;
    this.initialized = false;
    this.initializationPromise = null;

    return this.enqueueMutation(() =>
      withSpan("platform.registry.reset", async () => {
        if (!adapter) return;
        try {
          await this.shutdownAdapter(adapter);
        } catch {
          logger.warn("Failed to shutdown adapter during reset");
        }
      })
    );
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingMutationCount++;
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => {
        this.pendingMutationCount--;
      },
      () => {
        this.pendingMutationCount--;
      },
    );
    return result;
  }

  private async runAdapterLifecycle<T>(
    adapter: RuntimeAdapter,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.lifecycleTails.get(adapter) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.lifecycleTails.set(adapter, tail);
    try {
      return await result;
    } finally {
      if (this.lifecycleTails.get(adapter) === tail) {
        this.lifecycleTails.delete(adapter);
      }
    }
  }

  private initializeAdapter(adapter: RuntimeAdapter): Promise<void> {
    return this.runAdapterLifecycle(adapter, async () => {
      if (this.initializedAdapters.has(adapter)) return;
      await adapter.initialize?.();
      this.initializedAdapters.add(adapter);
    });
  }

  private shutdownAdapter(adapter: RuntimeAdapter): Promise<void> {
    return this.runAdapterLifecycle(adapter, async () => {
      try {
        await adapter.shutdown?.();
      } finally {
        this.initializedAdapters.delete(adapter);
      }
    });
  }

  private async shutdownSupersededAdapter(adapter: RuntimeAdapter): Promise<void> {
    try {
      await this.runAdapterLifecycle(adapter, async () => {
        if (this.instance === adapter && this.initialized) return;
        try {
          await adapter.shutdown?.();
        } finally {
          this.initializedAdapters.delete(adapter);
        }
      });
    } catch {
      logger.warn("Failed to shutdown superseded adapter");
    }
  }

  registerLoader(id: RuntimeId, loader: AdapterLoader, options?: { overwrite?: boolean }): void {
    if (!RUNTIME_IDS.has(id) || typeof loader !== "function") {
      throw INVALID_ARGUMENT.create({ message: "Invalid runtime adapter loader" });
    }
    if (this.loaders.has(id) && !options?.overwrite) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Loader for runtime '${id}' already registered. Use { overwrite: true } to replace.`,
      });
    }
    this.loaders.set(id, loader);
  }
}

export const runtime = new AdapterRegistry("shared");

let localRegistry: AdapterRegistry | null = null;

export function getLocalAdapter(): Promise<RuntimeAdapter> {
  localRegistry ??= new AdapterRegistry();
  return localRegistry.get();
}

export async function resetLocalAdapter(): Promise<void> {
  const registry = localRegistry;
  if (!registry) return;
  localRegistry = null;
  await registry.reset();
}

export type { RuntimeAdapter, RuntimeId } from "./base.ts";
