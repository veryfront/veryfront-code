// Mutates Array.prototype, so it belongs in the semantic integration suite
// rather than a hermetic unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockResult } from "../../../../../../src/agent/runtime/chat-stream-handler.test-helpers.ts";
import {
  createRuntimeStreamSource,
  createStreamState,
  processStream,
} from "#veryfront/agent/runtime/chat-stream-handler.ts";

describe("chat-stream-handler deferred text intrinsic boundary", () => {
  for (const mode of ["legacy", "active"] as const) {
    it(`does not expose deferred text to mutable array intrinsics in ${mode} mode`, async () => {
      const events: Record<string, unknown>[] = [];
      const decoder = new TextDecoder();
      const controller = {
        enqueue(chunk: Uint8Array) {
          const text = decoder.decode(chunk);
          events[events.length] = JSON.parse(text.slice(6).trim());
        },
      } as ReadableStreamDefaultController;
      const encoder = new TextEncoder();
      const originalPush = Array.prototype.push;
      const originalJoin = Array.prototype.join;
      Object.defineProperty(Array.prototype, "push", {
        configurable: true,
        value: () => 0,
      });
      Object.defineProperty(Array.prototype, "join", {
        configurable: true,
        value: () => "spoofed",
      });
      try {
        const result = createMockResult([
          { type: "text-delta", text: "safe" },
          { type: "finish", finishReason: "stop", totalUsage: null },
        ]);
        await processStream(
          mode === "active" ? createRuntimeStreamSource(() => result) : result,
          createStreamState(),
          controller,
          encoder,
          "text-1",
          {
            ...(mode === "active" ? { streamLifecycleMode: "active" as const } : {}),
            onTextComplete: (_text, emit) => emit(),
          },
          undefined,
        );
      } finally {
        Object.defineProperty(Array.prototype, "push", {
          configurable: true,
          value: originalPush,
        });
        Object.defineProperty(Array.prototype, "join", {
          configurable: true,
          value: originalJoin,
        });
      }

      assertEquals(
        events.filter((event) => typeof event.type === "string" && event.type.startsWith("text-")),
        [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "safe" },
          { type: "text-end", id: "text-1" },
        ],
      );
    });
  }
});
