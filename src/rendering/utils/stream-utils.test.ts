import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamTimeoutError, streamToString } from "./stream-utils.ts";

function createStream(chunks: Array<Uint8Array | null>, close = true): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk as unknown as Uint8Array);
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
    const stream = createStream([encoder.encode("Before"), null, encoder.encode("After")]);

    const result = await streamToString(stream);
    assertEquals(result, "BeforeAfter");
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
});
