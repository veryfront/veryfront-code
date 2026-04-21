import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiBrowserResponseStream } from "./ag-ui-browser-response-stream.ts";
import type { AgUiSseEvent } from "./ag-ui-host-support.ts";

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
    assertStringIncludes(text, "event: StateSnapshot");
    assertStringIncludes(text, 'data: {"snapshot":{}}');
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
