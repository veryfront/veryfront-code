import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    const publisher = new RedisEventPublisher({ url: "redis://example" });
    const publisherState = publisher as unknown as {
      initialized: boolean;
      publishClient: { quit: () => Promise<void> };
      subscribeClient: { quit: () => Promise<void> };
    };

    publisherState.initialized = true;
    publisherState.publishClient = {
      quit: () => new Promise<void>(() => {}),
    };
    publisherState.subscribeClient = {
      quit: () => Promise.reject(new Error("quit failed")),
    };

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

    assertEquals(result, { status: "rejected", message: "quit failed" });
  });
});
