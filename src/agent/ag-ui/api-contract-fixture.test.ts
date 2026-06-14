import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk } from "../../chat/ag-ui.ts";
import { normalizeConversationHistoryForRuntime } from "../../channels/invoke.ts";
import { normalizeAgUiMessages } from "./host-support.ts";

const CONVERSATION_ID = "a7c53a3d-feb2-4404-86e2-5c562455e46c";
const ASSISTANT_MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const USER_TOOL_CALL_ID = "toolu_harvest_users";
const TIME_TOOL_CALL_ID = "toolu_harvest_time_entries";

const apiMessagesResponseFixture = {
  conversation_id: CONVERSATION_ID,
  data: [
    {
      id: "11111111-1111-4111-a111-111111111111",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Review Harvest timesheets for the last three weeks.",
        },
      ],
      createdAt: "2026-06-14T03:00:00.000Z",
    },
    {
      id: ASSISTANT_MESSAGE_ID,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Good. Policy loaded. I will fetch Harvest data.",
        },
        {
          type: "tool_call",
          id: USER_TOOL_CALL_ID,
          name: "harvest__list_users",
          input: { accountId: "2029314" },
          state: "completed",
        },
        {
          type: "tool_result",
          tool_call_id: USER_TOOL_CALL_ID,
          output: { users: [{ id: 5340370, name: "Redacted User" }] },
        },
        {
          type: "tool_call",
          id: TIME_TOOL_CALL_ID,
          name: "harvest__list_time_entries",
          input: {
            accountId: "2029314",
            from: "2026-05-25",
            to: "2026-06-14",
          },
          state: "completed",
        },
        {
          type: "tool_result",
          tool_call_id: TIME_TOOL_CALL_ID,
          output: { timeEntries: [{ id: 991, hours: 2.5 }] },
        },
      ],
      createdAt: "2026-06-14T03:00:12.000Z",
    },
  ],
  page_info: {
    self: null,
    next: null,
  },
} as const;

const apiEventsResponseFixture = {
  data: [
    {
      event_id: 21,
      event_type: "TOOL_CALL_START",
      event: {
        type: "TOOL_CALL_START",
        toolCallId: USER_TOOL_CALL_ID,
        toolCallName: "harvest__list_users",
      },
    },
    {
      event_id: 22,
      event_type: "TOOL_CALL_ARGS",
      event: {
        type: "TOOL_CALL_ARGS",
        toolCallId: USER_TOOL_CALL_ID,
        delta: '{"accountId":"2029314"}',
      },
    },
    {
      event_id: 23,
      event_type: "TOOL_CALL_END",
      event: {
        type: "TOOL_CALL_END",
        toolCallId: USER_TOOL_CALL_ID,
      },
    },
    {
      event_id: 24,
      event_type: "TOOL_CALL_RESULT",
      event: {
        type: "TOOL_CALL_RESULT",
        messageId: ASSISTANT_MESSAGE_ID,
        toolCallId: USER_TOOL_CALL_ID,
        result: { users: [{ id: 5340370, name: "Redacted User" }] },
        role: "tool",
        isError: false,
      },
    },
  ],
  page_info: {
    self: "20",
    next: "24",
  },
} as const;

const apiSnapshotResponseFixture = {
  after_event_id: 24,
  events: [
    {
      event_id: null,
      event: {
        type: "MESSAGES_SNAPSHOT",
        messages: apiMessagesResponseFixture.data,
      },
    },
    {
      event_id: null,
      event: {
        type: "STATE_SNAPSHOT",
        snapshot: {
          invokeAgentChildRuns: {},
          inputRequestsByToolCallId: {},
        },
      },
    },
    {
      event_id: 24,
      event: {
        type: "RUN_FINISHED",
        metadata: {
          provider: "anthropic",
          model: "claude-opus-4-6",
          inputTokens: 100,
          outputTokens: 50,
          finishReason: "stop",
        },
      },
    },
  ],
} as const;

const wireEventByCanonicalType: Record<string, string> = {
  TOOL_CALL_START: "ToolCallStart",
  TOOL_CALL_ARGS: "ToolCallArgs",
  TOOL_CALL_END: "ToolCallEnd",
  TOOL_CALL_RESULT: "ToolCallResult",
};

function toSseFrames(response: typeof apiEventsResponseFixture): string {
  return response.data.map((record) =>
    [
      `id: ${record.event_id}`,
      `event: ${wireEventByCanonicalType[record.event_type]}`,
      `data: ${JSON.stringify(record.event)}`,
      "",
      "",
    ].join("\n")
  ).join("");
}

function toAgUiMessages(messages: unknown): Parameters<typeof normalizeAgUiMessages>[0] {
  return structuredClone(messages) as Parameters<typeof normalizeAgUiMessages>[0];
}

function toChannelMessages(
  messages: unknown,
): Parameters<typeof normalizeConversationHistoryForRuntime>[0] {
  return structuredClone(messages) as Parameters<typeof normalizeConversationHistoryForRuntime>[0];
}

function getToolResultParts(messages: Array<{ parts: readonly unknown[] }>) {
  return messages
    .flatMap((message) => message.parts)
    .filter((part) => {
      const record = part as Record<string, unknown>;
      return record.type === "tool-result";
    })
    .map((part) => {
      const record = part as Record<string, unknown>;
      return {
        toolCallId: record.toolCallId,
        toolName: record.toolName,
        result: record.result,
      };
    });
}

describe("agent/ag-ui-api-contract-fixture", () => {
  it("replays redacted API messages, events, and snapshot payloads through code normalizers", () => {
    const hostMessages = normalizeAgUiMessages(toAgUiMessages(apiMessagesResponseFixture.data));
    assertEquals(getToolResultParts(hostMessages), [
      {
        toolCallId: USER_TOOL_CALL_ID,
        toolName: "harvest__list_users",
        result: { users: [{ id: 5340370, name: "Redacted User" }] },
      },
      {
        toolCallId: TIME_TOOL_CALL_ID,
        toolName: "harvest__list_time_entries",
        result: { timeEntries: [{ id: 991, hours: 2.5 }] },
      },
    ]);

    const channelMessages = normalizeConversationHistoryForRuntime(
      toChannelMessages(apiMessagesResponseFixture.data),
    );
    assertEquals(getToolResultParts(channelMessages), [
      {
        toolCallId: USER_TOOL_CALL_ID,
        toolName: "harvest__list_users",
        result: { users: [{ id: 5340370, name: "Redacted User" }] },
      },
      {
        toolCallId: TIME_TOOL_CALL_ID,
        toolName: "harvest__list_time_entries",
        result: { timeEntries: [{ id: 991, hours: 2.5 }] },
      },
    ]);

    const decodedEvents = decodeAgUiSseChunk(
      createAgUiChatEventDecoderState({ validationMode: "strict" }),
      toSseFrames(apiEventsResponseFixture),
    );
    assertEquals(decodedEvents.events.map((entry) => entry.wireEvent.eventName), [
      "ToolCallStart",
      "ToolCallArgs",
      "ToolCallEnd",
      "ToolCallResult",
    ]);
    assertEquals(decodedEvents.events.flatMap((entry) => entry.chatEvents), [
      {
        type: "tool-input-start",
        toolCallId: USER_TOOL_CALL_ID,
        toolName: "harvest__list_users",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        toolCallId: USER_TOOL_CALL_ID,
        inputTextDelta: '{"accountId":"2029314"}',
      },
      {
        type: "tool-input-available",
        toolCallId: USER_TOOL_CALL_ID,
        toolName: "harvest__list_users",
        input: { accountId: "2029314" },
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: USER_TOOL_CALL_ID,
        output: { users: [{ id: 5340370, name: "Redacted User" }] },
        providerExecuted: true,
      },
    ]);

    const messagesSnapshot = apiSnapshotResponseFixture.events[0].event;
    assertEquals(messagesSnapshot.type, "MESSAGES_SNAPSHOT");
    if (messagesSnapshot.type === "MESSAGES_SNAPSHOT") {
      assertEquals(
        getToolResultParts(normalizeAgUiMessages(toAgUiMessages(messagesSnapshot.messages))),
        [
          {
            toolCallId: USER_TOOL_CALL_ID,
            toolName: "harvest__list_users",
            result: { users: [{ id: 5340370, name: "Redacted User" }] },
          },
          {
            toolCallId: TIME_TOOL_CALL_ID,
            toolName: "harvest__list_time_entries",
            result: { timeEntries: [{ id: 991, hours: 2.5 }] },
          },
        ],
      );
    }
  });
});
