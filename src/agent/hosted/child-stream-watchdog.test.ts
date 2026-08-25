import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { waitFor } from "#veryfront/testing/deno-compat";
import {
  composeAbortSignals,
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  HostedChildStreamIdleTimeoutError,
  resolveHostedChildPromiseWithTimeout,
  resolveHostedChildStreamWatchdogState,
  withHostedChildStreamIdleTimeout,
} from "./child-stream-watchdog.ts";

const BASE_INPUT = {
  activeToolCallId: null,
  completedToolResults: 0,
  idleTimeoutMs: 45_000,
  activeToolTimeoutMs: 300_000,
  postToolIdleTimeoutMs: 120_000,
};

/** Yield one event loop turn so a pending unhandled rejection has a chance to surface. */
async function flushEventLoop(): Promise<void> {
  let ticked = false;
  globalThis.setTimeout(() => {
    ticked = true;
  }, 0);
  await waitFor(() => ticked);
}

Deno.test("resolveHostedChildStreamWatchdogState returns tool_running when a tool is active", () => {
  const state = resolveHostedChildStreamWatchdogState({
    ...BASE_INPUT,
    activeToolCallId: "tc-1",
  });
  assertEquals(state, { phase: "tool_running", timeoutMs: 300_000 });
});

Deno.test("resolveHostedChildStreamWatchdogState returns post_tool_idle when tools completed", () => {
  const state = resolveHostedChildStreamWatchdogState({
    ...BASE_INPUT,
    completedToolResults: 3,
  });
  assertEquals(state, { phase: "post_tool_idle", timeoutMs: 120_000 });
});

Deno.test("resolveHostedChildStreamWatchdogState returns generic_idle when no tools are running", () => {
  const state = resolveHostedChildStreamWatchdogState(BASE_INPUT);
  assertEquals(state, { phase: "generic_idle", timeoutMs: 45_000 });
});

Deno.test("HostedChildStreamIdleTimeoutError carries timeout state", () => {
  const error = new HostedChildStreamIdleTimeoutError({
    phase: "generic_idle",
    timeoutMs: 45_000,
  });
  assertEquals(error.name, "HostedChildStreamIdleTimeoutError");
  assert(error.message.includes("45s"));
  assertEquals(error.phase, "generic_idle");
  assertEquals(error.timeoutMs, 45_000);
});

Deno.test("composeAbortSignals returns undefined without active signals", () => {
  assertEquals(composeAbortSignals([]), undefined);
  assertEquals(composeAbortSignals([undefined, undefined]), undefined);
});

Deno.test("composeAbortSignals returns the single active signal", () => {
  const controller = new AbortController();
  assertEquals(composeAbortSignals([controller.signal]), controller.signal);
  assertEquals(composeAbortSignals([undefined, controller.signal, undefined]), controller.signal);
});

Deno.test("composeAbortSignals composes multiple signals", () => {
  const c1 = new AbortController();
  const c2 = new AbortController();
  const composed = composeAbortSignals([c1.signal, c2.signal]);
  assert(composed);
  assertEquals(composed.aborted, false);
  c1.abort();
  assertEquals(composed.aborted, true);
});

Deno.test("resolveHostedChildPromiseWithTimeout resolves before timeout", async () => {
  const result = await resolveHostedChildPromiseWithTimeout(Promise.resolve("done"), 5_000);
  assertEquals(result, "done");
});

Deno.test("resolveHostedChildPromiseWithTimeout resolves timeout token when promise stalls", async () => {
  const neverResolve = new Promise<string>(() => {});
  const result = await resolveHostedChildPromiseWithTimeout(neverResolve, 10);
  assertEquals(result, HOSTED_CHILD_STREAM_TIMEOUT_TOKEN);
});

Deno.test("withHostedChildStreamIdleTimeout yields all values from a fast stream", async () => {
  async function* fastStream() {
    yield 1;
    yield 2;
    yield 3;
  }

  const values: number[] = [];
  for await (
    const value of withHostedChildStreamIdleTimeout({
      stream: fastStream(),
      getWatchdogState: () => ({
        phase: "generic_idle",
        timeoutMs: 5_000,
      }),
    })
  ) {
    values.push(value);
  }

  assertEquals(values, [1, 2, 3]);
});

Deno.test("withHostedChildStreamIdleTimeout throws when stream stalls", async () => {
  async function* stallingStream() {
    yield 1;
    await new Promise(() => {});
  }

  const values: number[] = [];
  await assertRejects(
    async () => {
      for await (
        const value of withHostedChildStreamIdleTimeout({
          stream: stallingStream(),
          getWatchdogState: () => ({
            phase: "generic_idle",
            timeoutMs: 10,
          }),
        })
      ) {
        values.push(value);
      }
    },
    HostedChildStreamIdleTimeoutError,
  );

  assertEquals(values, [1]);
});

Deno.test("withHostedChildStreamIdleTimeout settles an abandoned next() when the watchdog throws", async () => {
  // The underlying stream's pending next() rejects *after* the idle timeout
  // fires. Without handling, this becomes an unhandled rejection that can crash
  // the process. The watchdog must settle the abandoned iterator before throwing.
  let rejectPendingNext: ((reason: unknown) => void) | null = null;
  let returnCalled = false;

  const iterator: AsyncIterator<number> = {
    next() {
      return new Promise<IteratorResult<number>>((_resolve, reject) => {
        rejectPendingNext = reject;
      });
    },
    return() {
      returnCalled = true;
      return Promise.resolve({ done: true, value: undefined });
    },
  };

  const stream: AsyncIterable<number> = {
    [Symbol.asyncIterator]: () => iterator,
  };

  const unhandled: PromiseRejectionEvent[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    unhandled.push(event);
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    await assertRejects(
      async () => {
        for await (
          const _value of withHostedChildStreamIdleTimeout({
            stream,
            getWatchdogState: () => ({
              phase: "generic_idle",
              timeoutMs: 5,
            }),
          })
        ) {
          // never yields; the iterator stalls until rejected below
        }
      },
      HostedChildStreamIdleTimeoutError,
    );

    // Now reject the promise the watchdog abandoned when it threw.
    rejectPendingNext?.(new Error("stream aborted after watchdog gave up"));

    // Let the deferred return() run and the loop turn so any unhandled rejection would surface.
    await waitFor(() => returnCalled);
    await flushEventLoop();

    assertEquals(
      unhandled.length,
      0,
      "abandoned iterator.next() rejection must not escape as an unhandled rejection",
    );
    assert(returnCalled, "watchdog should settle the iterator via return()");
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("withHostedChildStreamIdleTimeout surfaces the original error when return() throws synchronously", async () => {
  // A custom async iterable whose return() throws *synchronously* during
  // cleanup must not let that throw escape the finally and replace the original
  // idle-timeout error. Cleanup failures stay fire-and-forget.
  let rejectPendingNext: ((reason: unknown) => void) | null = null;

  const iterator: AsyncIterator<number> = {
    next() {
      return new Promise<IteratorResult<number>>((_resolve, reject) => {
        rejectPendingNext = reject;
      });
    },
    return() {
      // Synchronous throw — evaluated before any Promise wraps it.
      throw new Error("synchronous cleanup failure");
    },
  };

  const stream: AsyncIterable<number> = {
    [Symbol.asyncIterator]: () => iterator,
  };

  const unhandled: PromiseRejectionEvent[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    unhandled.push(event);
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  try {
    // Must reject with the ORIGINAL idle-timeout error, not the cleanup throw.
    await assertRejects(
      async () => {
        for await (
          const _value of withHostedChildStreamIdleTimeout({
            stream,
            getWatchdogState: () => ({
              phase: "generic_idle",
              timeoutMs: 5,
            }),
          })
        ) {
          // never yields; the iterator stalls until rejected below
        }
      },
      HostedChildStreamIdleTimeoutError,
    );

    // Settle the abandoned next() so its rejection does not surface either.
    rejectPendingNext?.(new Error("stream aborted after watchdog gave up"));

    // Let the loop turn so any unhandled rejection would surface.
    await flushEventLoop();

    assertEquals(
      unhandled.length,
      0,
      "synchronous return() failure must not escape as an unhandled rejection",
    );
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("withHostedChildStreamIdleTimeout continues when timeout callback asks to retry", async () => {
  const gate = Promise.withResolvers<void>();
  async function* stallingThenResumingStream() {
    yield 1;
    await gate.promise;
    yield 2;
  }

  const values: number[] = [];
  let idleTimeoutCalls = 0;

  for await (
    const value of withHostedChildStreamIdleTimeout({
      stream: stallingThenResumingStream(),
      getWatchdogState: () => ({
        phase: "post_tool_idle",
        timeoutMs: 5,
      }),
      onIdleTimeout: () => {
        idleTimeoutCalls += 1;
        gate.resolve();
        return "continue";
      },
    })
  ) {
    values.push(value);
  }

  assertEquals(values, [1, 2], "the stream must resume after a retried idle timeout");
  assertEquals(idleTimeoutCalls, 1, "exactly one idle timeout before the gated resume");
});

Deno.test("withHostedChildStreamIdleTimeout throws when the retry callback stops asking to continue", async () => {
  // The stream only resumes after a third timeout, which a correct watchdog never
  // reaches: it must throw as soon as the callback stops answering "continue".
  const lateGate = Promise.withResolvers<void>();
  async function* stallingStream() {
    yield 1;
    await lateGate.promise;
    yield 2;
  }

  const values: number[] = [];
  let idleTimeoutCalls = 0;

  const error = await assertRejects(
    async () => {
      for await (
        const value of withHostedChildStreamIdleTimeout({
          stream: stallingStream(),
          getWatchdogState: () => ({
            phase: "post_tool_idle",
            timeoutMs: 5,
          }),
          onIdleTimeout: () => {
            idleTimeoutCalls += 1;
            if (idleTimeoutCalls >= 3) {
              lateGate.resolve();
            }
            return idleTimeoutCalls === 1 ? "continue" : undefined;
          },
        })
      ) {
        values.push(value);
      }
    },
    HostedChildStreamIdleTimeoutError,
  );

  assertEquals(values, [1], "the watchdog must throw before the stream resumes");
  assertEquals(error.phase, "post_tool_idle", "the thrown error must carry the watchdog phase");
  assertEquals(error.timeoutMs, 5, "the thrown error must carry the watchdog timeout");
  assertEquals(
    idleTimeoutCalls,
    2,
    "the watchdog must consult the callback again after a retry before throwing",
  );
});

Deno.test("withHostedChildStreamIdleTimeout stops iterating once the child run abort signal fires", async () => {
  const controller = new AbortController();
  let returned = false;
  const stream: AsyncIterable<number> = {
    [Symbol.asyncIterator]: () => {
      const source = [1, 2][Symbol.iterator]();
      return {
        next: () => {
          const next = source.next();
          return Promise.resolve(
            next.done ? { done: true, value: undefined } : { done: false, value: next.value },
          );
        },
        return: () => {
          returned = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };

  const values: number[] = [];
  const error = await assertRejects(
    async () => {
      for await (
        const value of withHostedChildStreamIdleTimeout({
          stream,
          abortSignal: controller.signal,
          getWatchdogState: () => ({
            phase: "generic_idle",
            timeoutMs: 1_000,
          }),
        })
      ) {
        values.push(value);
        controller.abort();
      }
    },
    Error,
  );

  assertEquals(error.name, "AbortError", "a child run abort must surface as an AbortError");
  assertEquals(values, [1], "no values may be yielded after the child run abort");
  await waitFor(() => returned);
  assertEquals(returned, true, "the source iterator must be closed when the abort is observed");
});
