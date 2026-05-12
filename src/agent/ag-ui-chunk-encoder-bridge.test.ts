import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiChunkEncoderBridge } from "./ag-ui-chunk-encoder-bridge.ts";

describe("agent/ag-ui-chunk-encoder-bridge", () => {
  it("maps host chunks through runtime events into browser AG-UI events", () => {
    const bridge = createAgUiChunkEncoderBridge<{
      id: string;
      text: string;
    }>({
      getRuntimeEvents: (chunk) => [
        { type: "message-start", messageId: chunk.id },
        { type: "text-start", id: chunk.id },
        { type: "text-delta", id: chunk.id, delta: chunk.text },
        { type: "text-end", id: chunk.id },
      ],
    });

    const events = bridge.encode({ id: "msg-1", text: "hello" });

    assertEquals(
      events.map((event) => event.event),
      ["TextMessageStart", "TextMessageContent", "TextMessageEnd"],
    );
  });

  it("reuses one encoder state across chunks and finalization", () => {
    const bridge = createAgUiChunkEncoderBridge<{ messageId: string }>({
      getRuntimeEvents: (chunk) => [{ type: "message-start", messageId: chunk.messageId }],
    });

    bridge.encode({ messageId: "msg-1" });
    const finalEvents = bridge.finalize({
      text: "",
      messages: [],
      toolCalls: [],
      status: "completed",
      metadata: { finishReason: "stop" },
    });

    assertEquals(bridge.state.messageId, "msg-1");
    assertEquals(finalEvents.length > 0, true);
  });
});
