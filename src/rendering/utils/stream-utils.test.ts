import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamSizeLimitError, StreamTimeoutError, streamToString } from "./stream-utils.ts";

function createStream(
  chunks: Array<Uint8Array | null>,
  close = true,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        if (chunk) controller.enqueue(chunk);
      }
      if (close) controller.close();
    },
  });
}

describe("streamToString", () => {
  it("converts simple stream to string", async () => {
    const encoder = new TextEncoder();
    const stream = createStream([encoder.encode("Hello "), encoder.encode("World")]);

    const result = await streamToString(stream);
    assertEquals(result, "Hello World");
    assertEquals(
      stream.locked,
      false,
      "streamToString must release the reader lock after a successful read",
    );
  });

  it("handles empty stream", async () => {
    const stream = createStream([]);

    const result = await streamToString(stream);
    assertEquals(result, "");
  });

  it("handles single chunk", async () => {
    const encoder = new TextEncoder();
    const stream = createStream([encoder.encode("Single chunk")]);

    const result = await streamToString(stream);
    assertEquals(result, "Single chunk");
  });

  it("handles multiple chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = ["This ", "is ", "a ", "test ", "with ", "many ", "chunks"];
    const stream = createStream(chunks.map((chunk) => encoder.encode(chunk)));

    const result = await streamToString(stream);
    assertEquals(result, chunks.join(""));
  });

  it("handles unicode characters", async () => {
    const encoder = new TextEncoder();
    const stream = createStream([
      encoder.encode("Hello "),
      encoder.encode("🌍"),
      encoder.encode(" World"),
    ]);

    const result = await streamToString(stream);
    assertEquals(result, "Hello 🌍 World");
  });

  it("handles null values in stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("Before"));
        controller.enqueue(undefined as unknown as Uint8Array);
        controller.enqueue(encoder.encode("After"));
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(
      result,
      "BeforeAfter",
      "a stream that yields an empty value must be skipped rather than dereferenced",
    );
  });

  it("times out on slow streams", async () => {
    const encoder = new TextEncoder();
    const stream = createStream([encoder.encode("Start")], false);

    await assertRejects(
      () => streamToString(stream, 100),
      StreamTimeoutError,
      "Stream read timed out after 100ms",
    );
  });

  it("returns partial content in timeout error", async () => {
    const encoder = new TextEncoder();
    const stream = createStream([encoder.encode("Partial content")], false);

    try {
      await streamToString(stream, 100);
      throw new Error("Should have thrown StreamTimeoutError");
    } catch (error) {
      if (!(error instanceof StreamTimeoutError)) throw error;
      assertEquals(error.partialContent, "Partial content");
    }
  });

  it("enforces an absolute deadline when ready reads starve timers", async () => {
    let cancelReason: unknown;
    let thrown: unknown;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });

    await assertRejects(
      async () => {
        try {
          await streamToString(stream, 1);
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
      StreamTimeoutError,
      "timed out after 1ms",
    );
    assertStrictEquals(cancelReason, thrown);
    assertEquals(
      stream.locked,
      false,
      "streamToString must release the reader lock after a failed read",
    );
  });

  it("cancels with the owned failure when buffered output exceeds its limit", async () => {
    let cancelReason: unknown;
    let thrown: unknown;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });

    await assertRejects(
      async () => {
        try {
          await streamToString(stream, 100, 4);
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
      StreamSizeLimitError,
      "limit of 4 bytes",
    );
    assertStrictEquals(cancelReason, thrown);
    assertEquals(
      stream.locked,
      false,
      "streamToString must release the reader lock after a failed read",
    );
  });

  it("rejects invalid timeout and byte limits before locking the stream", async () => {
    const stream = createStream([]);
    await assertRejects(
      () => streamToString(stream, 0),
      RangeError,
      "timeout must be a positive safe integer",
    );
    await assertRejects(
      () => streamToString(stream, 100, Number.MAX_VALUE),
      RangeError,
      "output limit must be a positive safe integer",
    );
    assertEquals(stream.locked, false);
  });
});
