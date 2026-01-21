/**
 * Tests for Stream Utilities
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamToString, StreamTimeoutError } from "./stream-utils.ts";

describe("streamToString", () => {
  it("converts simple stream to string", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("Hello "));
        controller.enqueue(encoder.encode("World"));
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(result, "Hello World");
  });

  it("handles empty stream", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(result, "");
  });

  it("handles single chunk", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("Single chunk"));
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(result, "Single chunk");
  });

  it("handles multiple chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = ["This ", "is ", "a ", "test ", "with ", "many ", "chunks"];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(result, chunks.join(""));
  });

  it("handles unicode characters", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("Hello "));
        controller.enqueue(encoder.encode("🌍"));
        controller.enqueue(encoder.encode(" World"));
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(result, "Hello 🌍 World");
  });

  it("handles null values in stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("Before"));
        controller.enqueue(null as unknown as Uint8Array);
        controller.enqueue(encoder.encode("After"));
        controller.close();
      },
    });

    const result = await streamToString(stream);
    assertEquals(result, "BeforeAfter");
  });

  it("times out on slow streams", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("Start"));
        // Never close the stream - simulates hanging React Query
      },
    });

    // Use a short timeout for testing (100ms)
    await assertRejects(
      () => streamToString(stream, 100),
      StreamTimeoutError,
      "Stream read timed out after 100ms",
    );
  });

  it("returns partial content in timeout error", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("Partial content"));
        // Never close - simulates hanging
      },
    });

    try {
      await streamToString(stream, 100);
      throw new Error("Should have thrown StreamTimeoutError");
    } catch (error) {
      if (error instanceof StreamTimeoutError) {
        assertEquals(error.partialContent, "Partial content");
      } else {
        throw error;
      }
    }
  });
});
