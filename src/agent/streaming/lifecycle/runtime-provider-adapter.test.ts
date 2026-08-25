import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInitialReducerState } from "./reducer.ts";
import {
  classifyRuntimeProviderError,
  decodeRuntimeStreamPart,
} from "./runtime-provider-adapter.ts";

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
    assertEquals(
      decodeRuntimeStreamPart(
        { type: "tool-call", toolCallId: "c1", toolName: "missing_tool", input: {} },
        snapshot,
        options,
      )[0],
      {
        kind: "protocol",
        event: {
          type: "tool_input_rejected",
          toolCallId: "c1",
          toolName: "missing_tool",
          reason: "unavailable",
        },
      },
      "a tool-call for an unavailable tool must be rejected, never handed to execution",
    );
    assertEquals(
      decodeRuntimeStreamPart(
        { type: "tool-input-available", toolCallId: "c1", toolName: "missing_tool", input: {} },
        snapshot,
        options,
      )[0],
      {
        kind: "protocol",
        event: {
          type: "tool_input_rejected",
          toolCallId: "c1",
          toolName: "missing_tool",
          reason: "unavailable",
        },
      },
      "an available tool input for an unavailable tool must be rejected, never handed to execution",
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

  it("uses fixed public text for unknown runtime provider errors", () => {
    const error = classifyRuntimeProviderError(
      new Error("raw provider failure sentinel"),
    );

    assertEquals(error, {
      code: "PROVIDER_STREAM_ERROR",
      publicMessage: "Provider stream failed",
      retryable: true,
      terminal: false,
    });
  });

  it("maps recognized terminal provider errors to non-retryable terminal failures", () => {
    const error = classifyRuntimeProviderError(
      Object.assign(new Error("schema"), {
        responseBody: "Invalid Veryfront schema: defineSchema missing",
      }),
    );

    assertEquals(
      error.code,
      "PROJECT_SCHEMA_ERROR",
      "a recognized provider failure keeps its specific code",
    );
    assertEquals(
      error.retryable,
      false,
      "a recognized terminal provider failure must not be retried",
    );
    assertEquals(
      error.terminal,
      true,
      "a recognized terminal provider failure must be marked terminal",
    );
  });
});
