import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mapHostedStreamPartToChatUiChunks } from "./hosted-ui-chunk-mapping.ts";

describe("chat/hosted-ui-chunk-mapping", () => {
  it("maps hosted stream parts into chat UI chunks", () => {
    assertEquals(mapHostedStreamPartToChatUiChunks({ type: "start" }, { messageId: "msg-1" }), [
      { type: "start", messageId: "msg-1" },
    ]);

    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "source",
        sourceType: "url",
        id: "src-1",
        url: "https://example.com",
        title: "Example",
      }),
      [{ type: "source-url", sourceId: "src-1", url: "https://example.com", title: "Example" }],
    );

    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "tool-input-delta",
        id: "tool-1",
        delta: '{"q":"voice"}',
      }),
      [{ type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"q":"voice"}' }],
    );

    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "tool-error",
        toolCallId: "tool-1",
        toolName: "web_search",
        input: { q: "voice ai" },
        error: new Error("provider timeout"),
      }),
      [
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "web_search" },
        {
          type: "tool-input-error",
          toolCallId: "tool-1",
          toolName: "web_search",
          input: { q: "voice ai" },
          errorText: "provider timeout",
        },
      ],
    );

    assertEquals(mapHostedStreamPartToChatUiChunks({ type: "abort" }), [{ type: "abort" }]);
    assertEquals(mapHostedStreamPartToChatUiChunks({ type: "finish" }), [{ type: "finish" }]);
  });
});
