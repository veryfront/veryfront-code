import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiRuntimeEventEncoder } from "./runtime-event-encoder.ts";

describe("agent/ag-ui-runtime-event-encoder", () => {
  it("enriches tool results with the last captured tool input", () => {
    const encoder = createAgUiRuntimeEventEncoder({ timing: { nowMs: null, epochMs: null } });

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
          content: { ok: true },
        },
      }],
    );
  });

  it("seeds metadata into the shared encoder state", () => {
    const encoder = createAgUiRuntimeEventEncoder({
      timing: { nowMs: null, epochMs: null },
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
  // #2117: the chat path shares finalizeAgUiEvents with the hosted run stream, so a
  // schema-bound response also reports its parsed object on chat RunFinished events.
  it("reports a schema-bound response's parsed object as RunFinished.result", () => {
    const encoder = createAgUiRuntimeEventEncoder({ timing: { nowMs: null, epochMs: null } });
    encoder.encode({ type: "text-delta", delta: '{"category":"billing"}' });

    const runFinished = encoder.finalize({
      text: '{"category":"billing"}',
      object: { category: "billing" },
      messages: [],
      toolCalls: [],
      status: "completed",
    }).find((event) => event.event === "RunFinished");

    assertEquals(runFinished?.payload.result, { category: "billing" });
  });

  it("omits RunFinished.result when the response carries no parsed object", () => {
    const encoder = createAgUiRuntimeEventEncoder({ timing: { nowMs: null, epochMs: null } });
    encoder.encode({ type: "text-delta", delta: "plain text" });

    const runFinished = encoder.finalize({
      text: "plain text",
      messages: [],
      toolCalls: [],
      status: "completed",
    }).find((event) => event.event === "RunFinished");

    assertEquals(runFinished === undefined, false);
    assertEquals(Object.hasOwn(runFinished?.payload ?? {}, "result"), false);
  });
});
