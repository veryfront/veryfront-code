import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiFinalizeTracker } from "./finalize-tracker.ts";
import { createAgUiChunkEncoderBridge } from "./chunk-encoder-bridge.ts";
import { createAgUiTrackedResponse } from "./tracked-response.ts";

function parseSseFrames(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body.split("\n\n").flatMap((frame) => {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : [];
  });
}

describe("agent/ag-ui-tracked-response", () => {
  it("combines chunk encoding and finalize tracking into one response helper", async () => {
    type Chunk = {
      id: string;
      text: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      finishReason?: string;
    };

    const response = createAgUiTrackedResponse({
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
      finalizeTracker: createAgUiFinalizeTracker<Chunk>({
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

  it("supports legacy custom encoders without timingState", async () => {
    const response = createAgUiTrackedResponse({
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
      finalizeTracker: createAgUiFinalizeTracker({
        getMetadataFromChunk: () => ({ finishReason: "stop" }),
      }),
    });

    const text = await response.text();
    assertStringIncludes(text, "event: RunError");
    assertEquals(text.includes("finishReason"), false);
    assertEquals(
      parseSseFrames(text).every((frame) => typeof frame.data.elapsedMs === "number"),
      true,
    );
  });

  it("shares an injected run timing anchor across bootstrap, chunk, and final events", async () => {
    let now = 150;
    const response = createAgUiTrackedResponse({
      agUiInput: {
        threadId: "thread-timing",
        runId: "run-timing",
        messages: [],
        tools: [],
        context: [],
      },
      agentId: "agent-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            now = 175;
            yield { messageId: "msg-1" };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {
          now = 200;
        },
      },
      chunkEncoder: createAgUiChunkEncoderBridge({
        getRuntimeEvents: (chunk: { messageId: string }) => [
          { type: "message-start", messageId: chunk.messageId },
          { type: "text-start", id: chunk.messageId },
        ],
        timing: { nowMs: () => now, epochMs: null, startedMs: 100 },
      }),
      finalizeTracker: createAgUiFinalizeTracker({
        getMetadataFromChunk: () => ({ finishReason: "stop" }),
      }),
    });

    const frames = parseSseFrames(await response.text());
    assertEquals(
      frames.filter((frame) =>
        ["RunStarted", "TextMessageStart", "RunFinished"].includes(frame.event)
      ).map((frame) => [frame.event, frame.data.elapsedMs]),
      [
        ["RunStarted", 50],
        ["TextMessageStart", 75],
        ["RunFinished", 100],
      ],
    );
  });
});
