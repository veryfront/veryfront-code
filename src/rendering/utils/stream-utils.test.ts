
import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { streamToString } from "./stream-utils.ts";

Deno.test("streamToString - converts simple stream to string", async () => {
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

Deno.test("streamToString - handles empty stream", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

  const result = await streamToString(stream);
  assertEquals(result, "");
});

Deno.test("streamToString - handles single chunk", async () => {
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

Deno.test("streamToString - handles multiple chunks", async () => {
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

Deno.test("streamToString - handles unicode characters", async () => {
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

Deno.test("streamToString - handles null values in stream", async () => {
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
