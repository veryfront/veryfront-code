import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiRuntimeEventEncoder } from "./ag-ui-runtime-event-encoder.ts";

describe("agent/ag-ui-runtime-event-encoder", () => {
  it("enriches tool results with the last captured tool input", () => {
    const encoder = createAgUiRuntimeEventEncoder();

    assertEquals(
      encoder.encode({
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "search_docs",
      }),
      [{
        event: "ToolCallStart",
        payload: {
          toolCallId: "tool-1",
          toolCallName: "search_docs",
        },
      }],
    );

    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "search_docs",
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
        type: "tool-output-available",
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

  it("seeds metadata into the shared browser encoder state", () => {
    const encoder = createAgUiRuntimeEventEncoder({
      initialMetadata: {
        provider: "openai",
        model: "openai/gpt-5.4",
      },
    });

    assertEquals(encoder.state.metadata, {
      provider: "openai",
      model: "openai/gpt-5.4",
    });
  });
});
