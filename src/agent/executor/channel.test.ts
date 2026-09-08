import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorOperation } from "./channel.ts";
import { EXECUTOR_STREAM_WINDOW, type ExecutorBinding } from "./protocol.ts";

const binding: ExecutorBinding = {
  allocationId: "allocation-test",
  generation: 1,
  invocationId: "invocation-test",
};

function pair(
  operations: ReadonlyMap<string, ExecutorOperation> = new Map(),
  maxConcurrentCalls = 32,
  callerOperations: ReadonlyMap<string, ExecutorOperation> = new Map(),
) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const caller = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
    maxConcurrentCalls,
    operations: callerOperations,
  });
  const receiver = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
    maxConcurrentCalls,
  });
  return { caller, receiver };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("executor channel", () => {
  it("supports independently registered operations in both directions", async () => {
    const { caller, receiver } = pair(
      new Map([
        ["relay", { mode: "unary", handle: (input) => receiver.request("double", input) }],
      ]),
      2,
      new Map([
        ["double", {
          mode: "unary",
          handle: (input) => {
            if (typeof input !== "number") throw new Error("Expected numeric input");
            return input * 2;
          },
        }],
      ]),
    );
    try {
      assertEquals(await caller.request("relay", 3), 6);
      assertEquals(await receiver.request("double", 4), 8);
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("correlates concurrent calls and binds handler context to one invocation", async () => {
    const { caller, receiver } = pair(
      new Map([
        ["echo", {
          mode: "unary",
          handle: (value, context) => {
            assertEquals(context.binding, binding);
            assert(context.deadline > Date.now());
            assertEquals(context.signal.aborted, false);
            return value;
          },
        }],
      ]),
    );
    try {
      await Promise.all([caller.ready, receiver.ready]);
      assertEquals(
        await Promise.all([
          caller.request("echo", { item: 1 }),
          caller.request("echo", ["two", null]),
        ]),
        [{ item: 1 }, ["two", null]],
      );
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("registers operations explicitly and keeps handler failures out of replies", async () => {
    const { caller, receiver } = pair(
      new Map([
        ["fail", {
          mode: "unary",
          handle: () => {
            throw new Error("private synthetic detail");
          },
        }],
      ]),
    );
    try {
      await assertRejects(() => caller.request("missing", null), Error, "operation-not-found");
      await assertRejects(() => caller.request("fail", null), Error, "operation-failed");
      assertEquals(caller.signal.aborted, false);
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("stops producing at the credit window and returns credit only on consumption", async () => {
    let produced = 0;
    const { caller, receiver } = pair(
      new Map([
        ["items", {
          mode: "stream",
          handle: async function* () {
            for (let index = 0; index < 20; index++) {
              produced++;
              yield index;
            }
          },
        }],
      ]),
    );
    try {
      const stream = caller.stream("items", null);
      await tick();
      assertEquals(produced, EXECUTOR_STREAM_WINDOW);
      assertEquals(await stream.next(), { done: false, value: 0 });
      await tick();
      assertEquals(produced, EXECUTOR_STREAM_WINDOW + 1);
      const values = [0];
      for await (const value of stream) values.push(value as number);
      assertEquals(values, Array.from({ length: 20 }, (_, index) => index));
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("counts completed but unread streams against admission limits", async () => {
    const { caller, receiver } = pair(
      new Map([
        ["one", {
          mode: "stream",
          handle: async function* () {
            yield 1;
          },
        }],
      ]),
      1,
    );
    try {
      const stream = caller.stream("one", null);
      await tick();
      await assertRejects(() => caller.request("missing", null), Error, "concurrent");
      assertEquals(await stream.next(), { done: false, value: 1 });
      assertEquals(await stream.next(), { done: true, value: undefined });
      await assertRejects(() => caller.request("missing", null), Error, "operation-not-found");
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("propagates per-call abort while retaining the channel", async () => {
    const observed = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const { caller, receiver } = pair(
      new Map([
        ["wait", {
          mode: "unary",
          handle: async (_, { signal }) => {
            started.resolve();
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => {
                observed.resolve();
                resolve();
              }, { once: true });
            });
            return null;
          },
        }],
      ]),
    );
    try {
      const controller = new AbortController();
      const result = caller.request("wait", null, { signal: controller.signal });
      const rejected = assertRejects(() => result, Error, "cancelled");
      await started.promise;
      controller.abort();
      await Promise.all([rejected, observed.promise]);
      await tick();
      assertEquals(caller.signal.aborted, false);
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("aborts handlers on deadline and channel disconnect", async () => {
    for (const disconnect of [false, true]) {
      const started = Promise.withResolvers<AbortSignal>();
      const { caller, receiver } = pair(
        new Map([
          ["wait", {
            mode: "unary",
            handle: async (_, { signal }) => {
              started.resolve(signal);
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), { once: true })
              );
              return null;
            },
          }],
        ]),
      );
      try {
        const result = caller.request("wait", null, { timeoutMs: disconnect ? 1_000 : 30 });
        const rejected = assertRejects(() => result);
        const signal = await started.promise;
        if (disconnect) receiver.close();
        await rejected;
        await tick();
        assertEquals(signal.aborted, true);
        if (disconnect) await assertRejects(() => caller.request("wait", null), Error, "closed");
      } finally {
        caller.close();
        await receiver.closed;
      }
    }
  });

  it("cancels a stream when the consumer exits", async () => {
    const aborted = Promise.withResolvers<void>();
    const { caller, receiver } = pair(
      new Map([
        ["items", {
          mode: "stream",
          handle: async function* (_, { signal }) {
            signal.addEventListener("abort", () => aborted.resolve(), { once: true });
            while (!signal.aborted) yield 1;
          },
        }],
      ]),
    );
    try {
      for await (const _ of caller.stream("items", null)) break;
      await aborted.promise;
      await tick();
      assertEquals(caller.signal.aborted, false);
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("rejects invalid handler output without exposing its serialization detail", async () => {
    const { caller, receiver } = pair(
      new Map([
        ["invalid", { mode: "unary", handle: () => undefined as unknown as null }],
      ]),
    );
    try {
      await assertRejects(() => caller.request("invalid", null), Error, "operation-failed");
      assertEquals(caller.signal.aborted, false);
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("retains the deadline while a completed stream remains unread", async () => {
    const { caller, receiver } = pair(
      new Map([
        ["one", {
          mode: "stream",
          handle: async function* () {
            yield 1;
          },
        }],
      ]),
    );
    try {
      const stream = caller.stream("one", null, { timeoutMs: 10 });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      await assertRejects(() => stream.next(), Error, "deadline");
      assertEquals(caller.signal.aborted, false);
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("handles channel closure from operation completion cleanup", async () => {
    const channels = pair(
      new Map([
        ["finish", {
          mode: "unary",
          handle: (_, { signal }) => {
            signal.addEventListener("abort", () => receiver.close(), { once: true });
            return null;
          },
        }],
      ]),
    );
    const receiver = channels.receiver;
    const outcome = channels.caller.request("finish", null).then(
      () => "resolved",
      () => "rejected",
    );
    await receiver.closed;
    assertEquals(await outcome, "rejected");
    channels.caller.close();
  });

  it("waits for cooperative cleanup acknowledgement before reusing a call slot", async () => {
    const cleanup = Promise.withResolvers<void>();
    const cleaning = Promise.withResolvers<void>();
    const { caller, receiver } = pair(
      new Map([
        ["items", {
          mode: "stream",
          handle: async function* () {
            try {
              while (true) yield 1;
            } finally {
              cleaning.resolve();
              await cleanup.promise;
            }
          },
        }],
        ["echo", { mode: "unary", handle: (value) => value }],
      ]),
      1,
    );
    try {
      const stream = caller.stream("items", null);
      await stream.next();
      const returning = stream.return!();
      await cleaning.promise;
      await assertRejects(() => caller.request("echo", null), Error, "concurrent");
      assertEquals(caller.signal.aborted, false);
      assertEquals(receiver.signal.aborted, false);
      cleanup.resolve();
      await returning;
      assertEquals(await caller.request("echo", 3), 3);
    } finally {
      cleanup.resolve();
      caller.close();
      await receiver.closed;
    }
  });

  it("does not schedule cancellation when returning a stream after channel closure", async () => {
    const started = Promise.withResolvers<void>();
    const { caller, receiver } = pair(
      new Map([
        ["wait", {
          mode: "stream",
          handle: async function* (_, { signal }) {
            started.resolve();
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
            yield null;
          },
        }],
      ]),
    );
    try {
      const stream = caller.stream("wait", null);
      const pendingRead = assertRejects(() => stream.next(), Error, "Executor channel closed");
      await started.promise;
      caller.close();
      await pendingRead;
      await assertRejects(() => stream.return!(), Error, "Executor channel closed");
    } finally {
      caller.close();
      await receiver.closed;
    }
  });

  it("retains settlement until an aborted handler and owned I/O finish", async () => {
    const finish = Promise.withResolvers<null>();
    const started = Promise.withResolvers<void>();
    const { caller, receiver } = pair(
      new Map([
        ["wait", {
          mode: "unary",
          handle: () => {
            started.resolve();
            return finish.promise;
          },
        }],
      ]),
    );
    const rejected = assertRejects(() => caller.request("wait", null));
    await started.promise;
    receiver.close();
    await Promise.all([caller.closed, receiver.closed, rejected]);
    try {
      let settled = false;
      void receiver.settled.then(() => {
        settled = true;
      });
      await tick();
      assertEquals(settled, false);
      finish.resolve(null);
      await Promise.all([caller.settled, receiver.settled]);
      assertEquals(settled, true);
    } finally {
      finish.resolve(null);
      caller.close();
      receiver.close();
    }
  });

  for (const pendingSide of ["read", "write"] as const) {
    it(`joins pending ${pendingSide} transport cleanup after prompt closure`, async () => {
      const finish = Promise.withResolvers<void>();
      const channel = createExecutorChannel({
        binding,
        transport: {
          readable: new ReadableStream({
            cancel: () => pendingSide === "read" ? finish.promise : undefined,
          }),
          writable: new WritableStream({
            write: () => pendingSide === "write" ? finish.promise : undefined,
          }),
        },
      });
      await tick();
      channel.close();
      await channel.closed;
      let settled = false;
      void channel.settled.then(() => {
        settled = true;
      });
      await tick();
      assertEquals(settled, false);
      finish.resolve();
      await channel.settled;
      assertEquals(settled, true);
    });
  }

  it("joins asynchronous stream iterator cleanup after channel closure", async () => {
    const cleaning = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const { caller, receiver } = pair(
      new Map([
        ["items", {
          mode: "stream",
          handle: async function* () {
            try {
              while (true) yield 1;
            } finally {
              cleaning.resolve();
              await finish.promise;
            }
          },
        }],
      ]),
    );
    const stream = caller.stream("items", null);
    await stream.next();
    receiver.close();
    await Promise.all([caller.closed, receiver.closed, cleaning.promise]);
    let settled = false;
    void receiver.settled.then(() => {
      settled = true;
    });
    await tick();
    try {
      assertEquals(settled, false);
      finish.resolve();
      await Promise.all([caller.settled, receiver.settled]);
      assertEquals(settled, true);
    } finally {
      finish.resolve();
      caller.close();
      receiver.close();
    }
  });
});
