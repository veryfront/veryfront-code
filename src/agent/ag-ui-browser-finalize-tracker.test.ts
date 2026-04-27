import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiBrowserFinalizeTracker } from "./ag-ui-browser-finalize-tracker.ts";

describe("agent/ag-ui-browser-finalize-tracker", () => {
  it("builds a final response from observed chunk metadata", () => {
    const tracker = createAgUiBrowserFinalizeTracker<{
      usage?: { inputTokens?: number; outputTokens?: number };
      finishReason?: string;
    }>({
      getMetadataFromChunk: (chunk) => ({
        inputTokens: chunk.usage?.inputTokens,
        outputTokens: chunk.usage?.outputTokens,
        finishReason: chunk.finishReason,
      }),
    });

    tracker.observeChunk({
      usage: { inputTokens: 3, outputTokens: 5 },
      finishReason: "stop",
    });

    assertEquals(tracker.getFinalResponse(), {
      text: "",
      messages: [],
      toolCalls: [],
      status: "completed",
      usage: {
        promptTokens: 3,
        completionTokens: 5,
        totalTokens: 8,
      },
      metadata: {
        finishReason: "stop",
      },
    });
  });

  it("suppresses the final response after a RunError event", () => {
    const tracker = createAgUiBrowserFinalizeTracker<{
      finishReason?: string;
    }>({
      getMetadataFromChunk: (chunk) => ({
        finishReason: chunk.finishReason,
      }),
    });

    tracker.observeChunk({ finishReason: "stop" });
    tracker.observeEncodedEvents([{ event: "RunError", payload: { message: "boom" } }]);

    assertEquals(tracker.getFinalResponse(), null);
  });
});
