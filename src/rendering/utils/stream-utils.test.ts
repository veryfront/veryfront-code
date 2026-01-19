/**
 * Tests for Stream Utilities
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { streamToString } from "./stream-utils.ts";

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
});
