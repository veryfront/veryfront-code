import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionDataEvent } from "../../tool/types.ts";
import { createToolExecutionDataEventBridgeStream } from "./tool-execution-data-event-bridge.ts";

function requireStreamController(
  controller: ReadableStreamDefaultController<Uint8Array> | null,
): ReadableStreamDefaultController<Uint8Array> {
  if (!controller) throw new Error("Expected base stream controller");
  return controller;
}

describe("createToolExecutionDataEventBridgeStream", () => {
  it("normalizes byte views without consulting overridden metadata getters", async () => {
    const bytes = new Uint8Array([11, 22, 33, 44]);
    const view = new DataView(bytes.buffer, 1, 2);
    let reads = 0;
    for (const key of ["buffer", "byteOffset", "byteLength"] as const) {
      const value = view[key];
      Object.defineProperty(view, key, {
        get() {
          reads++;
          return value;
        },
      });
    }
    const baseStream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue(view);
        controller.close();
      },
    }) as ReadableStream<Uint8Array>;
    const chunks = await Array.fromAsync(
      createToolExecutionDataEventBridgeStream({ baseStream, installPublisher: () => {} }),
    );
    assertEquals(reads, 0);
    assertEquals(chunks, [new Uint8Array([22, 33])]);
  });

  it("does not expose its source through an overridden reader factory", async () => {
    let reads = 0;
    const baseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Synthetic private output"));
        controller.close();
      },
    });
    Object.defineProperty(baseStream, "getReader", {
      get() {
        reads++;
        return ReadableStream.prototype.getReader;
      },
    });
    const stream = createToolExecutionDataEventBridgeStream({
      baseStream,
      installPublisher: () => {},
    });
    const chunks = await Array.fromAsync(stream);
    assertEquals(reads, 0);
    assertEquals(new TextDecoder().decode(chunks[0]), "Synthetic private output");
  });

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

    const controller = requireStreamController(baseController);
    controller.enqueue(encoder.encode('data: {"type":"message-finish"}\n\n'));
    controller.close();

    const forwardedChunk = await reader.read();
    assertEquals(forwardedChunk.done, false);
    assertEquals(decoder.decode(forwardedChunk.value), 'data: {"type":"message-finish"}\n\n');

    assertEquals(await reader.read(), { done: true, value: undefined });
  });

  it("emits named tool data events as data parts", async () => {
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
      type: "dora.report",
      name: "dora.report",
      value: { status: "ready" },
    });

    const eventChunk = await reader.read();
    assertEquals(eventChunk.done, false);
    assertEquals(
      decoder.decode(eventChunk.value),
      `data: ${JSON.stringify({ type: "data-dora.report", data: { status: "ready" } })}\n\n`,
    );

    const controller = requireStreamController(baseController);
    controller.enqueue(encoder.encode('data: {"type":"message-finish"}\n\n'));
    controller.close();
    await reader.cancel();
  });

  it("surfaces base stream failures as stream errors", async () => {
    let publishDataEvent = (_event: ToolExecutionDataEvent) => {};

    const stream = createToolExecutionDataEventBridgeStream({
      baseStream: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("upstream boom"));
        },
      }),
      installPublisher(nextPublishDataEvent) {
        publishDataEvent = nextPublishDataEvent;
      },
    });

    await assertRejects(
      () => stream.getReader().read(),
      Error,
      "upstream boom",
      "base stream failures must propagate as a stream error, not a clean close",
    );

    // The pump reinstalls a no-op publisher on teardown, so a late publish must
    // not enqueue onto the errored controller.
    publishDataEvent({ type: "late", data: {} });
  });

  it("cancel resolves cleanly when the base reader cancel rejects (#2334)", async () => {
    // Mirrors the production crash: the upstream agent runtime's stream cancel
    // aborts an in-flight signal, and the rejection propagates back through the
    // base reader's cancel. The bridge must absorb it so cancellation does not
    // escape as an unhandled rejection (fatal under Deno).
    const stream = createToolExecutionDataEventBridgeStream({
      baseStream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"message-start"}\n\n'));
        },
        cancel() {
          throw new DOMException("The signal has been aborted", "AbortError");
        },
      }),
      installPublisher() {},
    });

    const reader = stream.getReader();
    await reader.read();

    // Must not reject — before the fix this surfaced the base reader's
    // AbortError to the (often un-awaiting) consumer.
    await reader.cancel(new DOMException("client disconnected", "AbortError"));
  });

  it("cancel still forwards the reason to the base reader on the happy path", async () => {
    let cancelledWith: unknown = "unset";
    let publishDataEvent = (_event: ToolExecutionDataEvent) => {};
    const stream = createToolExecutionDataEventBridgeStream({
      baseStream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"message-start"}\n\n'));
        },
        async cancel(reason) {
          cancelledWith = reason;
          await Promise.resolve();
        },
      }),
      installPublisher(nextPublishDataEvent) {
        publishDataEvent = nextPublishDataEvent;
      },
    });

    const reader = stream.getReader();
    await reader.read();
    const reason = new DOMException("client disconnected", "AbortError");
    const cancellation = reader.cancel(reason);
    publishDataEvent({ type: "late-child-event", data: { status: "still-stopping" } });
    await cancellation;

    assertEquals(cancelledWith, reason);
  });
});
