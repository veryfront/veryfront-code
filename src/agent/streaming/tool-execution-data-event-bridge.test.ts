import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionDataEvent } from "../../tool/types.ts";
import { createToolExecutionDataEventBridgeStream } from "./tool-execution-data-event-bridge.ts";

describe("createToolExecutionDataEventBridgeStream", () => {
  it("emits published tool data events before forwarding upstream data stream chunks", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let publishDataEvent = (_event: ToolExecutionDataEvent) => {};
    let baseController: ReadableStreamDefaultController<Uint8Array> | null = null;

    const stream = createToolExecutionDataEventBridgeStream({
      baseStream: new ReadableStream<Uint8Array>({
        start(controller) {
          baseController = controller;
        },
      }),
      installPublisher(nextPublishDataEvent) {
        publishDataEvent = nextPublishDataEvent;
      },
    });

    const reader = stream.getReader();

    publishDataEvent({
      type: "tool-progress",
      data: { step: 1 },
    });

    const eventChunk = await reader.read();
    assertEquals(eventChunk.done, false);
    assertEquals(
      decoder.decode(eventChunk.value),
      `data: ${
        JSON.stringify({ type: "data", data: { type: "tool-progress", data: { step: 1 } } })
      }\n\n`,
    );

    baseController?.enqueue(encoder.encode('data: {"type":"message-finish"}\n\n'));
    baseController?.close();

    const forwardedChunk = await reader.read();
    assertEquals(forwardedChunk.done, false);
    assertEquals(decoder.decode(forwardedChunk.value), 'data: {"type":"message-finish"}\n\n');

    assertEquals(await reader.read(), { done: true, value: undefined });
  });
});
