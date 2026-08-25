import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ChatProviderModelInputMessage,
  ChatProviderModelInputPart,
  ChatProviderModelInputToolResultPart,
} from "./provider-input-types.ts";
import type {
  ChatToolCallPart,
  ChatToolPartState,
  ChatToolResultPart,
  ChatUiMessage,
  ProviderModelMessage,
} from "veryfront/chat/types";
import {
  extractTextFromMessage,
  extractUploadId,
  getApiConversationSchema,
  getApiMessageSchema,
  getConversationTypeSchema,
  getMessagePartSchema,
  getMessageStatusSchema,
  hasIncompleteToolParts,
  isRecord,
  isToolCallPart,
  mapToolState,
  markIncompleteToolPartsAsErrored,
  markIncompleteToolPartsAsStopped,
  pushToolParts,
  stringifyUnknown,
  toConversationPartsFromUiMessage,
} from "#veryfront/chat/conversation";
import { convertUiMessagesToProviderModelMessages } from "./provider-message-conversion.ts";

const apiConversationSchema = getApiConversationSchema();
const apiMessageSchema = getApiMessageSchema();
const conversationTypeSchema = getConversationTypeSchema();
const messagePartSchema = getMessagePartSchema();
const messageStatusSchema = getMessageStatusSchema();
const GITHUB_PR_DIFF_INPUT = { owner: "veryfront", repo: "veryfront-code", pull_number: 3092 };
const GITHUB_LIST_PRS_INPUT = { owner: "veryfront", repo: "veryfront-code" };
type JsonToolResultValue = Extract<ChatToolResultPart["output"], { type: "json" }>["value"];

function assistantInputMessage(
  parts: ChatProviderModelInputPart[],
  id = "message-1",
): ChatProviderModelInputMessage {
  return { id, role: "assistant", parts };
}

function toolInputMessage(
  parts: ChatProviderModelInputPart[],
  id = "message-1:tool",
): ChatProviderModelInputMessage {
  return { id, role: "tool", parts };
}

function userInputMessage(text: string, id = "user-1"): ChatProviderModelInputMessage {
  return { id, role: "user", parts: [textInputPart(text)] };
}

function textInputPart(text: string): ChatProviderModelInputPart {
  return { type: "text", text };
}

function rawToolCallInputPart(
  id: string,
  name: string,
  input: Record<string, unknown>,
  state = "pending",
): ChatProviderModelInputPart {
  return { type: "tool_call", id, name, input, state } as ChatProviderModelInputPart;
}

function rawToolResultInputPart(
  toolCallId: string,
  output: unknown,
  toolName?: string,
): ChatProviderModelInputToolResultPart {
  return toolName
    ? { type: "tool_result", tool_call_id: toolCallId, tool_name: toolName, output }
    : { type: "tool_result", tool_call_id: toolCallId, output };
}

function dynamicToolInputPart(
  toolCallId: string,
  toolName: string,
  input: unknown,
  state: ChatToolPartState = "input-available",
  output?: unknown,
): ChatProviderModelInputPart {
  return output === undefined
    ? { type: "dynamic-tool", toolName, toolCallId, input, state }
    : { type: "dynamic-tool", toolName, toolCallId, input, state, output };
}

function expectedToolCall(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): ChatToolCallPart {
  return { type: "tool-call", toolCallId, toolName, input };
}

function expectedJsonResult(
  toolCallId: string,
  toolName: string,
  value: JsonToolResultValue,
): ChatToolResultPart {
  return { type: "tool-result", toolCallId, toolName, output: { type: "json", value } };
}

function expectedErrorResult(
  toolCallId: string,
  toolName: string,
  value: string,
): ChatToolResultPart {
  return { type: "tool-result", toolCallId, toolName, output: { type: "error-text", value } };
}

function expectedToolExchange(
  calls: ChatToolCallPart[],
  results: ChatToolResultPart[],
): ProviderModelMessage[] {
  return [
    { role: "assistant", content: calls },
    { role: "tool", content: results },
  ];
}

describe("chat/conversation schemas", () => {
  it("validates API conversation and message payloads", () => {
    assertEquals(messagePartSchema.safeParse({ type: "text", text: "hello" }).success, true);
    assertEquals(
      messagePartSchema.safeParse({
        type: "tool_call",
        id: "tc-1",
        name: "bash",
        input: {},
        state: "pending",
      }).success,
      true,
    );
    assertEquals(
      messagePartSchema.safeParse({
        type: "file",
        upload_id: "custom_blob-1",
        media_type: "application/pdf",
      }).success,
      true,
    );
    assertEquals(
      messagePartSchema.safeParse({
        type: "file",
        upload_id: "../unsafe",
        media_type: "application/pdf",
      }).success,
      false,
    );
    assertEquals(
      messagePartSchema.safeParse({
        type: "source_document",
        source_id: "doc-1",
        media_type: "text/markdown",
        title: "Design Doc",
        filename: "design.md",
      }).success,
      true,
    );
    assertEquals(conversationTypeSchema.safeParse("project_agent").success, true);
    assertEquals(messageStatusSchema.safeParse("cancelled").success, true);
    assertEquals(
      apiConversationSchema.safeParse({
        id: "conv-1",
        type: "chat",
        status: "active",
        messageCount: 1,
        createdBy: "user-1",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      }).success,
      true,
    );
    assertEquals(
      apiMessageSchema.safeParse({
        id: "msg-1",
        conversationId: "conv-1",
        parentId: null,
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
        status: "completed",
        model: null,
        tokenUsage: null,
        finishReason: null,
        createdBy: "user-1",
        metadata: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: null,
      }).success,
      true,
    );
  });
});

describe("chat/conversation helpers", () => {
  it("maps UI tool state and pushes persisted tool parts", () => {
    const parts: Array<ReturnType<typeof messagePartSchema.parse>> = [];
    pushToolParts(parts, "bash", "tc-1", "output-available", {
      input: { command: "ls" },
      output: "ok",
    });

    assertEquals(
      mapToolState("input-streaming"),
      "streaming",
      "input-streaming is the only producer of the persisted streaming state",
    );
    assertEquals(
      mapToolState("input-available"),
      "pending",
      "a tool waiting to run must persist as pending",
    );
    assertEquals(
      mapToolState("output-available"),
      "completed",
      "a tool with output must persist as completed",
    );
    assertEquals(
      mapToolState("output-error"),
      "error",
      "a failed tool must persist as error",
    );
    assertEquals(
      mapToolState("approval-requested"),
      "pending",
      "an approval request must persist as pending",
    );
    assertEquals(
      mapToolState("output-denied"),
      "error",
      "a denied tool must persist as error",
    );
    assertEquals(
      mapToolState("unknown-state"),
      "pending",
      "an unrecognized SDK state must fall back to pending",
    );
    assertEquals(parts, [
      { type: "tool_call", id: "tc-1", name: "bash", input: { command: "ls" }, state: "completed" },
      { type: "tool_result", tool_call_id: "tc-1", output: "ok", is_error: false },
    ]);
  });

  it("treats terminal provider tool states as complete", () => {
    const message: ChatUiMessage = {
      id: "assistant-provider-tools",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "srvtoolu-search",
          input: { query: "Veryfront" },
          state: "completed",
          providerExecuted: true,
          output: { results: [] },
        },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://example.com" },
          state: "error",
          providerExecuted: true,
          errorText: "404 / Not Found",
        },
      ],
    };

    const parts: Array<ReturnType<typeof messagePartSchema.parse>> = [];
    for (const part of message.parts) {
      if (part.type === "tool-web_search") {
        pushToolParts(parts, "web_search", part.toolCallId, part.state, part);
      }
      if (part.type === "tool-web_fetch") {
        pushToolParts(parts, "web_fetch", part.toolCallId, part.state, part);
      }
    }

    assertEquals(hasIncompleteToolParts(message), false);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Tool call did not complete"), message);
    assertEquals(parts, [
      {
        type: "tool_call",
        id: "srvtoolu-search",
        name: "web_search",
        input: { query: "Veryfront" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "srvtoolu-search",
        output: { results: [] },
        is_error: false,
      },
      {
        type: "tool_call",
        id: "srvtoolu-fetch",
        name: "web_fetch",
        input: { url: "https://example.com" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "srvtoolu-fetch",
        output: "404 / Not Found",
        is_error: true,
      },
    ]);
  });

  it("treats provider-owned input-available tools as complete", () => {
    const message: ChatUiMessage = {
      id: "assistant-provider-owned-tool",
      role: "assistant",
      parts: [
        { type: "text", text: "I can answer with the fetched context." },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://example.com/docs" },
          state: "input-available",
          providerExecuted: true,
        },
      ],
    };

    assertEquals(hasIncompleteToolParts(message), false);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Tool call did not complete"), message);
    assertEquals(toConversationPartsFromUiMessage(message), [
      { type: "text", text: "I can answer with the fetched context." },
      {
        type: "tool_call",
        id: "srvtoolu-fetch",
        name: "web_fetch",
        input: { url: "https://example.com/docs" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "srvtoolu-fetch",
        output: null,
        is_error: false,
      },
    ]);
  });

  it("treats local web_fetch input-available tools as incomplete without providerExecuted", () => {
    const message: ChatUiMessage = {
      id: "assistant-local-web-fetch",
      role: "assistant",
      parts: [
        { type: "text", text: "Fetching the docs." },
        {
          type: "tool-web_fetch",
          toolCallId: "local-fetch",
          input: { url: "https://veryfront.com/docs/agent/create-agent" },
          state: "input-available",
        },
      ],
    };

    assertEquals(hasIncompleteToolParts(message), true);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Tool call did not complete"), {
      ...message,
      parts: [
        { type: "text", text: "Fetching the docs." },
        {
          type: "tool-web_fetch",
          toolCallId: "local-fetch",
          input: { url: "https://veryfront.com/docs/agent/create-agent" },
          state: "output-error",
          errorText: "Tool call did not complete",
        },
      ],
    });
    assertEquals(
      toConversationPartsFromUiMessage(markIncompleteToolPartsAsErrored(
        message,
        "Tool call did not complete",
      )),
      [
        { type: "text", text: "Fetching the docs." },
        {
          type: "tool_call",
          id: "local-fetch",
          name: "web_fetch",
          input: { url: "https://veryfront.com/docs/agent/create-agent" },
          state: "completed",
        },
        {
          type: "tool_result",
          tool_call_id: "local-fetch",
          output: "Tool call did not complete",
          is_error: true,
        },
      ],
    );
  });

  it("maps UI messages into persistable conversation parts", () => {
    const message: ChatUiMessage = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "Real content" },
        { type: "reasoning", text: "Thinking…" },
        { type: "source-url", sourceId: "src-1", url: "https://example.com", title: "Example" },
        {
          type: "source-document",
          sourceId: "doc-1",
          mediaType: "text/markdown",
          title: "Design Doc",
          filename: "design.md",
        },
        { type: "source-document", sourceId: "legacy-doc", title: "Legacy Doc" },
        { type: "data-rollout", data: { approved: true } },
        {
          type: "file",
          mediaType: "image/png",
          url: "https://files.example.com/uploaded/11111111-1111-4111-a111-111111111111",
        },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "brief.pdf",
          uploadId: "custom_blob-1",
          url: "https://files.example.com/api/uploads?id=custom_blob-1",
        },
        {
          type: "tool-form_input",
          toolCallId: "tool-1",
          input: { title: "Continue?" },
          state: "output-available",
          output: { approved: true },
        },
      ],
    };

    assertEquals(toConversationPartsFromUiMessage(message), [
      { type: "text", text: "Real content" },
      { type: "reasoning", text: "Thinking…" },
      { type: "citation", source_id: "src-1", title: "Example", url: "https://example.com" },
      {
        type: "source_document",
        source_id: "doc-1",
        media_type: "text/markdown",
        title: "Design Doc",
        filename: "design.md",
      },
      { type: "citation", source_id: "legacy-doc", title: "Legacy Doc" },
      { type: "data", name: "rollout", value: { approved: true } },
      {
        type: "image",
        upload_id: "11111111-1111-4111-a111-111111111111",
        media_type: "image/png",
        url: "https://files.example.com/uploaded/11111111-1111-4111-a111-111111111111",
      },
      {
        type: "file",
        upload_id: "custom_blob-1",
        media_type: "application/pdf",
        filename: "brief.pdf",
        url: "https://files.example.com/api/uploads?id=custom_blob-1",
      },
      {
        type: "tool_call",
        id: "tool-1",
        name: "form_input",
        input: { title: "Continue?" },
        state: "completed",
      },
      {
        type: "tool_result",
        tool_call_id: "tool-1",
        output: { approved: true },
        is_error: false,
      },
    ]);
  });

  it("marks incomplete UI tool parts as stopped or errored", () => {
    const message: ChatUiMessage = {
      id: "assistant-3",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "update_file",
          toolCallId: "tool-3",
          input: {},
          state: "pending",
        },
        {
          type: "tool-form_input",
          toolCallId: "tool-4",
          input: { title: "Continue?" },
          state: "approval-requested",
          approval: { id: "approval-1" },
        },
      ],
    };

    assertEquals(hasIncompleteToolParts(message), true);
    assertEquals(markIncompleteToolPartsAsErrored(message, "Assistant ended before completion"), {
      id: "assistant-3",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "update_file",
          toolCallId: "tool-3",
          input: {},
          state: "output-error",
          errorText: "Assistant ended before completion",
        },
        {
          type: "tool-form_input",
          toolCallId: "tool-4",
          input: { title: "Continue?" },
          state: "output-error",
          errorText: "Assistant ended before completion",
        },
      ],
    });
    assertEquals(markIncompleteToolPartsAsStopped(message).parts[0], {
      type: "dynamic-tool",
      toolName: "update_file",
      toolCallId: "tool-3",
      input: {},
      state: "output-error",
      errorText: "Stopped by user",
    });
  });

  it("extracts upload ids and safely stringifies unknown values", () => {
    assertEquals(
      extractUploadId("https://api.example.com/uploads/550e8400-e29b-41d4-a716-446655440000/url"),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    assertEquals(
      extractUploadId("https://api.example.com/uploads?id=custom_blob-1"),
      "custom_blob-1",
    );
    assertEquals(extractUploadId("https://api.example.com/uploads?id=..%2Funsafe"), null);
    assertEquals(isRecord({ ok: true }), true);
    assertEquals(isRecord([]), false);
    assertEquals(stringifyUnknown({ a: 1 }), '{"a":1}');
  });

  it("extracts text from provider model messages", () => {
    const message: ProviderModelMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "tool-call", toolCallId: "tc-1", toolName: "bash", input: {} },
        { type: "text", text: "second" },
      ],
    };

    assertEquals(extractTextFromMessage(message), "first second");
  });
});

describe("convertUiMessagesToProviderModelMessages", () => {
  it("replays assistant reasoning with its signature and redacted data", () => {
    assertEquals(
      convertUiMessagesToProviderModelMessages([
        assistantInputMessage(
          [{ type: "reasoning", text: "Thinking", signature: "sig", redactedData: "red" }],
          "assistant-reasoning",
        ),
      ]),
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Thinking", signature: "sig", redactedData: "red" },
          ],
        },
      ],
      "assistant reasoning must reach provider content with its signature and redactedData",
    );
  });

  it("converts system messages into a provider system message", () => {
    assertEquals(
      convertUiMessagesToProviderModelMessages([
        {
          id: "system-1",
          role: "system",
          parts: [textInputPart("Be terse."), textInputPart(" Cite sources.")],
        },
      ]),
      [{ role: "system", content: "Be terse. Cite sources." }],
      "system text parts must concatenate into one provider system message",
    );

    assertEquals(
      convertUiMessagesToProviderModelMessages([
        { id: "system-empty", role: "system", parts: [textInputPart("")] },
      ]),
      [],
      "an empty system message must not reach the provider",
    );
  });

  it("forwards user file attachments to provider content", () => {
    assertEquals(
      convertUiMessagesToProviderModelMessages([
        {
          id: "user-attachment",
          role: "user",
          parts: [
            { type: "text", text: "What is in this screenshot?" },
            {
              type: "file",
              mediaType: "image/png",
              url: "https://files.example.com/shot.png",
              filename: "shot.png",
            },
          ],
        },
      ]),
      [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this screenshot?" },
            {
              type: "file",
              mediaType: "image/png",
              data: "https://files.example.com/shot.png",
              url: "https://files.example.com/shot.png",
              filename: "shot.png",
            },
          ],
        },
      ],
      "user file attachments must be forwarded to provider content",
    );
  });

  it("normalizes non-JSON tool output without crashing provider conversion", () => {
    const output: Record<string, unknown> = {
      big: 42n,
      notANumber: Number.NaN,
    };
    output.self = output;

    assertEquals(
      convertUiMessagesToProviderModelMessages([
        assistantInputMessage([
          dynamicToolInputPart(
            "tool-unsafe-json",
            "custom_tool",
            {},
            "output-available",
            output,
          ),
        ]),
      ]),
      expectedToolExchange(
        [expectedToolCall("tool-unsafe-json", "custom_tool", {})],
        [
          expectedJsonResult("tool-unsafe-json", "custom_tool", {
            big: "42",
            notANumber: null,
            self: "[Circular]",
          }),
        ],
      ),
    );
  });

  it("converts assistant tool UI parts into assistant and tool provider model messages", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I can help." },
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "tool-1",
            input: { command: "pwd" },
            state: "output-available",
            output: { cwd: "/workspace" },
          },
          { type: "text", text: "Done." },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I can help." },
          { type: "tool-call", toolCallId: "tool-1", toolName: "bash", input: { command: "pwd" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "bash",
            output: { type: "json", value: { cwd: "/workspace" } },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
    ]);
  });

  it("recognizes raw tool-call parts", () => {
    assertEquals(
      isToolCallPart({ type: "tool-call", toolCallId: "tc-1", toolName: "bash", input: {} }),
      true,
    );
  });

  it("passes through pre-split role:tool messages from normalized replay history", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "tool-1",
            name: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
            state: "completed",
          },
          {
            type: "tool_call",
            id: "tool-2",
            name: "github__list_prs",
            input: { repo: "api", owner: "veryfront" },
            state: "completed",
          },
        ],
      },
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "github__get_pr_diff",
            output: { error: "authentication_required" },
          },
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            tool_name: "github__list_prs",
            output: { error: "authentication_required" },
          },
        ],
      },
      {
        id: "message-1:after-tool:1",
        role: "assistant",
        parts: [{ type: "text", text: "I don't have GitHub access." }],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "github__list_prs",
            input: { repo: "api", owner: "veryfront" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            output: { type: "json", value: { error: "authentication_required" } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "github__list_prs",
            output: { type: "json", value: { error: "authentication_required" } },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I don't have GitHub access." }],
      },
    ]);
  });

  it("resolves raw role:tool results from matching raw tool calls", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "tool-1",
            name: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
            state: "completed",
          },
        ],
      },
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            output: { files: ["src/chat/conversation.ts"] },
          },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            output: { type: "json", value: { files: ["src/chat/conversation.ts"] } },
          },
        ],
      },
    ]);
  });

  it("resolves raw role:tool results from matching normalized UI tool calls", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__get_pr_diff",
            toolCallId: "tool-1",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
            state: "input-available",
          },
          {
            type: "tool-github__list_prs",
            toolCallId: "tool-2",
            input: { repo: "api", owner: "veryfront" },
            state: "input-available",
          },
        ],
      },
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            output: { files: ["src/chat/conversation.ts"] },
          },
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            output: { data: [{ number: 3092 }] },
          },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            input: { repo: "api", owner: "veryfront", pull_number: 1 },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "github__list_prs",
            input: { repo: "api", owner: "veryfront" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "github__get_pr_diff",
            output: { type: "json", value: { files: ["src/chat/conversation.ts"] } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "github__list_prs",
            output: { type: "json", value: { data: [{ number: 3092 }] } },
          },
        ],
      },
    ]);
  });

  it("resolves normalized role:tool results from matching normalized UI tool calls", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__get_pr_diff",
            toolCallId: "normalized-completed",
            input: { owner: "veryfront", repo: "veryfront-code", pull_number: 3092 },
            state: "input-available",
          },
        ],
      },
      {
        id: "message-1:tool:normalized-completed",
        role: "tool",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__get_pr_diff",
            toolCallId: "normalized-completed",
            input: { owner: "veryfront", repo: "veryfront-code", pull_number: 3092 },
            state: "output-available",
            output: { files: ["src/chat/conversation.ts"] },
          },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "normalized-completed",
            toolName: "github__get_pr_diff",
            input: { owner: "veryfront", repo: "veryfront-code", pull_number: 3092 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "normalized-completed",
            toolName: "github__get_pr_diff",
            output: { type: "json", value: { files: ["src/chat/conversation.ts"] } },
          },
        ],
      },
    ]);
  });

  it("omits orphan or mismatched normalized role:tool results", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__get_pr_diff",
            toolCallId: "mismatched",
            input: { pull_number: 1 },
            state: "input-available",
          },
        ],
      },
      {
        id: "message-1:tool:mismatched",
        role: "tool",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__list_prs",
            toolCallId: "mismatched",
            input: { state: "open" },
            state: "output-available",
            output: { data: [] },
          },
          {
            type: "dynamic-tool",
            toolName: "github__get_issue",
            toolCallId: "orphan",
            input: { number: 42 },
            state: "output-available",
            output: { issue: 42 },
          },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), []);
  });

  it("does not authorize replay pairs from provider-inconvertible roles", () => {
    const nonAssistantCallMessages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "user",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__get_issue",
            toolCallId: "invalid-call-origin",
            input: { number: 42 },
            state: "input-available",
          },
        ],
      },
      {
        id: "message-1:tool:invalid-call-origin",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "invalid-call-origin",
            tool_name: "github__get_issue",
            output: { issue: 42 },
          },
        ],
      },
    ];
    const nonConvertibleResultRoles = ["user", "system"] as const;

    assertEquals(convertUiMessagesToProviderModelMessages(nonAssistantCallMessages), []);

    for (const role of nonConvertibleResultRoles) {
      const messages: ChatProviderModelInputMessage[] = [
        {
          id: "message-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "github__get_issue",
              toolCallId: `invalid-${role}-result`,
              input: { number: 42 },
              state: "input-available",
            },
          ],
        },
        {
          id: `message-1:${role}:invalid-result`,
          role,
          parts: [
            {
              type: "tool_result",
              tool_call_id: `invalid-${role}-result`,
              tool_name: "github__get_issue",
              output: { issue: 42 },
            },
          ],
        },
      ];

      assertEquals(convertUiMessagesToProviderModelMessages(messages), []);
    }

    const ignoredHyphenatedResultMessages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "github__get_issue",
            toolCallId: "ignored-hyphenated-result",
            input: { number: 42 },
            state: "input-available",
          },
        ],
      },
      {
        id: "message-1:tool:ignored-hyphenated-result",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "ignored-hyphenated-result",
            toolName: "github__get_issue",
            output: { type: "json", value: { issue: 42 } },
          } as unknown as ChatProviderModelInputMessage["parts"][number],
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(ignoredHyphenatedResultMessages), []);
  });

  it("omits unresolved transient tool calls while preserving transient calls with replayed results", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart("normalized-completed", "github__get_pr_diff", GITHUB_PR_DIFF_INPUT),
        rawToolCallInputPart(
          "raw-completed",
          "github__list_prs",
          GITHUB_LIST_PRS_INPUT,
          "streaming",
        ),
        dynamicToolInputPart(
          "normalized-unresolved",
          "github__get_issue",
          { number: 12 },
          "pending",
        ),
        rawToolCallInputPart("raw-unresolved", "github__get_issue", { number: 13 }),
        rawToolCallInputPart(
          "raw-streaming-unresolved",
          "github__get_issue",
          { number: 14 },
          "streaming",
        ),
        dynamicToolInputPart(
          "approval-requested-unresolved",
          "form_input",
          { title: "Approve?" },
          "approval-requested",
        ),
        dynamicToolInputPart("approval-responded-unresolved", "form_input", {
          title: "Approve again?",
        }, "approval-responded"),
      ]),
      toolInputMessage([
        rawToolResultInputPart("normalized-completed", { files: ["src/chat/conversation.ts"] }),
      ], "message-1:tool:normalized-completed"),
      toolInputMessage([
        rawToolResultInputPart("raw-completed", { data: [{ number: 3092 }] }),
      ], "message-1:tool:raw-completed"),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [
          expectedToolCall("normalized-completed", "github__get_pr_diff", GITHUB_PR_DIFF_INPUT),
          expectedToolCall("raw-completed", "github__list_prs", GITHUB_LIST_PRS_INPUT),
        ],
        [
          expectedJsonResult("normalized-completed", "github__get_pr_diff", {
            files: ["src/chat/conversation.ts"],
          }),
          expectedJsonResult("raw-completed", "github__list_prs", { data: [{ number: 3092 }] }),
        ],
      ),
    );
  });

  it("does not preserve an earlier duplicate transient call across a user continuation", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 1 }),
      ], "assistant-1"),
      userInputMessage("continue with a different PR", "user-2"),
      assistantInputMessage([
        dynamicToolInputPart(
          "duplicate-call",
          "github__get_pr_diff",
          { pull_number: 2 },
          "output-available",
          {
            files: ["new.ts"],
          },
        ),
      ], "assistant-2"),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      { role: "user", content: [textInputPart("continue with a different PR")] },
      ...expectedToolExchange(
        [expectedToolCall("duplicate-call", "github__get_pr_diff", { pull_number: 2 })],
        [expectedJsonResult("duplicate-call", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    ]);
  });

  it("preserves only the nearest duplicate transient call before a result", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 1 }),
        dynamicToolInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 2 }),
      ], "assistant-1"),
      toolInputMessage([
        rawToolResultInputPart("duplicate-call", { files: ["new.ts"] }),
      ], "assistant-1:tool"),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("duplicate-call", "github__get_pr_diff", { pull_number: 2 })],
        [expectedJsonResult("duplicate-call", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );
  });

  it("omits completed duplicate call occurrences superseded by a transient replay result", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart(
          "duplicate-call",
          "github__get_pr_diff",
          { pull_number: 1 },
          "output-available",
          { files: ["old.ts"] },
        ),
        dynamicToolInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 2 }),
      ], "assistant-1"),
      toolInputMessage([
        rawToolResultInputPart("duplicate-call", { files: ["new.ts"] }),
      ], "assistant-1:tool"),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("duplicate-call", "github__get_pr_diff", { pull_number: 2 })],
        [expectedJsonResult("duplicate-call", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );
  });

  it("omits split duplicate call/result occurrences superseded by later replay results", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 1 }),
      ], "assistant-1"),
      toolInputMessage([
        rawToolResultInputPart("duplicate-call", { files: ["old.ts"] }),
      ], "assistant-1:tool"),
      assistantInputMessage([
        dynamicToolInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 2 }),
      ], "assistant-2"),
      toolInputMessage([
        rawToolResultInputPart("duplicate-call", { files: ["new.ts"] }),
      ], "assistant-2:tool"),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("duplicate-call", "github__get_pr_diff", { pull_number: 2 })],
        [expectedJsonResult("duplicate-call", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );
  });

  it("does not preserve a transient call for a name-mismatched result", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart("tool-1", "github__get_pr_diff", { pull_number: 1 }),
      ], "assistant-1"),
      toolInputMessage([
        rawToolResultInputPart("tool-1", { data: [] }, "github__list_prs"),
      ], "assistant-1:tool"),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), []);
  });

  it("skips provider-invisible messages but stops matching at visible content", () => {
    const skippedMessages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart("tool-1", "github__get_pr_diff", { pull_number: 1 }),
      ], "assistant-1"),
      assistantInputMessage([{ type: "step-start" }], "assistant-ui-only"),
      toolInputMessage([
        rawToolResultInputPart("tool-1", { files: ["new.ts"] }),
      ], "assistant-1:tool"),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(skippedMessages),
      expectedToolExchange(
        [expectedToolCall("tool-1", "github__get_pr_diff", { pull_number: 1 })],
        [expectedJsonResult("tool-1", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );

    const stoppedMessages: ChatProviderModelInputMessage[] = [
      skippedMessages[0]!,
      assistantInputMessage([textInputPart("I will continue without it.")], "assistant-visible"),
      skippedMessages[2]!,
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(stoppedMessages), [
      {
        role: "assistant",
        content: [{ type: "text", text: "I will continue without it." }],
      },
    ]);

    const whitespaceStoppedMessages: ChatProviderModelInputMessage[] = [
      skippedMessages[0]!,
      assistantInputMessage([textInputPart("  \n")], "assistant-whitespace"),
      skippedMessages[2]!,
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(whitespaceStoppedMessages), [
      {
        role: "assistant",
        content: [{ type: "text", text: "  \n" }],
      },
    ]);

    const emptyTextMessages: ChatProviderModelInputMessage[] = [
      skippedMessages[0]!,
      assistantInputMessage([textInputPart("")], "assistant-empty-text"),
      skippedMessages[2]!,
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(emptyTextMessages),
      expectedToolExchange(
        [expectedToolCall("tool-1", "github__get_pr_diff", { pull_number: 1 })],
        [expectedJsonResult("tool-1", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );

    const emptyReasoningMessages: ChatProviderModelInputMessage[] = [
      skippedMessages[0]!,
      assistantInputMessage([{ type: "reasoning", text: "" }], "assistant-empty-reasoning"),
      skippedMessages[2]!,
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(emptyReasoningMessages),
      expectedToolExchange(
        [expectedToolCall("tool-1", "github__get_pr_diff", { pull_number: 1 })],
        [expectedJsonResult("tool-1", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );

    const emptyUserTextMessages: ChatProviderModelInputMessage[] = [
      skippedMessages[0]!,
      userInputMessage("", "user-empty-text"),
      skippedMessages[2]!,
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(emptyUserTextMessages),
      expectedToolExchange(
        [expectedToolCall("tool-1", "github__get_pr_diff", { pull_number: 1 })],
        [expectedJsonResult("tool-1", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );

    const toolTextMessages: ChatProviderModelInputMessage[] = [
      skippedMessages[0]!,
      toolInputMessage([textInputPart("diagnostic text")], "tool-text"),
      skippedMessages[2]!,
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(toolTextMessages),
      expectedToolExchange(
        [expectedToolCall("tool-1", "github__get_pr_diff", { pull_number: 1 })],
        [expectedJsonResult("tool-1", "github__get_pr_diff", { files: ["new.ts"] })],
      ),
    );
  });

  it("maps raw errored tool calls to explicit error-text results", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        {
          type: "tool_call",
          id: "raw-error",
          name: "github__get_pr_diff",
          input: GITHUB_PR_DIFF_INPUT,
          state: "error",
          output: "authentication_required",
        } as unknown as ChatProviderModelInputPart,
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("raw-error", "github__get_pr_diff", GITHUB_PR_DIFF_INPUT)],
        [expectedErrorResult("raw-error", "github__get_pr_diff", "authentication_required")],
      ),
    );
  });

  it("uses a fallback result for raw errored tool calls without error details", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart(
          "raw-error-without-details",
          "github__get_pr_diff",
          GITHUB_PR_DIFF_INPUT,
          "error",
        ),
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall(
          "raw-error-without-details",
          "github__get_pr_diff",
          GITHUB_PR_DIFF_INPUT,
        )],
        [expectedErrorResult("raw-error-without-details", "github__get_pr_diff", "Tool error")],
      ),
    );
  });

  it("uses adjacent raw results as authoritative for raw errored tool calls", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart(
          "raw-error-with-result",
          "github__get_pr_diff",
          GITHUB_PR_DIFF_INPUT,
          "error",
        ),
      ]),
      toolInputMessage([
        {
          ...rawToolResultInputPart("raw-error-with-result", { code: "denied", retryable: false }),
          is_error: true,
        },
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("raw-error-with-result", "github__get_pr_diff", GITHUB_PR_DIFF_INPUT)],
        [
          expectedErrorResult(
            "raw-error-with-result",
            "github__get_pr_diff",
            '{"code":"denied","retryable":false}',
          ),
        ],
      ),
    );
  });

  it("preserves same-message raw pending calls when a matching raw result follows", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("raw-completed-inline", "github__list_prs", GITHUB_LIST_PRS_INPUT),
        rawToolResultInputPart("raw-completed-inline", { data: [{ number: 3092 }] }),
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("raw-completed-inline", "github__list_prs", GITHUB_LIST_PRS_INPUT)],
        [expectedJsonResult("raw-completed-inline", "github__list_prs", {
          data: [{ number: 3092 }],
        })],
      ),
    );
  });

  it("allows same-message assistant text between replay calls and matching results", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("raw-completed-inline", "github__list_prs", GITHUB_LIST_PRS_INPUT),
        textInputPart("I will summarize this after the result."),
        rawToolResultInputPart("raw-completed-inline", { data: [{ number: 3092 }] }),
      ]),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      ...expectedToolExchange(
        [expectedToolCall("raw-completed-inline", "github__list_prs", GITHUB_LIST_PRS_INPUT)],
        [expectedJsonResult("raw-completed-inline", "github__list_prs", {
          data: [{ number: 3092 }],
        })],
      ),
      {
        role: "assistant",
        content: [{ type: "text", text: "I will summarize this after the result." }],
      },
    ]);
  });

  it("does not match next-message results after same-message assistant text", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("raw-completed-later", "github__list_prs", GITHUB_LIST_PRS_INPUT),
        textInputPart("This text flushes before the later result."),
      ]),
      toolInputMessage([
        rawToolResultInputPart("raw-completed-later", { data: [{ number: 3092 }] }),
      ]),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [{ type: "text", text: "This text flushes before the later result." }],
      },
    ]);
  });

  it("does not join a new same-message call after assistant text to the pre-text batch", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("first-call", "github__get_pr_diff", {
          owner: "veryfront",
          repo: "veryfront-code",
          pull_number: 1,
        }),
        textInputPart("This text flushes before both results."),
        rawToolCallInputPart("second-call", "github__list_prs", GITHUB_LIST_PRS_INPUT),
        rawToolResultInputPart("first-call", { files: ["old.ts"] }),
        rawToolResultInputPart("second-call", { data: [{ number: 3092 }] }),
      ]),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "This text flushes before both results." },
          expectedToolCall("second-call", "github__list_prs", GITHUB_LIST_PRS_INPUT),
        ],
      },
      {
        role: "tool",
        content: [
          expectedJsonResult("second-call", "github__list_prs", { data: [{ number: 3092 }] }),
        ],
      },
    ]);
  });

  it("does not match a later raw result to a self-contained completed call occurrence", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart(
          "self-contained",
          "github__list_prs",
          GITHUB_LIST_PRS_INPUT,
          "output-available",
          {
            data: [{ number: 3092 }],
          },
        ),
      ]),
      toolInputMessage([
        rawToolResultInputPart("self-contained", { data: [{ number: 9999 }] }),
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("self-contained", "github__list_prs", GITHUB_LIST_PRS_INPUT)],
        [expectedJsonResult("self-contained", "github__list_prs", { data: [{ number: 3092 }] })],
      ),
    );
  });

  it("omits earlier duplicate self-contained tool occurrences", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        dynamicToolInputPart(
          "self-contained",
          "github__list_prs",
          { page: 1 },
          "output-available",
          { data: [{ number: 3092 }] },
        ),
        dynamicToolInputPart(
          "self-contained",
          "github__list_prs",
          { page: 2 },
          "output-available",
          { data: [{ number: 3093 }] },
        ),
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("self-contained", "github__list_prs", { page: 2 })],
        [expectedJsonResult("self-contained", "github__list_prs", {
          data: [{ number: 3093 }],
        })],
      ),
    );
  });

  it("uses the matched call occurrence name for unnamed raw results before duplicate call ids", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("duplicate-call", "github__get_pr_diff", { pull_number: 1 }),
        rawToolResultInputPart("duplicate-call", { files: ["one.ts"] }),
        rawToolCallInputPart("duplicate-call", "github__list_prs", { state: "open" }),
      ]),
    ];

    assertEquals(
      convertUiMessagesToProviderModelMessages(messages),
      expectedToolExchange(
        [expectedToolCall("duplicate-call", "github__get_pr_diff", { pull_number: 1 })],
        [expectedJsonResult("duplicate-call", "github__get_pr_diff", { files: ["one.ts"] })],
      ),
    );
  });

  it("does not match prior-message parallel calls after visible text in the result message", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("first-call", "github__get_pr_diff", { pull_number: 1 }),
        rawToolCallInputPart("second-call", "github__list_prs", { state: "open" }),
      ], "assistant-1"),
      assistantInputMessage([
        rawToolResultInputPart("first-call", { files: ["one.ts"] }),
        textInputPart("This text starts a continuation before the second result."),
        rawToolResultInputPart("second-call", { data: [{ number: 3092 }] }),
      ], "assistant-2"),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          expectedToolCall("first-call", "github__get_pr_diff", { pull_number: 1 }),
        ],
      },
      {
        role: "tool",
        content: [expectedJsonResult("first-call", "github__get_pr_diff", { files: ["one.ts"] })],
      },
      {
        role: "assistant",
        content: [{
          type: "text",
          text: "This text starts a continuation before the second result.",
        }],
      },
    ]);
  });

  it("does not join prior-message unresolved calls into a new same-message call batch", () => {
    const messages: ChatProviderModelInputMessage[] = [
      assistantInputMessage([
        rawToolCallInputPart("first-call", "github__get_pr_diff", { pull_number: 1 }),
        rawToolCallInputPart("second-call", "github__list_prs", { state: "open" }),
      ], "assistant-1"),
      assistantInputMessage([
        rawToolResultInputPart("first-call", { files: ["one.ts"] }),
        rawToolCallInputPart("third-call", "github__get_issue", { number: 42 }),
        rawToolResultInputPart("second-call", { data: [{ number: 3092 }] }),
        rawToolResultInputPart("third-call", { issue: 42 }),
      ], "assistant-2"),
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [expectedToolCall("first-call", "github__get_pr_diff", { pull_number: 1 })],
      },
      {
        role: "tool",
        content: [expectedJsonResult("first-call", "github__get_pr_diff", { files: ["one.ts"] })],
      },
      {
        role: "assistant",
        content: [expectedToolCall("third-call", "github__get_issue", { number: 42 })],
      },
      {
        role: "tool",
        content: [expectedJsonResult("third-call", "github__get_issue", { issue: 42 })],
      },
    ]);
  });

  it("drops orphan raw tool results without a resolvable tool name", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            output: { files: ["src/chat/conversation.ts"] },
          },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), []);
  });

  it("groups interleaved persisted tool call/result parts from one assistant turn", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "assistant-interleaved",
        role: "assistant",
        parts: [
          { type: "text", text: "I will fetch both sources." },
          {
            type: "tool_call",
            id: "tool-1",
            name: "calendar__list_events",
            input: { calendarId: "primary" },
            state: "completed",
          },
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "calendar__list_events",
            output: { data: [{ summary: "Standup" }] },
          },
          {
            type: "tool_call",
            id: "tool-2",
            name: "gmail__search_emails",
            input: { q: "newer_than:1d" },
            state: "completed",
          },
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            tool_name: "gmail__search_emails",
            output: { data: [{ id: "email-1" }] },
          },
          { type: "text", text: "Now I will inspect the emails." },
        ],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will fetch both sources." },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            input: { calendarId: "primary" },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            input: { q: "newer_than:1d" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            output: { type: "json", value: { data: [{ summary: "Standup" }] } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            output: { type: "json", value: { data: [{ id: "email-1" }] } },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Now I will inspect the emails." }],
      },
    ]);
  });

  it("groups consecutive role:tool replay messages after parallel tool calls", () => {
    const messages: ChatProviderModelInputMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "tool-1",
            name: "calendar__list_events",
            input: { calendarId: "primary" },
            state: "completed",
          },
          {
            type: "tool_call",
            id: "tool-2",
            name: "gmail__search_emails",
            input: { q: "newer_than:1d" },
            state: "completed",
          },
        ],
      },
      {
        id: "message-1:tool:tool-1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "calendar__list_events",
            output: { data: [{ summary: "Daily Product Engineering" }] },
          },
        ],
      },
      {
        id: "message-1:tool:tool-2",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tool-2",
            tool_name: "gmail__search_emails",
            output: { data: [{ id: "message-id" }] },
          },
        ],
      },
      {
        id: "message-1:after-tool:1",
        role: "assistant",
        parts: [{ type: "text", text: "I found today's updates." }],
      },
    ];

    assertEquals(convertUiMessagesToProviderModelMessages(messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            input: { calendarId: "primary" },
          },
          {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            input: { q: "newer_than:1d" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "calendar__list_events",
            output: { type: "json", value: { data: [{ summary: "Daily Product Engineering" }] } },
          },
          {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "gmail__search_emails",
            output: { type: "json", value: { data: [{ id: "message-id" }] } },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I found today's updates." }],
      },
    ]);
  });
});
