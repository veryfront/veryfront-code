import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "../index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

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

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("");
}

async function waitForRunAbort(model: ReturnType<typeof scriptedModel>): Promise<void> {
  await waitFor(
    () => model.calls.some((call) => call.abortSignal?.aborted === true),
    { message: "the run's shared signal must be aborted by the client disconnect" },
  );
}

describe("agent runtime stream cancellation (#2334)", () => {
  it("cancelling a model-streaming run does not raise an unhandled AbortError", async () => {
    // The model stream stays open until the run is aborted, then rejects its
    // pending read with the abort reason — mirroring a real provider fetch body.
    const model = scriptedModel([
      { hangUntilAbort: true, parts: [{ type: "text-delta", text: "thinking" }] },
    ], { modelId: "hosted/cancel-crash-model", only: "stream" });

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
    const chunks: Uint8Array[] = [];
    // Pull the opening frames so the run is genuinely mid-stream.
    const first = await reader.read();
    if (first.value !== undefined) chunks.push(first.value);
    // The client disconnects: cancel with a foreign AbortError reason, exactly
    // as Deno hands to the stream's cancel algorithm.
    await reader.cancel(new DOMException("client disconnected", "AbortError"));
    const afterCancel = await reader.read();
    if (afterCancel.value !== undefined) chunks.push(afterCancel.value);

    await waitForRunAbort(model);
    assertEquals(afterCancel.done, true, "the body must close on cancel");
    assertEquals(
      decodeChunks(chunks).includes('"type":"error"'),
      false,
      "a client disconnect must not emit an error frame",
    );
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
    const chunks: Uint8Array[] = [];
    const first = await reader.read();
    if (first.value !== undefined) chunks.push(first.value);
    await toolStarted.promise;
    await reader.cancel(new DOMException("client disconnected", "AbortError"));
    releaseTool?.();
    const afterCancel = await reader.read();
    if (afterCancel.value !== undefined) chunks.push(afterCancel.value);

    await waitForRunAbort(model);
    assertEquals(afterCancel.done, true, "the body must close on cancel during a tool call");
    assertEquals(
      decodeChunks(chunks).includes('"type":"error"'),
      false,
      "a client disconnect during tool execution must not emit an error frame",
    );
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
    await waitForRunAbort(model);
  });
});
