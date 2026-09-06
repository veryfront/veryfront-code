import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mapHostedStreamPartToChatUiChunks } from "./hosted-ui-chunk-mapping.ts";

describe("chat/hosted-ui-chunk-mapping", () => {
  it("suppresses the complete reasoning lifecycle when reasoning is disabled", () => {
    const options = { sendReasoning: false };

    assertEquals(
      mapHostedStreamPartToChatUiChunks(
        { type: "reasoning-start", id: "reasoning-1" },
        options,
      ),
      [],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks(
        { type: "reasoning-delta", id: "reasoning-1", text: "private" },
        options,
      ),
      [],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks(
        {
          type: "reasoning-end",
          id: "reasoning-1",
          signature: "sig_123",
          redactedData: "encrypted",
        },
        options,
      ),
      [],
    );
  });

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

    const knowledgePath = "knowledge/knowledge-ingest-exact.md";
    assertEquals(
      mapHostedStreamPartToChatUiChunks({
        type: "tool-result",
        toolCallId: "tool-knowledge",
        toolName: "get_file",
        input: { path: knowledgePath },
        output: { path: knowledgePath, content: "# Exact source" },
      }),
      [
        {
          type: "tool-output-available",
          toolCallId: "tool-knowledge",
          output: { path: knowledgePath, content: "# Exact source" },
        },
        {
          type: "source-document",
          sourceId: knowledgePath,
          mediaType: "text/markdown",
          title: knowledgePath,
          filename: knowledgePath,
        },
      ],
    );

    assertEquals(
      mapHostedStreamPartToChatUiChunks(
        {
          type: "tool-result",
          toolCallId: "tool-knowledge-hidden",
          toolName: "get_file",
          input: { path: knowledgePath },
          output: { path: knowledgePath, content: "# Exact source" },
        },
        { sendSources: false },
      ),
      [{
        type: "tool-output-available",
        toolCallId: "tool-knowledge-hidden",
        output: { path: knowledgePath, content: "# Exact source" },
      }],
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

  it("preserves a terminal code while keeping custom error formatting", () => {
    assertEquals(
      mapHostedStreamPartToChatUiChunks(
        {
          type: "error",
          error: new Error("raw child error"),
          code: "INSUFFICIENT_CREDITS",
        },
        { onError: () => "Purchase additional credits." },
      ),
      [{
        type: "error",
        errorText: "Purchase additional credits.",
        code: "INSUFFICIENT_CREDITS",
      }],
    );
    assertEquals(
      mapHostedStreamPartToChatUiChunks(
        { type: "error", error: new Error("Legacy failure") },
        { onError: () => "Formatted legacy failure" },
      ),
      [{ type: "error", errorText: "Formatted legacy failure" }],
    );
  });
});
