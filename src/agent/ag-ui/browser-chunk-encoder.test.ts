import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiBrowserChunkEncoder } from "./browser-chunk-encoder.ts";

describe("agent/ag-ui-browser-chunk-encoder", () => {
  it("merges chunk metadata into the browser finalize response", () => {
    const encoder = createAgUiBrowserChunkEncoder<{
      id: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      finishReason?: string;
    }>({
      getRuntimeEvents: (chunk) => [
        { type: "message-start", messageId: chunk.id },
        { type: "text-delta", id: chunk.id, delta: "hello" },
      ],
      getMetadataFromChunk: (chunk) => ({
        inputTokens: chunk.usage?.inputTokens,
        outputTokens: chunk.usage?.outputTokens,
        finishReason: chunk.finishReason,
      }),
      initialMetadata: {
        provider: "openai",
        model: "openai/gpt-5.4",
      },
    });

    encoder.encode({
      id: "msg-1",
      usage: { inputTokens: 2, outputTokens: 3 },
      finishReason: "stop",
    });

    assertEquals(encoder.finalize(null), [
      {
        event: "TextMessageEnd",
        payload: {
          messageId: "msg-1",
          contentId: "text:0",
        },
      },
      {
        event: "RunFinished",
        payload: {
          metadata: {
            provider: "openai",
            model: "openai/gpt-5.4",
            inputTokens: 2,
            outputTokens: 3,
            finishReason: "stop",
          },
        },
      },
    ]);
  });

  it("preserves runtime-event tool input enrichment through chunk mapping", () => {
    const encoder = createAgUiBrowserChunkEncoder<{
      kind: "input" | "output";
      toolCallId: string;
      input?: unknown;
      output?: unknown;
    }>({
      getRuntimeEvents: (chunk) =>
        chunk.kind === "input"
          ? [{
            type: "tool-input-available",
            toolCallId: chunk.toolCallId,
            toolName: "search_docs",
            input: chunk.input,
          }]
          : [{
            type: "tool-output-available",
            toolCallId: chunk.toolCallId,
            output: chunk.output,
          }],
    });

    assertEquals(
      encoder.encode({
        kind: "input",
        toolCallId: "tool-1",
        input: { query: "ag-ui" },
      }),
      [
        {
          event: "ToolCallArgs",
          payload: {
            toolCallId: "tool-1",
            delta: '{"query":"ag-ui"}',
          },
        },
        {
          event: "ToolCallEnd",
          payload: {
            toolCallId: "tool-1",
          },
        },
      ],
    );

    assertEquals(
      encoder.encode({
        kind: "output",
        toolCallId: "tool-1",
        output: { ok: true },
      }),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "tool-1",
          input: { query: "ag-ui" },
          result: { ok: true },
        },
      }],
    );
  });
});
