import "#veryfront/schemas/_test-setup.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "../index.ts";

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
 */

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** A model stream that stays open until the run is aborted, then rejects its
 * pending read with the abort reason — mirroring a real provider fetch body. */
function createPendingModelStream(abortSignal: AbortSignal | undefined): ReadableStream<unknown> {
  return new ReadableStream<unknown>({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "t" });
      controller.enqueue({ type: "text-delta", id: "t", delta: "thinking" });

      if (!abortSignal) {
        return;
      }
      if (abortSignal.aborted) {
        controller.error(abortSignal.reason);
        return;
      }
      abortSignal.addEventListener("abort", () => {
        controller.error(abortSignal.reason);
      }, { once: true });
    },
  });
}

describe("agent runtime stream cancellation (#2334)", () => {
  it("cancelling a model-streaming run does not raise an unhandled AbortError", async () => {
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/cancel-crash-model",
      async doGenerate() {
        return {
          content: [],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        const abortSignal = (options as { abortSignal?: AbortSignal }).abortSignal;
        return { stream: createPendingModelStream(abortSignal) };
      },
    };

    const assistant = agent({
      model: "hosted/cancel-crash-model",
      system: "cancel crash test",
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({ input: "hi" })).toDataStreamResponse();
    const body = response.body;
    assert(body !== null, "expected a streaming response body");

    const reader = body.getReader();
    // Pull the opening frames so the run is genuinely mid-stream.
    await reader.read();
    // The client disconnects: cancel with a foreign AbortError reason, exactly
    // as Deno hands to the stream's cancel algorithm.
    await reader.cancel(new DOMException("client disconnected", "AbortError"));

    await flushMicrotasks();
    assert(true, "cancellation completed without an unhandled rejection");
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

    let call = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/cancel-crash-tool",
      async doGenerate() {
        return {
          content: [],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        call += 1;
        const abortSignal = (options as { abortSignal?: AbortSignal }).abortSignal;
        if (call === 1) {
          // First step: emit a tool call so a tool execution opens.
          return {
            stream: new ReadableStream<unknown>({
              start(controller) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "slow-1",
                  toolName: "slow_tool",
                  input: "{}",
                });
                controller.enqueue({ type: "finish", finishReason: "tool-calls" });
                controller.close();
              },
            }),
          };
        }
        // Any later step stays open until aborted.
        return { stream: createPendingModelStream(abortSignal) };
      },
    };

    const assistant = agent({
      model: "hosted/cancel-crash-tool",
      system: "cancel crash tool test",
      tools: { slow_tool: slowTool },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({ input: "run the tool" })).toDataStreamResponse();
    const body = response.body;
    assert(body !== null, "expected a streaming response body");

    const reader = body.getReader();
    await reader.read();
    await toolStarted.promise;
    await reader.cancel(new DOMException("client disconnected", "AbortError"));
    releaseTool?.();

    await flushMicrotasks();
    assert(true, "cancellation during tool execution completed cleanly");
  });
});
