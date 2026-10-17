import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sendSSE } from "#veryfront/agent/runtime/sse-utils.ts";
import { createChatUiMessageStreamFromDataStream } from "#veryfront/agent/streaming/chat-ui-message-stream.ts";
import { withRuntimeStreamOwnership } from "./runtime-stream-ownership.ts";
import {
  currentToolResultSequence,
  getToolResultSequence,
  runWithToolResultSequence,
} from "./tool-result-sequence.ts";

describe("managed result producer positions", () => {
  it("keeps a setup-time nested stream from claiming the root before its message-start", async () => {
    const sessionId = crypto.randomUUID();
    const encoder = new TextEncoder();
    let afterNested: ReturnType<typeof currentToolResultSequence>;
    let afterRoot: ReturnType<typeof currentToolResultSequence>;
    await runWithToolResultSequence(sessionId, () =>
      withRuntimeStreamOwnership(async () => {
        // A user-defined system prompt may start another agent before the
        // outer runtime has created its own ReadableStream.
        await withRuntimeStreamOwnership(async () => {
          const nested = new ReadableStream<Uint8Array>({
            start(controller) {
              sendSSE(controller, encoder, { type: "message-start", messageId: "nested" });
              sendSSE(controller, encoder, {
                type: "tool-output-available",
                toolCallId: "nested-call",
                output: {},
              });
              controller.close();
            },
          });
          await nested.cancel();
        });
        afterNested = currentToolResultSequence();
        const root = new ReadableStream<Uint8Array>({
          start(controller) {
            sendSSE(controller, encoder, { type: "message-start", messageId: "root" });
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: "root-call",
              output: {},
            });
            afterRoot = currentToolResultSequence();
            controller.close();
          },
        });
        await root.cancel();
      }));
    assertEquals(afterNested, { sessionId, ordinal: 0 });
    assertEquals(afterRoot, { sessionId, ordinal: 1 });
  });

  it("does not count a nested agent stream inherited from the root execution scope", async () => {
    const sessionId = crypto.randomUUID();
    const encoder = new TextEncoder();
    let afterNested: ReturnType<typeof currentToolResultSequence>;
    let afterRoot: ReturnType<typeof currentToolResultSequence>;
    const root = runWithToolResultSequence(sessionId, () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          sendSSE(controller, encoder, { type: "message-start", messageId: "root" });
          new ReadableStream<Uint8Array>({
            start(nested) {
              sendSSE(nested, encoder, { type: "message-start", messageId: "nested" });
              sendSSE(nested, encoder, {
                type: "tool-output-available",
                toolCallId: "nested-call",
                output: {},
              });
              nested.close();
            },
          });
          afterNested = currentToolResultSequence();
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: "root-call",
            output: {},
          });
          afterRoot = currentToolResultSequence();
          controller.close();
        },
      }));
    await root.cancel();
    assertEquals(afterNested, { sessionId, ordinal: 0 });
    assertEquals(afterRoot, { sessionId, ordinal: 1 });
  });

  it("shares the host session across stream pulls and removes positions from public chunks", async () => {
    const sessionId = crypto.randomUUID();
    let observedDuringPull: ReturnType<typeof currentToolResultSequence>;
    const encoder = new TextEncoder();
    const stream = runWithToolResultSequence(sessionId, () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          observedDuringPull = currentToolResultSequence();
          sendSSE(controller, encoder, { type: "message-start", messageId: "message-1" });
          sendSSE(controller, encoder, {
            type: "tool-input-start",
            toolCallId: "call-1",
            toolName: "reader",
          });
          sendSSE(controller, encoder, {
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "reader",
            input: {},
          });
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: "call-1",
            output: { ok: true },
          });
          sendSSE(controller, encoder, { type: "message-finish" });
          controller.close();
        },
      }));
    const chunks = await Array.fromAsync(
      createChatUiMessageStreamFromDataStream({ stream }, {
        privateToolResultSequences: true,
      }),
    );
    const result = chunks.find((chunk) => chunk.type === "tool-output-available");
    assert(result);
    assertEquals(observedDuringPull, { sessionId, ordinal: 0 });
    assertEquals(getToolResultSequence(result), { sessionId, ordinal: 1 });
    assertEquals(JSON.stringify(result).includes("privateToolResultSequence"), false);
  });
});
