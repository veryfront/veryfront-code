import type { RuntimeAdapter, RuntimeId } from "./base.ts";

type AdapterLoader = () => Promise<RuntimeAdapter>;

class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private localInstance: RuntimeAdapter | null = null;
  private initialized = false;
  private loaders: Map<RuntimeId, AdapterLoader> = new Map();

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

    this.loaders.set("memory", async () => {
      const { createMockAdapter } = await import("./mock.ts");
      return createMockAdapter();
    });
  }

  async get(): Promise<RuntimeAdapter> {
    if (this.instance) {
      return this.instance;
    }

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

  async set(adapter: RuntimeAdapter): Promise<void> {
    if (this.instance && this.initialized) {
      await this.instance.shutdown?.();
    }

    this.instance = adapter;
    this.initialized = false;
    await this.initialize();
  }

  getSync(): RuntimeAdapter {
    if (!this.instance) {
      throw new Error(
        "RuntimeAdapter not initialized. Call `await runtime.get()` first, " +
          "or use `await runtime.set(adapter)` to configure manually.",
      );
    }
    return this.instance;
  }

  isInitialized(): boolean {
    return this.instance !== null && this.initialized;
  }

  async getLocal(): Promise<RuntimeAdapter> {
    if (this.localInstance) {
      return this.localInstance;
    }

    const runtimeId = this.detectRuntime();
    const loader = this.loaders.get(runtimeId);

    if (!loader) {
      throw new Error(
        `Unsupported runtime: ${runtimeId}. ` +
          `Supported runtimes: ${[...this.loaders.keys()].join(", ")}.`,
      );
    }

    this.localInstance = await loader();
    return this.localInstance;
  }

  async reset(): Promise<void> {
    if (this.instance && this.initialized) {
      await this.instance.shutdown?.();
    }
    this.instance = null;
    this.localInstance = null;
    this.initialized = false;
  }

  registerLoader(id: RuntimeId, loader: AdapterLoader): void {
    this.loaders.set(id, loader);
  }

  private detectRuntime(): RuntimeId {
    if (typeof Deno !== "undefined" && typeof Deno.version === "object") {
      return "deno";
    }

    if ("Bun" in globalThis) {
      return "bun";
    }

    if (typeof process !== "undefined" && process.versions?.node) {
      return "node";
    }

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

  private async initialize(): Promise<void> {
    if (!this.instance || this.initialized) {
      return;
    }

    await this.instance.initialize?.();
    this.initialized = true;
  }
}

export const runtime = new AdapterRegistry();

export type { RuntimeAdapter, RuntimeId } from "./base.ts";
