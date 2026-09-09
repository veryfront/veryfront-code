import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorOperation } from "./channel.ts";
import {
  encodeExecutorFrame,
  EXECUTOR_MAX_FRAME_BYTES,
  type ExecutorFrame,
  type ExecutorMessage,
  readExecutorFrames,
} from "./protocol.ts";

const binding = { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" };

function rawFrame(value: unknown): Uint8Array {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const bytes = new Uint8Array(data.byteLength + 4);
  new DataView(bytes.buffer).setUint32(0, data.byteLength);
  bytes.set(data, 4);
  return bytes;
}

function envelope(message: ExecutorMessage, sequence = 0): ExecutorFrame {
  return { version: 1, binding, sequence, message };
}

function endpoint(
  operations?: ReadonlyMap<string, ExecutorOperation>,
  cancellationTimeoutMs = 100,
  maxRetainedPayloadBytes?: number,
) {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const written: ExecutorFrame[] = [];
  const channel = createExecutorChannel({
    binding,
    operations,
    cancellationTimeoutMs,
    maxRetainedPayloadBytes,
    transport: {
      readable: new ReadableStream({
        start(controller) {
          input = controller;
        },
      }),
      writable: new WritableStream({
        write(bytes) {
          const frame = JSON.parse(new TextDecoder().decode(bytes.subarray(4))) as ExecutorFrame;
          written.push(frame);
          if (frame.message.type === "release") {
            const id = frame.message.id;
            queueMicrotask(() => {
              if (!channel.signal.aborted) send({ type: "released", id });
            });
          }
        },
      }),
    },
  });
  let sequence = 0;
  const send = (message: ExecutorMessage) => input.enqueue(rawFrame(envelope(message, sequence++)));
  return { channel, input, written, send };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("executor byte protocol", () => {
  it("reads native transport bytes without consulting an overridden reader method", async () => {
    const frame = envelope({
      type: "data",
      id: 1,
      index: 0,
      value: { text: "Synthetic private frame" },
    });
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeExecutorFrame(frame));
        controller.close();
      },
    }).getReader();
    const original = reader.read;
    let reads = 0;
    Object.defineProperty(reader, "read", {
      value: () => {
        reads++;
        return original.call(reader);
      },
    });
    try {
      assertEquals(await Array.fromAsync(readExecutorFrames(reader)), [frame]);
      assertEquals(reads, 0);
    } finally {
      reader.releaseLock();
    }
  });

  it("decodes fragmented prefixes, split UTF-8 and coalesced frames", async () => {
    const frames = [
      envelope({ type: "hello" }),
      envelope({ type: "data", id: 1, index: 0, value: "héllo" }, 1),
    ];
    const joined = new Uint8Array(
      frames.reduce((length, frame) => length + rawFrame(frame).length, 0),
    );
    let offset = 0;
    for (const frame of frames) {
      const bytes = rawFrame(frame);
      joined.set(bytes, offset);
      offset += bytes.length;
    }
    for (const split of [1, 2, 3, 4, 31, joined.length]) {
      const input = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < joined.length; index += split) {
            controller.enqueue(joined.slice(index, index + split));
          }
          controller.close();
        },
      });
      const result = [];
      for await (const frame of readExecutorFrames(input.getReader())) result.push(frame);
      assertEquals(result, frames);
    }
  });

  it("rejects oversized frames, deep JSON, and values JSON would coerce", () => {
    let deep: unknown = null;
    for (let index = 0; index < 130; index++) deep = [deep];
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const inherited = Object.create({ property: "inherited" });
    inherited.value = "synthetic";
    for (
      const value of [
        undefined,
        NaN,
        Infinity,
        new Date(0),
        1n,
        () => 1,
        { toJSON: () => "synthetic" },
        inherited,
        cycle,
        deep,
      ]
    ) {
      assertThrows(
        () =>
          encodeExecutorFrame(
            envelope({ type: "data", id: 1, index: 0, value } as ExecutorMessage),
          ),
        TypeError,
      );
    }
    assertThrows(
      () =>
        encodeExecutorFrame(
          envelope({ type: "data", id: 1, index: 0, value: "x".repeat(EXECUTOR_MAX_FRAME_BYTES) }),
        ),
      TypeError,
      "byte limit",
    );
  });

  const badHello: [string, unknown, string][] = [
    ["unsupported version", { ...envelope({ type: "hello" }), version: 2 }, "Unsupported"],
    ["allocation", {
      ...envelope({ type: "hello" }),
      binding: { ...binding, allocationId: "other-allocation" },
    }, "identity"],
    [
      "generation",
      { ...envelope({ type: "hello" }), binding: { ...binding, generation: 2 } },
      "identity",
    ],
    ["invocation", {
      ...envelope({ type: "hello" }),
      binding: { ...binding, invocationId: "other-invocation" },
    }, "identity"],
    ["missing identity", { version: 1, sequence: 0, message: { type: "hello" } }, "schema"],
    ["unknown fields", { ...envelope({ type: "hello" }), unexpected: true }, "schema"],
    ["negative sequence", { ...envelope({ type: "hello" }), sequence: -1 }, "schema"],
    ["first sequence", envelope({ type: "hello" }, 1), "sequence"],
    ["missing hello", envelope({ type: "cancel", id: 1 }), "hello"],
  ];
  for (const [label, frame, diagnostic] of badHello) {
    it(`closes before readiness for invalid ${label}`, async () => {
      const { channel, input } = endpoint();
      input.enqueue(rawFrame(frame));
      await assertRejects(() => channel.ready, Error, diagnostic);
      assertEquals(channel.signal.aborted, true);
      await channel.closed;
    });
  }

  for (
    const kind of [
      "zero-length",
      "oversized-prefix",
      "oversized-chunk",
      "invalid-json",
      "invalid-utf8",
      "truncated",
    ] as const
  ) {
    it(`closes on ${kind} byte framing`, async () => {
      const { channel, input } = endpoint();
      let bytes = new Uint8Array(4);
      if (kind === "oversized-prefix") {
        new DataView(bytes.buffer).setUint32(0, EXECUTOR_MAX_FRAME_BYTES);
      }
      if (kind === "oversized-chunk") bytes = new Uint8Array(EXECUTOR_MAX_FRAME_BYTES + 1);
      if (kind === "invalid-json") bytes = new Uint8Array([0, 0, 0, 1, 123]);
      if (kind === "invalid-utf8") bytes = new Uint8Array([0, 0, 0, 1, 255]);
      if (kind === "truncated") bytes = new Uint8Array([0, 0, 0, 5, 123]);
      input.enqueue(bytes);
      if (kind === "truncated") input.close();
      await channel.closed;
      assertEquals(channel.signal.aborted, true);
    });
  }

  for (const type of ["cancel", "release", "released", "credit", "data", "end"] as const) {
    it(`closes on unknown ${type} correlation`, async () => {
      const { channel, send } = endpoint();
      send({ type: "hello" });
      await channel.ready;
      send(
        type === "credit"
          ? { type, id: 1, consumed: 1 }
          : type === "data"
          ? { type, id: 1, index: 0, value: null }
          : { type, id: 1 },
      );
      const error = await channel.closed;
      assert(error.message.includes("unknown"));
    });
  }

  it("rejects a replayed global sequence after a valid hello", async () => {
    const { channel, input, send } = endpoint();
    send({ type: "hello" });
    await channel.ready;
    input.enqueue(
      rawFrame(
        envelope({
          type: "request",
          id: 1,
          operation: "missing",
          mode: "unary",
          timeoutMs: 100,
          value: null,
        }, 0),
      ),
    );
    assert((await channel.closed).message.includes("sequence"));
  });

  for (const failure of ["sequence", "credit", "terminal"] as const) {
    it(`rejects a stream ${failure} violation`, async () => {
      const { channel, send } = endpoint();
      send({ type: "hello" });
      await channel.ready;
      const stream = channel.stream("items", null);
      await tick();
      if (failure === "sequence") send({ type: "data", id: 1, index: 1, value: null });
      if (failure === "credit") {
        for (let index = 0; index < 9; index++) send({ type: "data", id: 1, index, value: null });
      }
      if (failure === "terminal") {
        send({ type: "data", id: 1, index: 0, value: null });
        send({ type: "end", id: 1 });
        send({ type: "end", id: 1 });
      }
      await channel.closed;
      await assertRejects(() => stream.next());
    });
  }

  it("accepts bounded results already in flight after cancellation until terminal release", async () => {
    const { channel, send, written } = endpoint();
    send({ type: "hello" });
    await channel.ready;
    const controller = new AbortController();
    const stream = channel.stream("items", null, { signal: controller.signal });
    await tick();
    controller.abort();
    for (let index = 0; index < 8; index++) send({ type: "data", id: 1, index, value: null });
    send({ type: "end", id: 1 });
    await tick();
    await assertRejects(() => stream.next(), Error, "cancelled");
    assertEquals(channel.signal.aborted, false);
    assertEquals(written.at(-1)?.message, { type: "release", id: 1 });
    channel.close();
  });

  it("closes for unacknowledged cancellation", async () => {
    const { channel, send } = endpoint(undefined, 10);
    send({ type: "hello" });
    await channel.ready;
    const controller = new AbortController();
    const result = channel.request("wait", null, { signal: controller.signal });
    const rejected = assertRejects(() => result);
    await tick();
    controller.abort();
    await rejected;
    assert((await channel.closed).message.includes("cancellation deadline"));
  });

  it("rejects pending calls and aborts handlers when any frame is malformed", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const { channel, send, input } = endpoint(
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
    send({ type: "hello" });
    await channel.ready;
    const result = channel.request("remote", null);
    const rejected = assertRejects(() => result);
    send({
      type: "request",
      id: 1,
      operation: "wait",
      mode: "unary",
      timeoutMs: 1000,
      value: null,
    });
    const signal = await started.promise;
    input.enqueue(rawFrame({ invalid: true }));
    await rejected;
    assertEquals(signal.aborted, true);
    await channel.closed;
  });

  it("replaces transport error details even when they resemble protocol diagnostics", async () => {
    const { channel, input, send } = endpoint();
    send({ type: "hello" });
    await channel.ready;
    input.error(new Error("Executor synthetic private transport detail"));
    assertEquals((await channel.closed).message, "Executor channel read failed");
  });

  it("closes when a peer never releases a completed incoming call", async () => {
    const { channel, send } = endpoint(
      new Map([
        ["echo", { mode: "unary", handle: (value) => value }],
      ]),
      10,
    );
    send({ type: "hello" });
    await channel.ready;
    send({ type: "request", id: 1, operation: "echo", mode: "unary", timeoutMs: 10, value: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    try {
      assertEquals(channel.signal.aborted, true);
    } finally {
      channel.close();
    }
  });

  for (
    const kind of [
      "duplicate-request",
      "early-release",
      "early-credit",
      "duplicate-credit",
    ] as const
  ) {
    it(`closes for ${kind} on an incoming call`, async () => {
      const { channel, send } = endpoint(
        new Map([
          ["items", {
            mode: "stream",
            handle: async function* (_, { signal }) {
              if (kind === "early-credit") {
                await new Promise<void>((resolve) =>
                  signal.addEventListener("abort", () => resolve(), { once: true })
                );
              }
              for (let value = 0; value < 20; value++) yield value;
            },
          }],
        ]),
      );
      send({ type: "hello" });
      await channel.ready;
      const request: ExecutorMessage = {
        type: "request",
        id: 1,
        operation: "items",
        mode: "stream",
        timeoutMs: 1000,
        value: null,
      };
      send(request);
      if (kind === "early-credit") send({ type: "credit", id: 1, consumed: 1 });
      else {
        await tick();
        if (kind === "duplicate-request") send(request);
        if (kind === "early-release") send({ type: "release", id: 1 });
        if (kind === "duplicate-credit") {
          send({ type: "credit", id: 1, consumed: 1 });
          send({ type: "credit", id: 1, consumed: 1 });
        }
      }
      await channel.closed;
      assertEquals(channel.signal.aborted, true);
    });
  }

  it("accepts credit crossing completion before the final release", async () => {
    const { channel, send } = endpoint(
      new Map([
        ["one", {
          mode: "stream",
          handle: async function* () {
            yield 1;
          },
        }],
      ]),
    );
    send({ type: "hello" });
    await channel.ready;
    send({
      type: "request",
      id: 1,
      operation: "one",
      mode: "stream",
      timeoutMs: 1000,
      value: null,
    });
    await tick();
    send({ type: "credit", id: 1, consumed: 1 });
    send({ type: "release", id: 1 });
    await tick();
    assertEquals(channel.signal.aborted, false);
    channel.close();
  });

  it("closes when incoming concurrency exceeds the configured bound", async () => {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const channel = createExecutorChannel({
      binding,
      maxConcurrentCalls: 1,
      transport: {
        readable: new ReadableStream({
          start(controller) {
            input = controller;
          },
        }),
        writable: new WritableStream(),
      },
    });
    input.enqueue(rawFrame(envelope({ type: "hello" })));
    await channel.ready;
    for (const id of [1, 2]) {
      input.enqueue(
        rawFrame(
          envelope({
            type: "request",
            id,
            operation: "missing",
            mode: "unary",
            timeoutMs: 1000,
            value: null,
          }, id),
        ),
      );
    }
    assert((await channel.closed).message.includes("concurrent"));
  });

  it("bounds handshake time without sending operation input before readiness", async () => {
    const written: ExecutorFrame[] = [];
    const channel = createExecutorChannel({
      binding,
      handshakeTimeoutMs: 10,
      transport: {
        readable: new ReadableStream(),
        writable: new WritableStream({
          write(bytes) {
            written.push(JSON.parse(new TextDecoder().decode(bytes.subarray(4))));
          },
        }),
      },
    });
    await assertRejects(() => channel.request("echo", { synthetic: true }), Error, "handshake");
    assertEquals(written.map((frame) => frame.message.type), ["hello"]);
    await channel.closed;
  });

  it("closes instead of accumulating writes behind a stalled transport", async () => {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const write = Promise.withResolvers<void>();
    const channel = createExecutorChannel({
      binding,
      operations: new Map([["large", { mode: "unary", handle: () => "x".repeat(900_000) }]]),
      transport: {
        readable: new ReadableStream({
          start(controller) {
            input = controller;
          },
        }),
        writable: new WritableStream({ write: () => write.promise }),
      },
    });
    input.enqueue(rawFrame(envelope({ type: "hello" })));
    await channel.ready;
    for (let id = 1; id <= 10; id++) {
      input.enqueue(
        rawFrame(
          envelope({
            type: "request",
            id,
            operation: "large",
            mode: "unary",
            timeoutMs: 1000,
            value: null,
          }, id),
        ),
      );
    }
    try {
      assert((await channel.closed).message.includes("write queue limit"));
    } finally {
      write.resolve();
    }
  });

  it("keeps a noncooperative handler counted and closes after its cancellation grace", async () => {
    const finish = Promise.withResolvers<null>();
    const { channel, send } = endpoint(
      new Map([
        ["wait", { mode: "unary", handle: () => finish.promise }],
      ]),
      10,
    );
    send({ type: "hello" });
    await channel.ready;
    send({
      type: "request",
      id: 1,
      operation: "wait",
      mode: "unary",
      timeoutMs: 1000,
      value: null,
    });
    await tick();
    send({ type: "cancel", id: 1 });
    await tick();
    send({ type: "release", id: 1 });
    try {
      assert((await channel.closed).message.includes("handler cancellation"));
    } finally {
      finish.resolve(null);
    }
  });

  it("bounds terminal release writes and rejects the call when release stalls", async () => {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const stalledWrite = Promise.withResolvers<void>();
    const channel = createExecutorChannel({
      binding,
      cancellationTimeoutMs: 10,
      transport: {
        readable: new ReadableStream({
          start(controller) {
            input = controller;
          },
        }),
        writable: new WritableStream({
          write(bytes) {
            const frame = JSON.parse(new TextDecoder().decode(bytes.subarray(4))) as ExecutorFrame;
            if (frame.message.type === "release") return stalledWrite.promise;
          },
        }),
      },
    });
    input.enqueue(rawFrame(envelope({ type: "hello" })));
    await channel.ready;
    const outcome = channel.request("echo", null).then(() => "resolved", () => "rejected");
    await tick();
    input.enqueue(rawFrame(envelope({ type: "data", id: 1, index: 0, value: null }, 1)));
    input.enqueue(rawFrame(envelope({ type: "end", id: 1 }, 2)));
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    try {
      assertEquals(channel.signal.aborted, true);
      assertEquals(await outcome, "rejected");
    } finally {
      channel.close();
      stalledWrite.resolve();
    }
  });

  it("bounds aggregate result payloads across otherwise valid stream windows", async () => {
    const { channel, send } = endpoint(undefined, 100, 1024);
    send({ type: "hello" });
    await channel.ready;
    const streams = Array.from({ length: 3 }, () => channel.stream("items", null));
    await tick();
    for (let id = 1; id <= 3; id++) send({ type: "data", id, index: 0, value: "x".repeat(400) });
    assert((await channel.closed).message.includes("retained payload budget"));
    for (const stream of streams) await assertRejects(() => stream.next());
  });

  it("bounds aggregate incoming request payloads until handlers settle", async () => {
    const signals: AbortSignal[] = [];
    const { channel, send } = endpoint(
      new Map([
        ["wait", {
          mode: "unary",
          handle: async (_, { signal }) => {
            signals.push(signal);
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true })
            );
            return null;
          },
        }],
      ]),
      100,
      1024,
    );
    send({ type: "hello" });
    await channel.ready;
    for (let id = 1; id <= 3; id++) {
      send({
        type: "request",
        id,
        operation: "wait",
        mode: "unary",
        timeoutMs: 1000,
        value: "x".repeat(400),
      });
    }
    assert((await channel.closed).message.includes("retained payload budget"));
    assertEquals(signals.length, 2);
    assert(signals.every((signal) => signal.aborted));
  });

  it("shares one retained payload budget between request and response directions", async () => {
    const { channel, send } = endpoint(
      new Map([
        ["wait", {
          mode: "unary",
          handle: async (_, { signal }) => {
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true })
            );
            return null;
          },
        }],
      ]),
      100,
      1024,
    );
    send({ type: "hello" });
    await channel.ready;
    const stream = channel.stream("items", null);
    await tick();
    send({
      type: "request",
      id: 1,
      operation: "wait",
      mode: "unary",
      timeoutMs: 1000,
      value: "x".repeat(400),
    });
    send({ type: "data", id: 1, index: 0, value: "x".repeat(400) });
    send({ type: "data", id: 1, index: 1, value: "x".repeat(400) });
    assert((await channel.closed).message.includes("retained payload budget"));
    await assertRejects(() => stream.next());
  });

  it("returns result budget on consumption and cancellation", async () => {
    const { channel, send } = endpoint(undefined, 100, 1024);
    send({ type: "hello" });
    await channel.ready;
    const stream = channel.stream("items", null);
    await tick();
    for (let index = 0; index < 6; index++) {
      send({ type: "data", id: 1, index, value: "x".repeat(600) });
      assertEquals((await stream.next()).value, "x".repeat(600));
    }
    send({ type: "data", id: 1, index: 6, value: "x".repeat(600) });
    await tick();
    const returning = stream.return!();
    send({ type: "end", id: 1 });
    await returning;
    const next = channel.stream("items", null);
    await tick();
    send({ type: "data", id: 2, index: 0, value: "x".repeat(600) });
    send({ type: "end", id: 2 });
    assertEquals((await next.next()).value, "x".repeat(600));
    assertEquals(channel.signal.aborted, false);
    channel.close();
  });

  it("releases cancelled requests before readiness without retaining callbacks or payload budget", async () => {
    const channel = createExecutorChannel({
      binding,
      maxConcurrentCalls: 1,
      maxRetainedPayloadBytes: 1024,
      transport: { readable: new ReadableStream(), writable: new WritableStream() },
    });
    try {
      for (let index = 0; index < 20; index++) {
        const controller = new AbortController();
        const result = channel.request("wait", "x".repeat(600), { signal: controller.signal });
        controller.abort();
        await assertRejects(() => result, Error, "cancelled");
      }
      assertEquals(channel.signal.aborted, false);
    } finally {
      channel.close();
    }
  });
});
