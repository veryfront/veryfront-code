import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExtensionContext } from "veryfront/extensions";
import {
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "veryfront/extensions/distributed";
import extRedis from "./index.ts";

function createContext(provided: Map<string, unknown>): ExtensionContext {
  return {
    get: <T>(name: string) => provided.get(name) as T | undefined,
    require: <T>(name: string) => {
      const value = provided.get(name);
      if (value === undefined) throw new Error(`missing ${name}`);
      return value as T;
    },
    provide: (name, implementation) => provided.set(name, implementation),
    config: {},
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

describe("ext-redis", () => {
  it("declares the Redis runtime contract and capabilities", () => {
    const extension = extRedis();

    assertEquals(extension.name, "ext-redis");
    assertEquals(extension.contracts?.provides, [RedisRuntimeProviderName]);
    assertEquals(extension.capabilities, [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: ["NODE_ENV", "REDIS_PASSWORD", "REDIS_URL", "REDIS_USERNAME"],
      },
    ]);
  });

  it("registers an isolated provider and supports teardown followed by setup", async () => {
    const provided = new Map<string, unknown>();
    const extension = extRedis();
    const context = createContext(provided);

    await extension.setup?.(context);
    const first = provided.get(RedisRuntimeProviderName) as RedisRuntimeProvider;
    assertEquals(first.id, "redis@5.11.0");
    await extension.teardown?.();
    assertThrows(() => first.loadModule(), Error, "closed");

    await extension.setup?.(context);
    const second = provided.get(RedisRuntimeProviderName) as RedisRuntimeProvider;
    assertEquals(second === first, false);
    await extension.teardown?.();
  });
});
