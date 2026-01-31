import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateMessageId, sendSSE } from "./sse-utils.ts";

function createController(chunks: Uint8Array[]): ReadableStreamDefaultController {
  return {
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
  } as unknown as ReadableStreamDefaultController;
}

describe("sse-utils", () => {
  describe("sendSSE", () => {
    it("encodes event as SSE data line", () => {
      const chunks: Uint8Array[] = [];
      const controller = createController(chunks);
      const encoder = new TextEncoder();

      sendSSE(controller, encoder, { type: "test", value: 42 });

      assertEquals(chunks.length, 1);
      const decoded = new TextDecoder().decode(chunks[0]);
      assertEquals(decoded, `data: {"type":"test","value":42}\n\n`);
    });

    it("handles nested objects in events", () => {
      const chunks: Uint8Array[] = [];
      const controller = createController(chunks);
      const encoder = new TextEncoder();

      sendSSE(controller, encoder, { type: "complex", data: { nested: true } });

      const decoded = new TextDecoder().decode(chunks[0]);
      const parsed = JSON.parse(decoded.replace("data: ", "").trim());
      assertEquals(parsed.type, "complex");
      assertEquals(parsed.data.nested, true);
    });
  });

  describe("generateMessageId", () => {
    it("returns a string starting with msg-", () => {
      const id = generateMessageId();
      assertEquals(typeof id, "string");
      assertEquals(id.startsWith("msg-"), true);
    });

    it("generates unique ids", () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId());
      }

      assertEquals(ids.size, 100);
    });
  });
});
