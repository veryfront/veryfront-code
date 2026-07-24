import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInitialReducerState } from "./reducer.ts";
import { decodeRuntimeStreamPart } from "./runtime-provider-adapter.ts";

const snapshot = createInitialReducerState().snapshot;
const options = {
  availableToolNames: new Set(["create_file", "web_search"]),
  providerExecutedToolNames: new Set(["web_search"]),
};

describe("runtime stream Provider Adapter", () => {
  it("maps runtime parts to provider-neutral signals", () => {
    assertEquals(
      decodeRuntimeStreamPart(
        { type: "text-delta", text: "hi" },
        snapshot,
        options,
      ),
      [{ kind: "protocol", event: { type: "text_content", delta: "hi" } }],
    );
    assertEquals(
      decodeRuntimeStreamPart(
        {
          type: "data-tool-call-status",
          data: { toolCallId: "t1", status: "pending_input" },
        },
        snapshot,
        options,
      ),
      [],
    );
  });

  it("normalizes result and output payload names", () => {
    const toolSnapshot = {
      ...snapshot,
      tools: [{
        id: "native-1",
        name: "web_search",
        phase: "input_ready" as const,
        inputText: "{}",
        inputDeltas: [],
        input: {},
        providerExecuted: true,
      }],
    };
    assertEquals(
      decodeRuntimeStreamPart(
        {
          type: "tool-result",
          toolCallId: "native-1",
          toolName: "web_search",
          result: { answer: 42 },
        },
        toolSnapshot,
        options,
      ),
      [
        {
          kind: "protocol",
          event: {
            type: "provider_tool_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        },
        {
          kind: "protocol",
          event: {
            type: "provider_tool_result",
            toolCallId: "native-1",
            toolName: "web_search",
            output: { answer: 42 },
            isError: false,
            providerExecuted: true,
          },
        },
      ],
    );
  });

  it("rejects unavailable tools before handoff", () => {
    assertEquals(
      decodeRuntimeStreamPart(
        {
          type: "tool-input-start",
          id: "missing-1",
          toolName: "missing_tool",
        },
        snapshot,
        options,
      )[0],
      {
        kind: "protocol",
        event: {
          type: "tool_input_rejected",
          toolCallId: "missing-1",
          toolName: "missing_tool",
          reason: "unavailable",
        },
      },
    );
  });

  it("turns unknown provider parts into diagnostic candidates", () => {
    assertEquals(
      decodeRuntimeStreamPart(
        { type: "future-part", secret: "<REDACTED>" },
        snapshot,
        options,
      ),
      [{
        kind: "diagnostic_candidate",
        candidate: {
          kind: "unknown_runtime_part",
          value: { partType: "future-part" },
        },
      }],
    );
  });
});
