import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "../../extensions/contracts.ts";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed";
import { MultiEventPublisher, RedisEventPublisher } from "./event-publisher.ts";
import type { ClaudeCodeEvent, ClaudeCodeEventPublisher } from "./types.ts";

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | { status: "timeout" }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ status: "timeout" }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function createErrorEvent(): ClaudeCodeEvent {
  return {
    type: "error",
    timestamp: Date.now(),
    message: "boom",
    recoverable: false,
  };
}

describe("workflow/claude-code/event-publisher", () => {
  it("MultiEventPublisher.publish fails fast when another publisher hangs", async () => {
    const hangingPublisher: ClaudeCodeEventPublisher = {
      publish: () => new Promise<void>(() => {}),
      close: () => {},
    };
    const failingPublisher: ClaudeCodeEventPublisher = {
      publish: () => Promise.reject(new Error("publish failed")),
      close: () => {},
    };
    const publisher = new MultiEventPublisher(hangingPublisher, failingPublisher);

    const result = await raceWithTimeout(
      publisher.publish(createErrorEvent()).then(
        () => ({ status: "resolved" as const }),
        (error) => ({
          status: "rejected" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      100,
    );

    assertEquals(result, { status: "rejected", message: "publish failed" });
  });

  it("MultiEventPublisher.close fails fast when another publisher hangs", async () => {
    const hangingPublisher: ClaudeCodeEventPublisher = {
      publish: () => {},
      close: () => new Promise<void>(() => {}),
    };
    const failingPublisher: ClaudeCodeEventPublisher = {
      publish: () => {},
      close: () => Promise.reject(new Error("close failed")),
    };
    const publisher = new MultiEventPublisher(hangingPublisher, failingPublisher);

    const result = await raceWithTimeout(
      publisher.close().then(
        () => ({ status: "resolved" as const }),
        (error) => ({
          status: "rejected" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      100,
    );

    assertEquals(result, { status: "rejected", message: "close failed" });
  });

  it("RedisEventPublisher.close fails fast when one client hangs and the other rejects", async () => {
    register(RedisRuntimeProviderName, {
      id: "test-redis",
      loadModule: () => Promise.resolve({ createClient: () => ({}) }),
      getClient: () => Promise.resolve({}),
      disconnectClient: () => Promise.resolve(),
      openClient: () => Promise.resolve({ client: {}, close: () => Promise.resolve() }),
      createEventPublisher: () => ({
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve(() => undefined),
        close: () =>
          Promise.all([
            new Promise<void>(() => {}),
            Promise.reject(new Error("close failed")),
          ]).then(() => undefined),
      }),
      close: () => Promise.resolve(),
    });
    try {
      const publisher = new RedisEventPublisher({ url: "redis://example" });
      await publisher.publish(createErrorEvent());

      const result = await raceWithTimeout(
        publisher.close().then(
          () => ({ status: "resolved" as const }),
          (error) => ({
            status: "rejected" as const,
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
        100,
      );

      assertEquals(result, { status: "rejected", message: "close failed" });
    } finally {
      unregister(RedisRuntimeProviderName);
    }
  });

  it("RedisEventPublisher creates a fresh implementation after close", async () => {
    let created = 0;
    register(RedisRuntimeProviderName, {
      id: "test-redis",
      loadModule: () => Promise.resolve({ createClient: () => ({}) }),
      getClient: () => Promise.resolve({}),
      disconnectClient: () => Promise.resolve(),
      openClient: () => Promise.resolve({ client: {}, close: () => Promise.resolve() }),
      createEventPublisher: () => {
        created++;
        return {
          publish: () => Promise.resolve(),
          subscribe: () => Promise.resolve(() => undefined),
          close: () => Promise.resolve(),
        };
      },
      close: () => Promise.resolve(),
    });
    try {
      const publisher = new RedisEventPublisher({ url: "redis://example" });
      await publisher.publish(createErrorEvent());
      await publisher.close();
      await publisher.publish(createErrorEvent());

      assertEquals(created, 2);
      await publisher.close();
    } finally {
      unregister(RedisRuntimeProviderName);
    }
  });
});
