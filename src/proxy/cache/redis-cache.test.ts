import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { RedisCache } from "./redis-cache.ts";
import type { RedisClientType } from "redis";

type RedisErrorHandler = (error: Error) => void;

class FakeRedisClient {
  private errorHandler: RedisErrorHandler | null = null;

  on(event: string, handler: RedisErrorHandler): this {
    if (event === "error") this.errorHandler = handler;
    return this;
  }

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async get(): Promise<string | null> {
    return null;
  }

  emitError(error: Error): void {
    this.errorHandler?.(error);
  }
}

class TestRedisCache extends RedisCache {
  constructor(private readonly fakeClient: FakeRedisClient) {
    super({ url: "redis://localhost:6379" });
  }

  protected override createRedisClient(): RedisClientType {
    return this.fakeClient as unknown as RedisClientType;
  }
}

describe("RedisCache", () => {
  const originalConsoleLog = console.log;
  let logLines: string[] = [];

  beforeEach(() => {
    logLines = [];
    console.log = ((...args: unknown[]) => {
      logLines.push(args.map((arg) => String(arg)).join(" "));
    }) as typeof console.log;
  });

  afterEach(async () => {
    console.log = originalConsoleLog;
  });

  it("logs transient socket closures as warnings instead of errors", async () => {
    const client = new FakeRedisClient();
    const cache = new TestRedisCache(client);

    await cache.get("missing");
    client.emitError(new Error("Socket closed unexpectedly"));

    assertEquals(
      logLines.some((line: string) =>
        line.includes("[RedisCache] Client connection dropped; reconnecting")
      ),
      true,
    );
    assertEquals(
      logLines.some((line: string) => line.includes("[RedisCache] Client error")),
      false,
    );

    await cache.close();
  });

  it("keeps non-transient client errors at error level", async () => {
    const client = new FakeRedisClient();
    const cache = new TestRedisCache(client);

    await cache.get("missing");
    client.emitError(new Error("AUTH failed"));

    assertEquals(logLines.some((line: string) => line.includes("[RedisCache] Client error")), true);
    assertEquals(
      logLines.some((line: string) =>
        line.includes("[RedisCache] Client connection dropped; reconnecting")
      ),
      false,
    );

    await cache.close();
  });
});
