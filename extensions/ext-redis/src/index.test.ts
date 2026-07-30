import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "veryfront/extensions/distributed";
import factory from "./index.ts";

const logger: ExtensionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createContext(provided: Map<string, unknown>): ExtensionContext {
  return {
    config: {},
    logger,
    provide<T>(name: string, implementation: T) {
      provided.set(name, implementation);
    },
    get<T>(name: string): T | undefined {
      return provided.get(name) as T | undefined;
    },
    require<T>(name: string): T {
      const implementation = provided.get(name);
      if (implementation === undefined) throw new Error(`Missing ${name}`);
      return implementation as T;
    },
  };
}

describe("ext-redis provider lifecycle", () => {
  it("declares only the aggregate provider and explicit activation", async () => {
    const extension = factory();
    assertEquals(extension.name, "ext-redis");
    assertEquals(extension.contracts?.provides, [DistributedRuntimeProviderName]);

    const manifest = JSON.parse(
      await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
    );
    assertEquals(manifest.veryfront.activation, "explicit");
    assertEquals(manifest.veryfront.contracts, extension.contracts);
    assertEquals(manifest.veryfront.capabilities, extension.capabilities);
  });

  it("registers factories without opening a connection and invalidates them on teardown", async () => {
    const extension = factory({ url: "rediss://not-contacted.example" });
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;

    assertEquals(provider.id, "redis@5.11.0");
    assertEquals(provider.getWorkflowWorkerEnvironment(), {
      REDIS_URL: "rediss://not-contacted.example",
    });
    const store = provider.createRenderCacheStore({});
    await extension.teardown!();

    await store.destroy();
    assertThrows(
      () => provider.createRenderCacheStore({}),
      Error,
      "not active",
    );
  });

  it("singleflights teardown and retains failed cleanup for an explicit retry", async () => {
    const extension = factory({ url: "rediss://not-contacted.example" });
    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    const provider = provided.get(DistributedRuntimeProviderName) as DistributedRuntimeProvider;
    const store = provider.createRenderCacheStore({});
    let attempts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.destroy = async () => {
      attempts++;
      await gate;
      if (attempts === 1) throw new Error("first close failed");
    };

    const first = extension.teardown!() as Promise<void>;
    const concurrent = extension.teardown!() as Promise<void>;
    assertStrictEquals(concurrent, first);
    await Promise.resolve();
    assertEquals(attempts, 1);
    release();
    await assertRejects(() => first, Error, "first close failed");

    await extension.teardown!();
    assertEquals(attempts, 2);
  });

  it("can retry setup after registration itself fails", async () => {
    const extension = factory();
    const rejectedContext = {
      ...createContext(new Map()),
      provide: () => {
        throw new Error("registry unavailable");
      },
    };
    assertThrows(
      () => extension.setup!(rejectedContext),
      Error,
      "registry unavailable",
    );

    const provided = new Map<string, unknown>();
    await extension.setup!(createContext(provided));
    assertEquals(provided.has(DistributedRuntimeProviderName), true);
    await extension.teardown!();
  });
});
