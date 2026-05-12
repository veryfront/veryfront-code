import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiRuntimeBrowserResponse } from "./ag-ui-runtime-browser-response.ts";

describe("agent/ag-ui-runtime-browser-response", () => {
  it("normalizes browser runtime defaults and wraps the stream in SSE headers", async () => {
    const response = createAgUiRuntimeBrowserResponse({
      agUiInput: {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        state: "ignored",
        messages: [],
        tools: [],
        context: [],
      },
      defaults: {
        threadId: crypto.randomUUID(),
        runId: "run_override",
      },
      agentId: "agent-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield "chunk-1";
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      encoder: {
        encode: (chunk) => [{ event: "Custom", payload: { chunk } }],
        finalize: () => [],
      },
      initialState: { seen: false },
    });

    assertEquals(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const text = await response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, '"runId":"run_override"');
    assertStringIncludes(text, "event: StateSnapshot");
    assertStringIncludes(text, '"snapshot":{}');
    assertStringIncludes(text, "event: Custom");
    assertStringIncludes(text, '"chunk":"chunk-1"');
  });

  it("passes chunk observers and final response builders through to the browser stream", async () => {
    const seen: string[] = [];

    const response = createAgUiRuntimeBrowserResponse({
      agUiInput: {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        state: { phase: "draft" },
        messages: [],
        tools: [],
        context: [],
      },
      agentId: "agent-1",
      execution: {
        agentUIStream: {
          async *[Symbol.asyncIterator]() {
            yield "chunk-1";
          },
        },
        fail: async () => {},
        waitForFinish: async () => {},
      },
      encoder: {
        encode: (chunk) => [{ event: "Custom", payload: { chunk } }],
        finalize: (result) => [{ event: "Done", payload: { result } }],
      },
      initialState: { finishReason: "" },
      onChunk: (state, chunk) => {
        seen.push(chunk);
        state.finishReason = "stop";
      },
      getFinalResponse: (state) => ({
        text: "",
        messages: [],
        toolCalls: [],
        status: "completed",
        metadata: {
          finishReason: state.finishReason,
        },
      }),
    });

    const text = await response.text();
    assertEquals(seen, ["chunk-1"]);
    assertStringIncludes(text, "event: Done");
    assertStringIncludes(text, '"finishReason":"stop"');
  });
});
