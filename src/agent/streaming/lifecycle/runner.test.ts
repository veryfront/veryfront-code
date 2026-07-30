import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { runStreamLifecycle } from "./runner.ts";
import {
  createControllableSignalProvider,
  createScriptedStreamProvider,
  ManualMonotonicClock,
} from "./testing.ts";
import type {
  StreamDiagnosticEvent,
  StreamProviderAdapter,
  StreamProviderError,
  StreamSignal,
  StreamSnapshot,
} from "./types.ts";

describe("runStreamLifecycle", () => {
  it("opens lazily and rejects a second frame consumer", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    assertEquals(provider.openCount, 0);
    const first = run.frames[Symbol.asyncIterator]();
    assertEquals(provider.openCount, 0);
    assertThrows(
      () => run.frames[Symbol.asyncIterator](),
      StreamAlreadyConsumedError,
    );
    await first.next();
    assertEquals(provider.openCount, 1);
  });

  it("keeps outcome pending until frame iteration starts", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    let settled = false;
    void run.outcome.then(() => settled = true);
    await Promise.resolve();
    assertEquals(settled, false);
    await run.frames[Symbol.asyncIterator]().next();
    assertEquals((await run.outcome).status, "failed");
  });

  it("uses pre-aborted source precedence and records phase", async () => {
    const user = new AbortController();
    const parent = new AbortController();
    parent.abort("parent");
    user.abort("user");
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      cancellations: [
        { source: "parent", signal: parent.signal },
        { source: "user", signal: user.signal },
      ],
    });
    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") assertEquals(outcome.source, "user");
    assertEquals(outcome.phase, "cancelled");
    assertEquals(outcome.snapshot.phase, "cancelled");
  });

  it("turns consumer return into one cleanup request", async () => {
    const provider = createScriptedStreamProvider([
      { kind: "protocol", event: { type: "text_content", delta: "hello" } },
    ]);
    const run = runStreamLifecycle({ provider });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(provider.returnCount, 1);
  });

  it("records an abort after run creation but before first next without opening the provider", async () => {
    const controller = new AbortController();
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      cancellations: [{ source: "runtime", signal: controller.signal }],
    });

    controller.abort("runtime stop");
    assertEquals(provider.openCount, 0);
    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;

    assertEquals(provider.openCount, 0);
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") assertEquals(outcome.source, "runtime");
  });

  it("reports cancellation elapsed time relative to the attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const controller = new AbortController();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      cancellations: [{ source: "runtime", signal: controller.signal }],
      policy: {
        clock,
        attemptTimeoutMs: 30_000,
      },
    });

    const pending = run.frames[Symbol.asyncIterator]().next();
    clock.advanceBy(5);
    controller.abort("runtime stop");
    await pending;
    const outcome = await run.outcome;

    assertEquals(outcome.status, "cancelled");
    assertEquals(outcome.elapsedMs, 5);
  });

  it("reports cleanup failure without replacing the committed outcome", async () => {
    const cleanupError = new Error("cleanup sentinel");
    const reported: StreamDiagnosticEvent[] = [];
    const provider = createScriptedStreamProvider([
      { kind: "protocol", event: { type: "text_content", delta: "hello" } },
    ], { returnError: cleanupError });
    const run = runStreamLifecycle({
      provider,
      diagnosticSink: { report: (event) => reported.push(event) },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await Promise.resolve();

    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(reported.map((event) => event.type), [
      "provider_cleanup_failed",
    ]);
    assertEquals(
      JSON.stringify(reported).includes(cleanupError.message),
      false,
    );
  });

  it("reduces a cached provider result when the consumer resumes before the attempt limit", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        statusIntervalMs: 5_000,
        toolInputIdleTimeoutMs: 60_000,
        attemptTimeoutMs: 30_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    const firstRead = iterator.next();
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: {
          type: "tool_input_start",
          toolCallId: "t1",
          toolName: "create_file",
        },
      },
    });
    await firstRead;

    const status = iterator.next();
    clock.advanceBy(5_000);
    await status;
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: {
          type: "tool_input_content",
          toolCallId: "t1",
          delta: '{"path":"a.md"}',
        },
      },
    });
    clock.advanceBy(24_999);
    const cached = await iterator.next();
    assertEquals(cached.value?.class, "semantic");
    assertEquals(cached.value?.event.type, "tool_input_content");
    await iterator.return?.();
  });

  it("can stop before the first read without opening the provider", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.return?.();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(provider.openCount, 0);
    assertEquals(provider.returnCount, 0);
  });

  it("reports early stream end elapsed time relative to a non-zero attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      policy: { clock },
    });

    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    assertEquals(outcome.elapsedMs, 0);
  });

  it("reports provider error elapsed time relative to the attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: { clock, attemptTimeoutMs: 30_000 },
    });

    const pending = run.frames[Symbol.asyncIterator]().next();
    clock.advanceBy(37);
    provider.rejectNext(new Error("provider sentinel"));
    await pending;
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    assertEquals(outcome.elapsedMs, 37);
  });

  it("classifies a synchronous provider open throw as a provider failure", async () => {
    const sentinel = new Error("open failure sentinel");
    const provider = createThrowingProvider({
      openError: sentinel,
      providerError: {
        code: "OPEN_FAILED",
        publicMessage: "Provider open failed",
        retryable: true,
        terminal: false,
      },
    });
    const run = runStreamLifecycle({ provider });

    assertEquals(await run.frames[Symbol.asyncIterator]().next(), {
      done: true,
      value: undefined,
    });
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.source, "provider");
      assertEquals(outcome.error.providerCode, "OPEN_FAILED");
      assertEquals(outcome.error.publicMessage, "Provider open failed");
    }
  });

  it("classifies a synchronous provider iterator throw as a provider failure", async () => {
    const sentinel = new Error("iterator failure sentinel");
    const provider = createThrowingProvider({
      nextError: sentinel,
      providerError: {
        code: "READ_FAILED",
        publicMessage: "Provider read failed",
        retryable: true,
        terminal: false,
      },
    });
    const run = runStreamLifecycle({ provider });

    assertEquals(await run.frames[Symbol.asyncIterator]().next(), {
      done: true,
      value: undefined,
    });
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.source, "provider");
      assertEquals(outcome.error.providerCode, "READ_FAILED");
      assertEquals(outcome.error.publicMessage, "Provider read failed");
    }
  });

  it("classifies a synchronous provider decode throw as a provider failure", async () => {
    const sentinel = new Error("decode failure sentinel");
    const provider = createThrowingProvider({
      values: ["part"],
      decodeError: sentinel,
      providerError: {
        code: "DECODE_FAILED",
        publicMessage: "Provider decode failed",
        retryable: true,
        terminal: false,
      },
    });
    const run = runStreamLifecycle({ provider });

    assertEquals(await run.frames[Symbol.asyncIterator]().next(), {
      done: true,
      value: undefined,
    });
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.source, "provider");
      assertEquals(outcome.error.providerCode, "DECODE_FAILED");
      assertEquals(outcome.error.publicMessage, "Provider decode failed");
    }
  });

  it("uses a sanitized provider failure when classification throws", async () => {
    const provider = createThrowingProvider({
      openError: new Error("raw open sentinel"),
      classifyError: new Error("raw classify sentinel"),
    });
    const run = runStreamLifecycle({ provider });

    assertEquals(await run.frames[Symbol.asyncIterator]().next(), {
      done: true,
      value: undefined,
    });
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.source, "provider");
      assertEquals(outcome.error.providerCode, "PROVIDER_STREAM_ERROR");
      assertEquals(outcome.error.publicMessage, "Provider stream failed");
      assertEquals(JSON.stringify(outcome).includes("raw open sentinel"), false);
      assertEquals(JSON.stringify(outcome).includes("raw classify sentinel"), false);
    }
  });

  it("emits frame elapsed time relative to a non-zero attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: { clock, attemptTimeoutMs: 30_000 },
    });
    const iterator = run.frames[Symbol.asyncIterator]();

    const first = iterator.next();
    clock.advanceBy(12);
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: { type: "text_content", delta: "hello" },
      },
    });
    const frame = await first;

    assertEquals(frame.value?.class, "semantic");
    assertEquals(frame.value?.elapsedMs, 12);
    await iterator.return?.();
  });
});

function createThrowingProvider(input: {
  values?: readonly unknown[];
  openError?: unknown;
  nextError?: unknown;
  decodeError?: unknown;
  classifyError?: unknown;
  providerError?: StreamProviderError;
}): StreamProviderAdapter<unknown> {
  const providerError = input.providerError ?? {
    code: "PROVIDER_STREAM_ERROR",
    publicMessage: "Provider stream failed",
    retryable: true,
    terminal: false,
  };
  return {
    open() {
      if (input.openError !== undefined) throw input.openError;
      if (input.nextError !== undefined) {
        return {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<unknown>> {
                throw input.nextError;
              },
            };
          },
        };
      }
      return {
        async *[Symbol.asyncIterator]() {
          for (const value of input.values ?? []) yield value;
        },
      };
    },
    decode(_part: unknown, _snapshot: Readonly<StreamSnapshot>): readonly StreamSignal[] {
      if (input.decodeError !== undefined) throw input.decodeError;
      return [];
    },
    classifyError() {
      if (input.classifyError !== undefined) throw input.classifyError;
      return providerError;
    },
  };
}
