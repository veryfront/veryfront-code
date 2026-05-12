import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  composeAbortSignals,
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  HostedChildStreamIdleTimeoutError,
  resolveHostedChildPromiseWithTimeout,
  resolveHostedChildStreamWatchdogState,
  withHostedChildStreamIdleTimeout,
} from "./hosted-child-stream-watchdog.ts";

const BASE_INPUT = {
  activeToolCallId: null,
  completedToolResults: 0,
  idleTimeoutMs: 45_000,
  activeToolTimeoutMs: 300_000,
  postToolIdleTimeoutMs: 120_000,
};

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

Deno.test("withHostedChildStreamIdleTimeout continues when timeout callback asks to retry", async () => {
  async function* stallingThenResumingStream() {
    yield 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
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
        return idleTimeoutCalls <= 3 ? "continue" : undefined;
      },
    })
  ) {
    values.push(value);
  }

  assertEquals(values, [1, 2]);
  assert(idleTimeoutCalls >= 1);
});
