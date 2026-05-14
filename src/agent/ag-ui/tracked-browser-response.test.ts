import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiBrowserFinalizeTracker } from "./browser-finalize-tracker.ts";
import { createAgUiChunkEncoderBridge } from "./chunk-encoder-bridge.ts";
import { createAgUiTrackedBrowserResponse } from "./tracked-browser-response.ts";

describe("agent/ag-ui-tracked-browser-response", () => {
  it("combines chunk encoding and finalize tracking into one browser response helper", async () => {
    type Chunk = {
      id: string;
      text: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      finishReason?: string;
    };

    const response = createAgUiTrackedBrowserResponse({
      agUiInput: {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messages: [],
        tools: [],
        context: [],
      },
      agentId: "agent-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield {
              id: "msg-1",
              text: "hello",
              usage: { inputTokens: 2, outputTokens: 3 },
              finishReason: "stop",
            };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      chunkEncoder: createAgUiChunkEncoderBridge({
        getRuntimeEvents: (chunk: Chunk) => [
          { type: "message-start", messageId: chunk.id },
          { type: "text-start", id: chunk.id },
          { type: "text-delta", id: chunk.id, delta: chunk.text },
          { type: "text-end", id: chunk.id },
        ],
      }),
      finalizeTracker: createAgUiBrowserFinalizeTracker<Chunk>({
        getMetadataFromChunk: (chunk) => ({
          inputTokens: chunk.usage?.inputTokens,
          outputTokens: chunk.usage?.outputTokens,
          finishReason: chunk.finishReason,
        }),
      }),
    });

    const text = await response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, '"finishReason":"stop"');
  });

  it("suppresses final response output when encoded events contain RunError", async () => {
    const response = createAgUiTrackedBrowserResponse({
      agUiInput: {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messages: [],
        tools: [],
        context: [],
      },
      agentId: "agent-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield { text: "ignored" };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      chunkEncoder: {
        encode: () => [{ event: "RunError", payload: { message: "boom" } }],
        finalize: () => [],
      },
      finalizeTracker: createAgUiBrowserFinalizeTracker({
        getMetadataFromChunk: () => ({ finishReason: "stop" }),
      }),
    });

    const text = await response.text();
    assertStringIncludes(text, "event: RunError");
    assertEquals(text.includes("finishReason"), false);
  });
});
