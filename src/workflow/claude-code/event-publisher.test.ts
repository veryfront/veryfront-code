import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CallbackEventPublisher,
  MemoryEventPublisher,
  MultiEventPublisher,
  SSEEventPublisher,
} from "./event-publisher.ts";
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
  it("CallbackEventPublisher returns the exact asynchronous delivery", async () => {
    const failure = new Error("callback failed");
    const delivery = Promise.withResolvers<void>();
    const publisher = new CallbackEventPublisher(() => delivery.promise);

    const published = publisher.publish(createErrorEvent());

    assertStrictEquals(published, delivery.promise);
    delivery.reject(failure);
    const rejection = await Promise.resolve(published).then(
      () => undefined,
      (error) => error,
    );
    assertStrictEquals(rejection, failure);
  });

  it("MemoryEventPublisher waits for every asynchronous delivery", async () => {
    const runDelivery = Promise.withResolvers<void>();
    const globalDelivery = Promise.withResolvers<void>();
    const publisher = new MemoryEventPublisher();
    await publisher.subscribe("run-1", () => runDelivery.promise);
    publisher.subscribeAll(() => globalDelivery.promise);

    const published = publisher.publish({ ...createErrorEvent(), runId: "run-1" });
    let settled = false;
    const settlement = Promise.resolve(published).then(() => {
      settled = true;
    });

    await Promise.resolve();
    assertEquals(settled, false);
    runDelivery.resolve();
    await Promise.resolve();
    assertEquals(settled, false);
    globalDelivery.resolve();
    await settlement;
    assertEquals(settled, true);
  });

  it("MemoryEventPublisher preserves an asynchronous handler rejection", async () => {
    const failure = new Error("memory handler failed");
    const delivery = Promise.withResolvers<void>();
    void delivery.promise.catch(() => {});
    const publisher = new MemoryEventPublisher();
    await publisher.subscribe("run-1", () => delivery.promise);

    const published = publisher.publish({ ...createErrorEvent(), runId: "run-1" });
    delivery.reject(failure);
    const rejection = await Promise.resolve(published).then(
      () => undefined,
      (error) => error,
    );

    assertStrictEquals(rejection, failure);
  });

  it("MemoryEventPublisher observes an earlier delivery when a later handler throws", async () => {
    const synchronousFailure = new Error("synchronous handler failed");
    const asynchronousFailure = new Error("asynchronous handler failed");
    const delivery = Promise.withResolvers<void>();
    const publisher = new MemoryEventPublisher();
    await publisher.subscribe("run-1", () => delivery.promise);
    await publisher.subscribe("run-1", () => {
      throw synchronousFailure;
    });

    const published = publisher.publish({ ...createErrorEvent(), runId: "run-1" });
    const rejection = await Promise.resolve(published).then(
      () => undefined,
      (error) => error,
    );
    assertStrictEquals(rejection, synchronousFailure);

    delivery.reject(asynchronousFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("MemoryEventPublisher preserves a synchronous failure before asynchronous delivery", async () => {
    const failure = new Error("synchronous handler failed");
    const publisher = new MemoryEventPublisher();
    await publisher.subscribe("run-1", () => {
      throw failure;
    });

    let rejection: unknown;
    try {
      publisher.publish({ ...createErrorEvent(), runId: "run-1" });
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, failure);
  });

  it("MemoryEventPublisher preserves synchronous no-result delivery", async () => {
    const delivered: ClaudeCodeEvent[] = [];
    const publisher = new MemoryEventPublisher();
    await publisher.subscribe("run-1", (event) => {
      delivered.push(event);
    });
    const event = { ...createErrorEvent(), runId: "run-1" };

    const published = publisher.publish(event);

    assertEquals(published, undefined);
    assertEquals(delivered, [event]);
  });

  it("MemoryEventPublisher routes a run-scoped event to that run only", async () => {
    const publisher = new MemoryEventPublisher();
    const one: ClaudeCodeEvent[] = [];
    const two: ClaudeCodeEvent[] = [];
    const all: ClaudeCodeEvent[] = [];
    await publisher.subscribe("run-1", (event) => {
      one.push(event);
    });
    await publisher.subscribe("run-2", (event) => {
      two.push(event);
    });
    publisher.subscribeAll((event) => {
      all.push(event);
    });
    const event = { ...createErrorEvent(), runId: "run-1" };

    await publisher.publish(event);

    assertEquals(two, [], "a run-scoped event must not reach another run's subscribers");
    assertEquals(one, [event], "the owning run's subscriber receives exactly the event");
    assertEquals(all, [event], "global subscribers receive every event once");
  });

  it("MemoryEventPublisher stops delivering to unsubscribed handlers", async () => {
    const delivered: ClaudeCodeEvent[] = [];
    const publisher = new MemoryEventPublisher();
    const unsubscribeRun = await publisher.subscribe("run-1", (event) => {
      delivered.push(event);
    });
    const unsubscribeAll = publisher.subscribeAll((event) => {
      delivered.push(event);
    });
    const first = { ...createErrorEvent(), runId: "run-1" };

    await publisher.publish(first);
    assertEquals(delivered.length, 2, "both handlers receive the first event");

    unsubscribeRun();
    unsubscribeAll();
    await publisher.publish({ ...createErrorEvent(), runId: "run-1" });

    assertEquals(delivered, [first, first], "unsubscribed handlers receive nothing further");
  });

  it("MemoryEventPublisher close detaches every handler", async () => {
    const delivered: ClaudeCodeEvent[] = [];
    const publisher = new MemoryEventPublisher();
    await publisher.subscribe("run-1", (event) => {
      delivered.push(event);
    });
    publisher.subscribeAll((event) => {
      delivered.push(event);
    });

    publisher.close();
    await publisher.publish({ ...createErrorEvent(), runId: "run-1" });

    assertEquals(delivered, [], "close() must clear both handler maps");
  });

  it("SSEEventPublisher keeps its first stream authoritative", async () => {
    const publisher = new SSEEventPublisher();
    const reader = publisher.createStream().getReader();

    assertThrows(
      () => publisher.createStream(),
      Error,
      "already has a stream",
    );
    const pendingRead = reader.read();
    publisher.close();

    assertEquals(await pendingRead, { done: true, value: undefined });
  });

  it("SSEEventPublisher close is terminal before stream creation", () => {
    const publisher = new SSEEventPublisher();

    publisher.close();
    publisher.close();

    assertThrows(
      () => publisher.createStream(),
      Error,
      "is closed",
    );
    assertThrows(
      () => publisher.publish(createErrorEvent()),
      Error,
      "is closed",
    );
  });

  it("SSEEventPublisher cancellation is terminal", async () => {
    const publisher = new SSEEventPublisher();
    const reader = publisher.createStream().getReader();

    await reader.cancel();

    assertThrows(
      () => publisher.createStream(),
      Error,
      "is closed",
    );
    assertThrows(
      () => publisher.publish(createErrorEvent()),
      Error,
      "is closed",
    );
  });

  it("SSEEventPublisher rejects publishing before stream creation", () => {
    const publisher = new SSEEventPublisher();

    assertThrows(
      () => publisher.publish(createErrorEvent()),
      Error,
      "does not have a stream",
    );
  });

  it("SSEEventPublisher emits one SSE record", async () => {
    const publisher = new SSEEventPublisher();
    const reader = publisher.createStream().getReader();
    const event = createErrorEvent();

    publisher.publish(event);
    const record = await reader.read();
    publisher.close();

    assertEquals(record.done, false);
    assertEquals(
      new TextDecoder().decode(record.value),
      `data: ${JSON.stringify(event)}\n\n`,
    );
  });

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

  it("MultiEventPublisher.publish observes earlier delivery after a synchronous failure", async () => {
    const synchronousFailure = new Error("synchronous publish failed");
    const asynchronousFailure = new Error("asynchronous publish failed");
    const delivery = Promise.withResolvers<void>();
    const asynchronousPublisher: ClaudeCodeEventPublisher = {
      publish: () => delivery.promise,
      close: () => {},
    };
    const synchronousPublisher: ClaudeCodeEventPublisher = {
      publish: () => {
        throw synchronousFailure;
      },
      close: () => {},
    };
    const publisher = new MultiEventPublisher(asynchronousPublisher, synchronousPublisher);

    const rejection = await publisher.publish(createErrorEvent()).then(
      () => undefined,
      (error) => error,
    );
    assertStrictEquals(rejection, synchronousFailure);

    delivery.reject(asynchronousFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("MultiEventPublisher.close observes earlier cleanup after a synchronous failure", async () => {
    const synchronousFailure = new Error("synchronous close failed");
    const asynchronousFailure = new Error("asynchronous close failed");
    const cleanup = Promise.withResolvers<void>();
    const asynchronousPublisher: ClaudeCodeEventPublisher = {
      publish: () => {},
      close: () => cleanup.promise,
    };
    const synchronousPublisher: ClaudeCodeEventPublisher = {
      publish: () => {},
      close: () => {
        throw synchronousFailure;
      },
    };
    const publisher = new MultiEventPublisher(asynchronousPublisher, synchronousPublisher);

    const rejection = await publisher.close().then(
      () => undefined,
      (error) => error,
    );
    assertStrictEquals(rejection, synchronousFailure);

    cleanup.reject(asynchronousFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
