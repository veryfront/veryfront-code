import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiBrowserResponseStream } from "./browser-response-stream.ts";
import { createAgUiChunkEncoderBridge } from "./chunk-encoder-bridge.ts";
import type { AgUiSseEvent } from "./host-support.ts";

async function collectStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function parseSseFrames(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body.split("\n\n").flatMap((frame) => {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : [];
  });
}

describe("agent/ag-ui-browser-response-stream", () => {
  it("writes bootstrap events, encoded chunk events, and finalize events", async () => {
    const stream = createAgUiBrowserResponseStream({
      agUiInput: {
        runId: "run-1",
        threadId: "thread-1",
        state: { step: "draft" },
        messages: [{ id: "user-1", role: "user" }],
      },
      agentId: "assistant-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "chunk", delta: "hello" };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      encoder: {
        encode: (chunk): AgUiSseEvent[] => [{
          event: "TextMessageContent",
          payload: { delta: String((chunk as { delta: string }).delta) },
        }],
        finalize: () => [{ event: "RunFinished", payload: { metadata: {} } }],
      },
      initialState: { seenDeltas: [] as string[] },
      onChunk: (state, chunk) => {
        state.seenDeltas.push((chunk as { delta: string }).delta);
      },
      getFinalResponse: () => null,
    });

    const text = await collectStreamText(stream);
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: StateSnapshot");
    assertStringIncludes(text, "event: MessagesSnapshot");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
  });

  it("shares the chunk encoder timing anchor with bootstrap and final events", async () => {
    let now = 100;
    const chunkEncoder = createAgUiChunkEncoderBridge<{ messageId: string }>({
      getRuntimeEvents: (chunk) => [
        { type: "message-start", messageId: chunk.messageId },
        { type: "text-start", id: chunk.messageId },
      ],
      timing: { nowMs: () => now, epochMs: null },
    });

    now = 150;
    const stream = createAgUiBrowserResponseStream({
      agUiInput: {
        runId: "run-timing",
        threadId: "thread-timing",
        messages: [],
      },
      agentId: "assistant-1",
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
      encoder: chunkEncoder,
      initialState: {},
    });

    const frames = parseSseFrames(await collectStreamText(stream));
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

  it("emits RunError and swallows execution.fail rejections", async () => {
    const stream = createAgUiBrowserResponseStream({
      agUiInput: {
        runId: "run-2",
        threadId: "thread-2",
        messages: [],
      },
      agentId: "assistant-1",
      execution: {
        agentUIStream: {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error("stream exploded");
              },
            };
          },
        },
        fail: async () => {
          throw new Error("fail exploded");
        },
        waitForFinish: async () => {},
      },
      encoder: {
        encode: () => [],
        finalize: () => [],
      },
      initialState: {},
    });

    const text = await collectStreamText(stream);
    assertStringIncludes(text, "event: RunError");
    assertStringIncludes(text, "stream exploded");
  });

  it("passes accumulated state into getFinalResponse", async () => {
    let finalSeen: string[] | undefined;

    const stream = createAgUiBrowserResponseStream({
      agUiInput: {
        runId: "run-3",
        threadId: "thread-3",
        messages: [],
      },
      agentId: "assistant-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "chunk", delta: "a" };
            yield { type: "chunk", delta: "b" };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      encoder: {
        encode: () => [],
        finalize: () => [],
      },
      initialState: { seen: [] as string[] },
      onChunk: (state, chunk) => {
        state.seen.push((chunk as { delta: string }).delta);
      },
      getFinalResponse: (state) => {
        finalSeen = [...state.seen];
        return null;
      },
    });

    await collectStreamText(stream);
    assertEquals(finalSeen, ["a", "b"]);
  });

  it("normalizes missing state to an empty snapshot object", async () => {
    const stream = createAgUiBrowserResponseStream({
      agUiInput: {
        runId: "run-4",
        threadId: "thread-4",
        messages: [],
      },
      agentId: "assistant-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "chunk", delta: "noop" };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      encoder: {
        encode: () => [],
        finalize: () => [],
      },
      initialState: {},
    });

    const text = await collectStreamText(stream);
    const stateSnapshot = parseSseFrames(text).find((frame) => frame.event === "StateSnapshot")
      ?.data;
    assertEquals(stateSnapshot?.snapshot, {});
    assertEquals(
      typeof stateSnapshot?.elapsedMs === "number" &&
        Number.isFinite(stateSnapshot.elapsedMs) && stateSnapshot.elapsedMs >= 0,
      true,
    );
    assertEquals(
      typeof stateSnapshot?.emittedAt === "number" &&
        Number.isInteger(stateSnapshot.emittedAt) && stateSnapshot.emittedAt > 0,
      true,
    );
  });

  it("stops consuming chunks after the response stream is cancelled", async () => {
    let releaseSecondChunk: (() => void) | undefined;
    const secondChunkReady = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    let seenChunks = 0;
    let waitForFinishCalls = 0;

    const stream = createAgUiBrowserResponseStream({
      agUiInput: {
        runId: "run-5",
        threadId: "thread-5",
        messages: [],
      },
      agentId: "assistant-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "chunk", delta: "a" };
            await secondChunkReady;
            yield { type: "chunk", delta: "b" };
          },
        },
        fail: async () => {},
        waitForFinish: async () => {
          waitForFinishCalls += 1;
        },
      },
      encoder: {
        encode: (chunk): AgUiSseEvent[] => [{
          event: "TextMessageContent",
          payload: { delta: String((chunk as { delta: string }).delta) },
        }],
        finalize: () => [{ event: "RunFinished", payload: { metadata: {} } }],
      },
      initialState: {},
      onChunk: () => {
        seenChunks += 1;
      },
    });

    const reader = stream.getReader();
    for (let index = 0; index < 4; index += 1) {
      const { done } = await reader.read();
      assertEquals(done, false);
    }
    await reader.cancel();
    releaseSecondChunk?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(seenChunks, 1);
    assertEquals(waitForFinishCalls, 0);
  });
});
