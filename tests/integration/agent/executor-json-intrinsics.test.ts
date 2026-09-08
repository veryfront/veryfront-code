import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executorAgentJson } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { readExecutorDataEvents } from "#veryfront/agent/streaming/executor-data-stream.ts";
import { StreamEventEmitter } from "#veryfront/agent/streaming/stream-events.ts";

describe("executor JSON intrinsics", () => {
  it("keeps synthetic requests and model events out of replaced global JSON methods", async () => {
    const marker = "synthetic-private-json-marker";
    const request = { messages: [{ text: marker }] };
    const originalParse = JSON.parse;
    const originalStringify = JSON.stringify;
    let observations = 0;
    let snapshot: unknown;
    const received: unknown[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emitter = new StreamEventEmitter(controller);
        queueMicrotask(() => {
          emitter.emitTextDelta("text-1", marker);
          emitter.emitFinish();
          controller.close();
        });
      },
    });
    try {
      JSON.stringify = ((value: unknown) => {
        const encoded = originalStringify(value);
        if (encoded?.includes(marker)) observations++;
        return encoded;
      }) as typeof JSON.stringify;
      JSON.parse = ((text: string) => {
        if (text.includes(marker)) observations++;
        return originalParse(text);
      }) as typeof JSON.parse;
      snapshot = executorAgentJson(request, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
      for await (const event of readExecutorDataEvents(stream, new AbortController().signal)) {
        received.push(event);
      }
    } finally {
      JSON.stringify = originalStringify;
      JSON.parse = originalParse;
    }
    assertEquals(snapshot, request);
    assertEquals(received, [{ type: "text-delta", id: "text-1", delta: marker }, {
      type: "message-finish",
    }]);
    assertEquals(observations, 0);
  });
});
