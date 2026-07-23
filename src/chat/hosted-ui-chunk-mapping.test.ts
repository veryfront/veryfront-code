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
    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "error",
        error: new DOMException("request aborted", "AbortError"),
      }),
      [{ type: "error", errorText: "request aborted" }],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "reasoning-end",
        id: "reasoning-1",
        signature: "sig_123",
        redactedData: "encrypted",
      }),
      [{
        type: "reasoning-end",
        id: "reasoning-1",
        signature: "sig_123",
        redactedData: "encrypted",
      }],
    );
    assertEquals(mapHostedStreamPartToChatUiChunks({ type: "finish" }), [{ type: "finish" }]);
  });

  it("suppresses the complete reasoning lifecycle when reasoning is disabled", () => {
    const options = { sendReasoning: false };

    assertEquals(
      mapHostedStreamPartToChatUiChunks({ type: "reasoning-start", id: "reasoning-1" }, options),
      [],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "reasoning-delta",
        id: "reasoning-1",
        text: "private",
      }, options),
      [],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks({ type: "reasoning-end", id: "reasoning-1" }, options),
      [],
    );
  });

  it("drops unsafe source URLs and bounds public error text", () => {
    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "source",
        sourceType: "url",
        id: "unsafe",
        url: "javascript:alert(1)",
      }),
      [],
    );

    const chunks = mapHostedStreamPartToChatUiChunks({
      type: "error",
      error: new Error(`unsafe\n${"x".repeat(3_000)}`),
    });
    assertEquals(chunks[0]?.type, "error");
    if (chunks[0]?.type === "error") {
      assertEquals(chunks[0].errorText.includes("\n"), false);
      assertEquals(chunks[0].errorText.length, 2_048);
    }

    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "file",
        file: { mediaType: "image/svg+xml", base64: "PHN2Zy8+" },
      }),
      [],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "file",
        file: { mediaType: "image/png", base64: "iVBORw0KGgo=" },
      }),
      [{
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,iVBORw0KGgo=",
      }],
    );
  });

  it("does not invoke error accessors or coercion hooks", () => {
    let calls = 0;
    const error = {
      get message() {
        calls += 1;
        return "private message";
      },
      toString() {
        calls += 1;
        return "private string";
      },
    };

    assertEquals(mapHostedStreamPartToChatUiChunks({ type: "error", error }), [{
      type: "error",
      errorText: "Stream processing failed",
    }]);
    assertEquals(calls, 0);
  });
});
