import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureStreamedToolCallInput,
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  collectPersistedToolResults,
  isRecoverablePlaceholderToolCall,
  isStreamedToolCallIncomplete,
  materializeStreamedToolCall,
  shouldContinueAfterStreamStep,
} from "./tool-result-continuation.ts";
import type { ChatStreamState } from "./chat-stream-handler.ts";
import type { Message } from "../types.ts";

function createState(
  toolResults: ChatStreamState["toolResults"],
): Pick<ChatStreamState, "toolResults"> {
  return { toolResults };
}

describe("agent runtime streamed tool result collection", () => {
  it("continues after suppressing unavailable streamed tool calls", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "I will reload the skill.",
      finishReason: "tool-calls",
      toolCalls: new Map(),
      toolResults: [],
      suppressedToolCalls: [{ id: "tc-stale", name: "load_skill" }],
    });

    assertEquals(shouldContinue, true);
  });

  it("continues after provider-executed tool results arrive without assistant text", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "stop",
      toolCalls: new Map([
        [
          "toolu_provider_1",
          {
            id: "toolu_provider_1",
            name: "gmail__get_email",
            arguments: '{"messageId":"missing-message"}',
            inputAvailable: true,
            providerExecuted: true,
            dynamic: true,
          },
        ],
      ]),
      toolResults: [
        {
          toolCallId: "toolu_provider_1",
          toolName: "gmail__get_email",
          output: { error: "tool_error", message: "Requested entity was not found." },
          providerExecuted: true,
          dynamic: true,
        },
      ],
    });

    assertEquals(shouldContinue, true);
  });

  it("stops after provider-executed tool results when the assistant already answered", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "I found two likely junk messages.",
      finishReason: "stop",
      toolCalls: new Map([
        [
          "toolu_provider_2",
          {
            id: "toolu_provider_2",
            name: "gmail__list_emails",
            arguments: '{"labelIds":["INBOX"]}',
            inputAvailable: true,
            providerExecuted: true,
            dynamic: true,
          },
        ],
      ]),
      toolResults: [
        {
          toolCallId: "toolu_provider_2",
          toolName: "gmail__list_emails",
          output: { data: [] },
          providerExecuted: true,
          dynamic: true,
        },
      ],
    });

    assertEquals(shouldContinue, false);
  });

  it("stops after provider-executed tool errors when the stream finished with error", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "error",
      toolCalls: new Map([
        [
          "toolu_provider_error",
          {
            id: "toolu_provider_error",
            name: "web_search",
            arguments: '{"query":"Veryfront"}',
            inputAvailable: true,
            providerExecuted: true,
            dynamic: true,
          },
        ],
      ]),
      toolResults: [
        {
          toolCallId: "toolu_provider_error",
          toolName: "web_search",
          error: "Provider timeout",
          providerExecuted: true,
          dynamic: true,
        },
      ],
    });

    assertEquals(shouldContinue, false);
  });

  it("continues normal client-executed tool-call steps", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "toolu_client_1",
          {
            id: "toolu_client_1",
            name: "read_file",
            arguments: '{"path":"app/page.tsx"}',
            inputAvailable: true,
          },
        ],
      ]),
      toolResults: [],
    });

    assertEquals(shouldContinue, true);
  });

  it("stops after an unfinalized streamed tool call to avoid retry loops", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "toolu_incomplete_1",
          {
            id: "toolu_incomplete_1",
            name: "load_skill_reference",
            arguments: '{"skillId":"dora"',
            inputAvailable: false,
          },
        ],
      ]),
      toolResults: [],
    });

    assertEquals(shouldContinue, false);
  });

  it("stops instead of retrying when a step has both finalized and unfinalized tool calls", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "toolu_complete_1",
          {
            id: "toolu_complete_1",
            name: "load_skill",
            arguments: '{"skillId":"dora"}',
            inputAvailable: true,
          },
        ],
        [
          "toolu_incomplete_1",
          {
            id: "toolu_incomplete_1",
            name: "load_skill_reference",
            arguments: '{"skillId":"dora"',
            inputAvailable: false,
          },
        ],
      ]),
      toolResults: [],
    });

    assertEquals(shouldContinue, false);
  });

  it("continues finalized client-executed tool calls when the provider reports stop", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "stop",
      toolCalls: new Map([
        [
          "toolu_client_stop_1",
          {
            id: "toolu_client_stop_1",
            name: "number-generator",
            arguments: '{"min":1,"max":100}',
            inputAvailable: true,
          },
        ],
      ]),
      toolResults: [],
    });

    assertEquals(shouldContinue, true);
  });

  it("ignores preliminary streamed tool results when a final result exists", () => {
    const finalToolResults = collectFinalStreamToolResults(
      createState([
        {
          toolCallId: "tool-1",
          toolName: "list_files",
          output: { files: [] },
          preliminary: true,
        },
        {
          toolCallId: "tool-1",
          toolName: "list_files",
          output: { files: ["app.tsx"] },
        },
      ]),
    );

    assertEquals(finalToolResults.size, 1);
    assertEquals(finalToolResults.get("tool-1")?.output, { files: ["app.tsx"] });
  });

  it("keeps only one final streamed tool result per tool call id", () => {
    const finalToolResults = collectFinalStreamToolResults(
      createState([
        {
          toolCallId: "tool-2",
          toolName: "create_file",
          output: { ok: false, retry: true },
        },
        {
          toolCallId: "tool-2",
          toolName: "create_file",
          output: { ok: true },
        },
      ]),
    );

    assertEquals(finalToolResults.size, 1);
    assertEquals(finalToolResults.get("tool-2")?.output, { ok: true });
  });

  it("collects the latest persisted tool result from message history", () => {
    const persistedToolResults = collectPersistedToolResults([
      {
        id: "assistant_1",
        role: "assistant",
        parts: [{
          type: "tool-form_input",
          toolCallId: "tool-3",
          toolName: "form_input",
          args: { label: "What kind of bank?" },
        }],
      } as Message,
      {
        id: "tool_3_old",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "tool-3",
          toolName: "form_input",
          result: { submitted: false },
        }],
      },
      {
        id: "tool_3_new",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "tool-3",
          toolName: "form_input",
          result: { submitted: true },
        }],
      },
    ]);

    assertEquals(persistedToolResults.size, 1);
    assertEquals(persistedToolResults.get("tool-3")?.result, { submitted: true });
  });

  it("collects the latest generated tool result from direct model output", () => {
    const generatedToolResults = collectGeneratedToolResults([
      {
        toolCallId: "tool-4",
        toolName: "web_search",
        result: { ok: false },
      },
      {
        toolCallId: "tool-4",
        toolName: "web_search",
        result: { ok: true },
      },
    ]);

    assertEquals(generatedToolResults.size, 1);
    assertEquals(generatedToolResults.get("tool-4")?.result, { ok: true });
  });

  it("preserves raw streamed tool input text when parsing fails", () => {
    const captured = captureStreamedToolCallInput({
      arguments: '{"query":"AI ontologies research"',
    });

    assertEquals(captured.args, {});
    assertEquals(captured.inputText, '{"query":"AI ontologies research"');
    assertEquals(typeof captured.parseError, "string");
  });

  it("preserves raw streamed tool input text when parsing succeeds", () => {
    const captured = captureStreamedToolCallInput({
      arguments: '{"query":"AI ontologies research"}',
    });

    assertEquals(captured.args, { query: "AI ontologies research" });
    assertEquals(captured.inputText, '{"query":"AI ontologies research"}');
    assertEquals(captured.parseError, undefined);
  });

  it("flags a streamed tool call as incomplete when inputAvailable is false", () => {
    assertEquals(
      isStreamedToolCallIncomplete({ inputAvailable: false }),
      true,
    );
  });

  it("flags a streamed tool call as incomplete when inputAvailable is missing", () => {
    // `inputAvailable` is optional on StreamingToolCall and is only set to
    // `true` once the provider emits the finalizing tool-call event. An
    // undefined value means the stream terminated (abort, stall, transport
    // error) before finalization and the accumulated `arguments` is only a
    // partial delta fragment, NOT a committed tool-argument JSON.
    assertEquals(
      isStreamedToolCallIncomplete({}),
      true,
    );
  });

  it("treats a streamed tool call as complete only when inputAvailable is true", () => {
    assertEquals(
      isStreamedToolCallIncomplete({ inputAvailable: true }),
      false,
    );
  });

  it("classifies a non-finalized empty-object placeholder as recoverable", () => {
    assertEquals(
      isRecoverablePlaceholderToolCall({ inputAvailable: false, arguments: "{}" }),
      true,
    );
    assertEquals(
      isRecoverablePlaceholderToolCall({ inputAvailable: false, arguments: "" }),
      true,
    );
    assertEquals(
      isRecoverablePlaceholderToolCall({ inputAvailable: undefined, arguments: "{}{}" }),
      true,
    );
  });

  it("does not classify truncated partial JSON as a recoverable placeholder", () => {
    assertEquals(
      isRecoverablePlaceholderToolCall({
        inputAvailable: false,
        arguments: '{"skillId":"dora"',
      }),
      false,
    );
  });

  it("does not classify a finalized tool call as a recoverable placeholder", () => {
    assertEquals(
      isRecoverablePlaceholderToolCall({ inputAvailable: true, arguments: "{}" }),
      false,
    );
  });

  it("recovers a provisional empty-object placeholder by continuing the loop", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "toolu_placeholder_1",
          {
            id: "toolu_placeholder_1",
            name: "review",
            arguments: "{}",
            inputAvailable: false,
          },
        ],
      ]),
      toolResults: [],
    });

    assertEquals(shouldContinue, true);
  });

  it("does not recover provider-executed placeholders by re-calling the model", () => {
    const shouldContinue = shouldContinueAfterStreamStep({
      accumulatedText: "",
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "toolu_provider_placeholder",
          {
            id: "toolu_provider_placeholder",
            name: "web_search",
            arguments: "{}",
            inputAvailable: false,
            providerExecuted: true,
          },
        ],
      ]),
      toolResults: [],
    });

    assertEquals(shouldContinue, false);
  });

  it("materializes a complete streamed tool call into a ready-to-execute part", () => {
    const materialized = materializeStreamedToolCall({
      id: "toolu_complete",
      name: "write_file",
      arguments: '{"path":"/plans/report.md","content":"# Summary"}',
      inputAvailable: true,
    });

    assertEquals(materialized.kind, "complete");
    assertEquals(materialized.part.type, "tool-write_file");
    assertEquals(
      (materialized.part as { toolCallId: string }).toolCallId,
      "toolu_complete",
    );
    assertEquals(
      (materialized.part as { args: Record<string, unknown> }).args,
      { path: "/plans/report.md", content: "# Summary" },
    );
    assertEquals(
      (materialized.part as { inputText?: string }).inputText,
      '{"path":"/plans/report.md","content":"# Summary"}',
    );
  });

  it("marks provider-executed streamed tool calls as provider-owned history", () => {
    const materialized = materializeStreamedToolCall({
      id: "toolu_provider",
      name: "web_search",
      arguments: '{"query":"Swedish tax residency"}',
      inputAvailable: true,
      providerExecuted: true,
    });

    assertEquals(materialized.kind, "complete");
    assertEquals(
      (materialized.part as { providerExecuted?: boolean }).providerExecuted,
      true,
    );
  });

  it("materializes a parse-error streamed tool call without parsing executable args", () => {
    const materialized = materializeStreamedToolCall({
      id: "toolu_parse_error",
      name: "web_search",
      // Malformed JSON emitted by a finalized (inputAvailable: true) tool call
      // is the rare provider/SDK bug case. It must NOT be conflated with stream
      // termination.
      arguments: '{"query":"streaming bugs',
      inputAvailable: true,
    });

    assertEquals(materialized.kind, "parse-error");
    assertEquals(
      (materialized.part as { args: Record<string, unknown> }).args,
      {},
    );
    assertEquals(
      (materialized.part as { inputText?: string }).inputText,
      '{"query":"streaming bugs',
    );
    if (materialized.kind === "parse-error") {
      assertEquals(typeof materialized.parseError, "string");
    }
  });

  it(
    "materializes an incomplete streamed tool call (stream terminated before tool-call event)",
    () => {
      // This is the exact shape observed in production: a `write_file` tool
      // whose `content` field got cut off mid-emission because the provider
      // stream stalled before the finalizing `tool-call` event fired. The
      // partial JSON would otherwise produce an "Expected ',' or '}' after
      // property value" error if we naively parsed it.
      const partialArgs = '{"path":"/plans/headless-browser-automation-research.md","conten';
      const materialized = materializeStreamedToolCall({
        id: "toolu_01HebautJT22EGCZh8K1Dfpw",
        name: "write_file",
        arguments: partialArgs,
        // inputAvailable deliberately omitted — same as the production state
        // when the stream ends before `tool-input-end` / `tool-call` fires.
      });

      assertEquals(materialized.kind, "incomplete");
      // args MUST be empty — we must not hand the execution path a partial
      // object constructed from truncated JSON, because downstream consumers
      // assume args reflect a committed tool choice.
      assertEquals(
        (materialized.part as { args: Record<string, unknown> }).args,
        {},
      );
      // inputText MUST preserve the partial fragment verbatim so the persisted
      // assistant message is transparent about what happened (not swallowed).
      assertEquals(
        (materialized.part as { inputText?: string }).inputText,
        partialArgs,
      );
      if (materialized.kind === "incomplete") {
        assertEquals(materialized.partialArgumentsLength, partialArgs.length);
        assertEquals(
          materialized.partialArgumentsPreview,
          partialArgs.slice(0, 200),
        );
      }
    },
  );

  it(
    "materializes an incomplete streamed tool call with empty arguments (stream died before any delta)",
    () => {
      const materialized = materializeStreamedToolCall({
        id: "toolu_pre_delta_death",
        name: "read_file",
        arguments: "",
      });

      assertEquals(materialized.kind, "incomplete");
      assertEquals(
        (materialized.part as { args: Record<string, unknown> }).args,
        {},
      );
      // No inputText field when the stream died before emitting any delta.
      assertEquals(
        (materialized.part as { inputText?: string }).inputText,
        undefined,
      );
      if (materialized.kind === "incomplete") {
        assertEquals(materialized.partialArgumentsLength, 0);
        assertEquals(materialized.partialArgumentsPreview, "");
      }
    },
  );

  it(
    "truncates partialArgumentsPreview to 200 chars for huge mid-stream cutoffs",
    () => {
      const longFragment = '{"path":"/plans/x.md","content":"' + "a".repeat(500);
      const materialized = materializeStreamedToolCall({
        id: "toolu_long_partial",
        name: "write_file",
        arguments: longFragment,
      });

      assertEquals(materialized.kind, "incomplete");
      if (materialized.kind === "incomplete") {
        assertEquals(materialized.partialArgumentsLength, longFragment.length);
        assertEquals(materialized.partialArgumentsPreview.length, 200);
        assertEquals(
          materialized.partialArgumentsPreview,
          longFragment.slice(0, 200),
        );
      }
      // The full fragment is still preserved on the persisted part so we do
      // not lose forensic data — only the log preview is truncated.
      assertEquals(
        (materialized.part as { inputText?: string }).inputText,
        longFragment,
      );
    },
  );
});
