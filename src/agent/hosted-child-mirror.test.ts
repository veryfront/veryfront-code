import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendHostedChildMirrorChunk,
  closeHostedChildReasoningSegment,
  closeHostedChildTextSegment,
  isAlreadyMirroredHostedChunk,
  toMirroredHostedStreamPart,
} from "./hosted-child-mirror.ts";

describe("agent/hosted-child-mirror", () => {
  it("tracks mirrored chunk duplicates by part type", () => {
    assertEquals(isAlreadyMirroredHostedChunk("reasoning-delta", "reasoning-delta"), true);
    assertEquals(isAlreadyMirroredHostedChunk("tool-call", "tool-input-start"), true);
    assertEquals(isAlreadyMirroredHostedChunk("tool-result", "tool-output-available"), true);
    assertEquals(isAlreadyMirroredHostedChunk("error", "text-delta"), false);
  });

  it("maps hosted mirror parts onto hosted stream parts", () => {
    assertEquals(
      toMirroredHostedStreamPart({ type: "text-delta", text: "hello" }, {
        messageId: "msg-1",
        reasoningMessageId: "reason-1",
      }),
      {
        type: "text-delta",
        id: "msg-1",
        text: "hello",
      },
    );

    assertEquals(
      toMirroredHostedStreamPart(
        { type: "tool-input-start", toolCallId: "tc-1", toolName: "bash" },
        {
          messageId: "msg-1",
          reasoningMessageId: "reason-1",
        },
      ),
      {
        type: "tool-input-start",
        id: "tc-1",
        toolName: "bash",
      },
    );
  });

  it("appends hosted child chunks when a mirror exists", async () => {
    const handled: unknown[] = [];
    const result = await appendHostedChildMirrorChunk({
      mirror: {
        handleChunk: (chunk) => {
          handled.push(chunk);
        },
      },
      chunk: { type: "text-delta", id: "msg-1", delta: "hi" },
    });
    assertEquals(result, true);
    assertEquals(handled, [{ type: "text-delta", id: "msg-1", delta: "hi" }]);
  });

  it("closes reasoning and text segments when active", async () => {
    const handled: unknown[] = [];
    const state = { reasoningStarted: true, textStarted: true };
    const mirror = {
      handleChunk: (chunk: unknown) => {
        handled.push(chunk);
      },
    };

    await closeHostedChildReasoningSegment({
      mirror,
      reasoningMessageId: "r-1",
      state,
    });
    await closeHostedChildTextSegment({
      mirror,
      messageId: "msg-1",
      state,
    });

    assertEquals(handled, [
      { type: "reasoning-end", id: "r-1" },
      { type: "text-end", id: "msg-1" },
    ]);
    assertEquals(state, { reasoningStarted: false, textStarted: false });
  });
});
