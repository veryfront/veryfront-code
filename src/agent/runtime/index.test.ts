import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureStreamedToolCallInput,
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  collectPersistedToolResults,
  isStreamedToolCallIncomplete,
  materializeStreamedToolCall,
} from "./index.ts";
import type { ChatStreamState } from "./chat-stream-handler.ts";
import type { Message } from "../types.ts";

function createState(
  toolResults: ChatStreamState["toolResults"],
): Pick<ChatStreamState, "toolResults"> {
  return { toolResults };
}

describe("agent runtime streamed tool result collection", () => {
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
