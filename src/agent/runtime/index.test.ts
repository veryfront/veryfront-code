import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectFinalStreamToolResults,
  collectGeneratedToolResults,
  collectPersistedToolResults,
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
});
