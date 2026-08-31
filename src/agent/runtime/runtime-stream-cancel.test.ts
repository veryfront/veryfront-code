import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay, waitFor } from "#veryfront/testing/deno-compat.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { agent } from "../index.ts";
import { AgentRuntime } from "./index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverRevoker,
} from "./model-transport.ts";

/**
 * Regression coverage for #2334: cancelling an in-flight agent run must be
 * treated as a clean stop, not surface as an uncaught `AbortError`.
 *
 * The reproduction cancels the response body's reader (exactly what Deno's HTTP
 * server does when the client disconnects / hits the Chat "Stop" button) while
 * the model stream — and a tool execution — are still in flight. Before the fix
 * the runtime's stream `cancel` aborted the shared signal with the client's
 * foreign reason, and the resulting rejection propagated with no handler,
 * crashing the process under Deno. Deno's test runner fails on any unhandled
 * rejection, so these tests fail loudly if the regression returns.
 *
 * The stream body cannot report what the runtime does after the disconnect: a
 * cancelled reader discards the queue and every later `read()` resolves
 * `done: true`, and `sendSSE` swallows the "controller is already closed"
 * TypeError an out-of-band error frame would raise. The server-side branch is
 * therefore observed through its log record — the runtime's error path in
 * `AgentRuntime.stream` logs "Agent stream error" before it emits the error
 * frame — plus the abort reason handed to the run and the absence of an
 * `onFinish` callback.
 */

const STREAM_ERROR_LOG_MESSAGE = "Agent stream error";

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("");
}

/** Collect the runtime's stream-error log records for the duration of a run. */
function captureStreamErrorLogs(): { records: LogEntry[]; stop: () => void } {
  const records: LogEntry[] = [];
  const unsubscribe = __subscribeLogRecordEmitter((entry) => {
    if (entry.component === "agent" && entry.message === STREAM_ERROR_LOG_MESSAGE) {
      records.push(entry);
    }
  });
  return { records, stop: unsubscribe };
}

function describeRecords(records: readonly LogEntry[]): string {
  return records.map((entry) => JSON.stringify(entry.context ?? entry.error ?? {})).join("; ");
}

async function waitForRunAbort(model: ReturnType<typeof scriptedModel>): Promise<AbortSignal> {
  await waitFor(
    () => model.calls.some((call) => call.abortSignal?.aborted === true),
    { message: "the run's shared signal must be aborted by the client disconnect" },
  );
  const aborted = model.calls.find((call) => call.abortSignal?.aborted === true)?.abortSignal;
  assert(aborted !== undefined, "the aborted run signal must be recoverable from the model call");
  return aborted;
}

/** The disconnect reason the runtime received, as the client spelled it. */
function assertClientDisconnectReason(signal: AbortSignal): void {
  const reason = signal.reason;
  assert(
    reason instanceof DOMException,
    `the run must be aborted with the client's reason, got ${String(reason)}`,
  );
  assertEquals(reason.name, "AbortError", "the client disconnect reason must stay an AbortError");
  assertEquals(
    reason.message,
    "client disconnected",
    "the client's cancel reason must reach the run's shared signal unchanged",
  );
}

/**
 * Let the aborted agent loop settle. The loop rejects as soon as the shared
 * signal aborts, and the runtime's `catch` logs before it writes an error
 * frame, so a misclassified disconnect has landed by the time this resolves.
 */
function settleAbortedRun(): Promise<void> {
  return delay(50);
}

describe("agent runtime stream cancellation (#2334)", () => {
  it("revokes run-scoped model authority when generation starts aborted", async () => {
    const model = scriptedModel([{ text: "must not run" }], {
      modelId: "veryfront-cloud/openai/pre-aborted-model",
      only: "generate",
    });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "pre-aborted-runtime",
      {
        model: "veryfront-cloud/openai/pre-aborted-model",
        system: "pre-aborted lease test",
        maxSteps: 1,
      },
      {
        resolveModelRuntime: resolver,
      },
    );
    const abortController = new AbortController();
    abortController.abort(new DOMException("caller aborted", "AbortError"));

    await assertRejects(
      async () =>
        await runtime.generate(
          "Hello",
          undefined,
          undefined,
          undefined,
          abortController.signal,
        ),
      DOMException,
      "caller aborted",
    );

    assertEquals(resolverActive, false);
    assertEquals(model.calls.length, 0);
  });

  it("revokes run-scoped model authority before forwarding caller aborts", async () => {
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "thinking" }] },
    ], { modelId: "veryfront-cloud/openai/caller-abort-model", only: "stream" });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "caller-abort-runtime",
      {
        model: "veryfront-cloud/openai/caller-abort-model",
        system: "caller abort lease test",
        maxSteps: 1,
      },
      {
        resolveModelRuntime: resolver,
      },
    );
    const abortController = new AbortController();
    const stream = await runtime.stream(
      [{
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      }],
      undefined,
      undefined,
      undefined,
      undefined,
      abortController.signal,
    );
    const reader = stream.getReader();
    const first = await reader.read();
    assertEquals(first.done, false, "the model call must be in flight before aborting");
    await waitFor(
      () => model.calls[0]?.abortSignal !== undefined,
      { message: "the model call must expose its abort signal before aborting" },
    );
    const signal = model.calls[0]?.abortSignal;
    assert(signal !== undefined, "expected the model call abort signal");
    let replayedDuringAbort: unknown;
    signal.addEventListener("abort", () => {
      replayedDuringAbort = resolver("veryfront-cloud/openai/caller-abort-model");
    }, { once: true });

    abortController.abort(new DOMException("caller aborted", "AbortError"));

    assertEquals(replayedDuringAbort, undefined);
    assertEquals(resolverActive, false);
    await reader.cancel();
  });

  it("revokes generation authority before forwarding caller aborts", async () => {
    const modelStarted = Promise.withResolvers<void>();
    let modelAbortSignal: AbortSignal | undefined;
    let replayedDuringAbort: unknown;
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    const model: ModelRuntime = {
      provider: "test",
      modelId: "veryfront-cloud/openai/generate-caller-abort-model",
      doGenerate(options) {
        const abortSignal = (options as { abortSignal?: AbortSignal }).abortSignal;
        modelAbortSignal = abortSignal;
        modelStarted.resolve();
        return new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () => {
            replayedDuringAbort = resolver(
              "veryfront-cloud/openai/generate-caller-abort-model",
            );
            reject(abortSignal.reason);
          }, { once: true });
        });
      },
      doStream() {
        throw new Error("Expected generation path");
      },
    };
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "generate-caller-abort-runtime",
      {
        model: "veryfront-cloud/openai/generate-caller-abort-model",
        system: "generate caller abort lease test",
        maxSteps: 1,
      },
      { resolveModelRuntime: resolver },
    );
    const abortController = new AbortController();
    const aborted = assertRejects(
      async () =>
        await runtime.generate(
          "Hello",
          undefined,
          undefined,
          undefined,
          abortController.signal,
        ),
      DOMException,
      "caller aborted",
    );

    await modelStarted.promise;
    assert(modelAbortSignal !== undefined, "the model must receive an abort signal");
    abortController.abort(new DOMException("caller aborted", "AbortError"));

    await aborted;
    assertEquals(replayedDuringAbort, undefined);
    assertEquals(resolverActive, false);
  });

  it("cannot suppress generation abort revocation by replacing event listeners", async () => {
    const modelStarted = Promise.withResolvers<void>();
    const modelStopped = Promise.withResolvers<never>();
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    const model: ModelRuntime = {
      provider: "test",
      modelId: "veryfront-cloud/openai/patched-event-target-model",
      doGenerate() {
        modelStarted.resolve();
        return modelStopped.promise;
      },
      doStream() {
        throw new Error("Expected generation path");
      },
    };
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "patched-event-target-runtime",
      {
        model: "veryfront-cloud/openai/patched-event-target-model",
        system: "patched event target lease test",
        maxSteps: 1,
      },
      { resolveModelRuntime: resolver },
    );
    const abortController = new AbortController();
    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    let generation: Promise<unknown> | undefined;

    try {
      EventTarget.prototype.addEventListener = () => {};
      generation = assertRejects(
        async () =>
          await runtime.generate(
            "Hello",
            undefined,
            undefined,
            undefined,
            abortController.signal,
          ),
        Error,
        "stop patched event target model",
      );
      await modelStarted.promise;
    } finally {
      EventTarget.prototype.addEventListener = nativeAddEventListener;
    }

    abortController.abort(new DOMException("caller aborted", "AbortError"));

    try {
      assertEquals(resolverActive, false);
    } finally {
      modelStopped.reject(new Error("stop patched event target model"));
      await generation;
    }
  });

  it("revokes generation authority when the inference handler settles", async () => {
    const middlewarePostProcessing = Promise.withResolvers<void>();
    const releaseMiddleware = Promise.withResolvers<void>();
    const model = scriptedModel([{ text: "complete" }], {
      modelId: "veryfront-cloud/openai/generate-settlement-model",
      only: "generate",
    });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "generate-settlement-runtime",
      {
        model: "veryfront-cloud/openai/generate-settlement-model",
        system: "generate settlement lease test",
        maxSteps: 1,
        middleware: [async (_context, next) => {
          const response = await next();
          middlewarePostProcessing.resolve();
          await releaseMiddleware.promise;
          return response;
        }],
      },
      { resolveModelRuntime: resolver },
    );

    const generation = runtime.generate("Hello");
    await middlewarePostProcessing.promise;
    try {
      assertEquals(resolver("veryfront-cloud/openai/generate-settlement-model"), undefined);
    } finally {
      releaseMiddleware.resolve();
      assertEquals((await generation).text, "complete");
    }
  });

  it("revokes stream authority when the inference handler settles", async () => {
    const middlewarePostProcessing = Promise.withResolvers<void>();
    const releaseMiddleware = Promise.withResolvers<void>();
    const model = scriptedModel([{ text: "complete" }], {
      modelId: "veryfront-cloud/openai/stream-settlement-model",
      only: "stream",
    });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "stream-settlement-runtime",
      {
        model: "veryfront-cloud/openai/stream-settlement-model",
        system: "stream settlement lease test",
        maxSteps: 1,
        middleware: [async (_context, next) => {
          const response = await next();
          middlewarePostProcessing.resolve();
          await releaseMiddleware.promise;
          return response;
        }],
      },
      { resolveModelRuntime: resolver },
    );

    const stream = await runtime.stream([{
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    }]);
    const consumed = new Response(stream).text();
    await middlewarePostProcessing.promise;
    try {
      assertEquals(resolver("veryfront-cloud/openai/stream-settlement-model"), undefined);
    } finally {
      releaseMiddleware.resolve();
      assert((await consumed).includes("complete"));
    }
  });

  it("revokes run-scoped model authority before dispatching cancellation abort", async () => {
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "thinking" }] },
    ], { modelId: "veryfront-cloud/openai/cancel-lease-model", only: "stream" });
    let resolverActive = true;
    const resolver: AgentModelRuntimeResolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const runtime = new AgentRuntime(
      "cancel-lease-runtime",
      {
        model: "veryfront-cloud/openai/cancel-lease-model",
        system: "cancel lease test",
        maxSteps: 1,
      },
      {
        resolveModelRuntime: resolver,
      },
    );

    const stream = await runtime.stream([{
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    }]);
    const reader = stream.getReader();
    const first = await reader.read();
    assertEquals(first.done, false, "the model call must be in flight before cancelling");
    await waitFor(
      () => model.calls[0]?.abortSignal !== undefined,
      { message: "the model call must expose its abort signal before cancelling" },
    );
    const signal = model.calls[0]?.abortSignal;
    assert(signal !== undefined, "expected the model call abort signal");
    let replayedDuringAbort: unknown;
    signal.addEventListener("abort", () => {
      replayedDuringAbort = resolver("veryfront-cloud/openai/cancel-lease-model");
    }, { once: true });

    await reader.cancel(new DOMException("client disconnected", "AbortError"));

    assertEquals(replayedDuringAbort, undefined);
    assertEquals(resolverActive, false);
  });

  it("cancelling a model-streaming run does not raise an unhandled AbortError", async () => {
    // The model stream stays open until the run is aborted, then rejects its
    // pending read with the abort reason — mirroring a real provider fetch body.
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "thinking" }] },
    ], { modelId: "hosted/cancel-crash-model", only: "stream" });

    let finished = 0;
    const assistant = agent({
      model: "hosted/cancel-crash-model",
      system: "cancel crash test",
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
    });

    const streamErrors = captureStreamErrorLogs();
    try {
      const response = (await assistant.stream({
        input: "hi",
        onFinish: () => {
          finished += 1;
        },
      })).toDataStreamResponse();
      const body = response.body;
      assert(body !== null, "expected a streaming response body");

      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      // Pull the opening frames so the run is genuinely mid-stream.
      const first = await reader.read();
      assertEquals(first.done, false, "the run must be mid-stream before cancelling");
      if (first.value !== undefined) chunks.push(first.value);
      assertEquals(
        decodeChunks(chunks).includes('"type":"error"'),
        false,
        "the frames delivered before the disconnect must not be an error frame",
      );
      // The client disconnects: cancel with a foreign AbortError reason, exactly
      // as Deno hands to the stream's cancel algorithm.
      await reader.cancel(new DOMException("client disconnected", "AbortError"));
      assertEquals((await reader.read()).done, true, "the body must close on cancel");

      const signal = await waitForRunAbort(model);
      assertClientDisconnectReason(signal);
      await settleAbortedRun();

      assertEquals(
        streamErrors.records.length,
        0,
        `a client disconnect must take the clean-stop branch, not the error branch that emits an error frame; logged: ${
          describeRecords(streamErrors.records)
        }`,
      );
      assertEquals(finished, 0, "a cancelled run must not report a finished response");
    } finally {
      streamErrors.stop();
    }
  });

  it("cancelling while a tool is executing does not raise an unhandled AbortError", async () => {
    let releaseTool: (() => void) | undefined;
    const toolStarted = Promise.withResolvers<void>();

    const slowTool = tool({
      id: "slow_tool",
      description: "A tool that stays in flight until the run is cancelled",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async (_input, context) => {
        toolStarted.resolve();
        const abortSignal = (context as { abortSignal?: AbortSignal })?.abortSignal;
        await new Promise<void>((resolve) => {
          releaseTool = resolve;
          abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { ok: true };
      },
    });

    const model = scriptedModel([
      // First step: emit a tool call so a tool execution opens.
      { toolCalls: [{ id: "slow-1", name: "slow_tool", input: {} }] },
      // Any later step stays open until aborted.
      { hangUntilAbort: true },
    ], { modelId: "hosted/cancel-crash-tool", only: "stream" });

    let finished = 0;
    const assistant = agent({
      model: "hosted/cancel-crash-tool",
      system: "cancel crash tool test",
      tools: { slow_tool: slowTool },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const streamErrors = captureStreamErrorLogs();
    try {
      const response = (await assistant.stream({
        input: "run the tool",
        onFinish: () => {
          finished += 1;
        },
      })).toDataStreamResponse();
      const body = response.body;
      assert(body !== null, "expected a streaming response body");

      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      const first = await reader.read();
      assertEquals(first.done, false, "the run must be mid-stream before cancelling");
      if (first.value !== undefined) chunks.push(first.value);
      assertEquals(
        decodeChunks(chunks).includes('"type":"error"'),
        false,
        "the frames delivered before the disconnect must not be an error frame",
      );
      await toolStarted.promise;
      await reader.cancel(new DOMException("client disconnected", "AbortError"));
      releaseTool?.();
      assertEquals(
        (await reader.read()).done,
        true,
        "the body must close on cancel during a tool call",
      );

      const signal = await waitForRunAbort(model);
      assertClientDisconnectReason(signal);
      await settleAbortedRun();

      assertEquals(
        streamErrors.records.length,
        0,
        `a client disconnect during tool execution must take the clean-stop branch, not the error branch that emits an error frame; logged: ${
          describeRecords(streamErrors.records)
        }`,
      );
      assertEquals(finished, 0, "a cancelled tool run must not report a finished response");
    } finally {
      streamErrors.stop();
    }
  });

  it("closes the response body once a mid-stream reader is cancelled", async () => {
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "still streaming" }] },
    ], { modelId: "hosted/cancel-close-model", only: "stream" });

    const assistant = agent({
      model: "hosted/cancel-close-model",
      system: "cancel close test",
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({ input: "hi" })).toDataStreamResponse();
    const body = response.body;
    assert(body !== null, "expected a streaming response body");

    const reader = body.getReader();
    const first = await reader.read();
    assertEquals(first.done, false, "the run must be mid-stream before cancelling");
    await reader.cancel(new DOMException("client disconnected", "AbortError"));

    assertEquals((await reader.read()).done, true, "the body must close on cancel");
    const signal = await waitForRunAbort(model);
    assertClientDisconnectReason(signal);
  });
});
