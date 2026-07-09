import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AppendConversationRunEventsResponseSchema,
  ConversationRunProjectionSchema,
  resolveConversationRunTargets,
} from "./durable-contracts.ts";

const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-a222-222222222222";
const PROJECT_ID = "33333333-3333-4333-a333-333333333333";
const ENVIRONMENT_ID = "55555555-5555-4555-8555-555555555555";
const BRANCH_ID = "44444444-4444-4444-8444-444444444444";

describe("agent/durable-contracts", () => {
  it("resolves conversation run target metadata", () => {
    assertEquals(resolveConversationRunTargets({ projectId: null, branchId: null }), {
      sourceTargetKind: null,
      runtimeTargetKind: null,
      targetEnvironmentId: null,
      targetBranchId: null,
    });
    assertEquals(resolveConversationRunTargets({ projectId: PROJECT_ID, branchId: BRANCH_ID }), {
      sourceTargetKind: "preview_branch",
      runtimeTargetKind: "preview_branch",
      targetEnvironmentId: null,
      targetBranchId: BRANCH_ID,
    });
    assertEquals(
      resolveConversationRunTargets({
        projectId: PROJECT_ID,
        runtimeTargetKind: "environment",
        environmentId: ENVIRONMENT_ID,
        branchId: null,
      }),
      {
        sourceTargetKind: "environment",
        runtimeTargetKind: "environment",
        targetEnvironmentId: ENVIRONMENT_ID,
        targetBranchId: null,
      },
    );
    assertEquals(resolveConversationRunTargets({ projectId: PROJECT_ID, branchId: null }), {
      sourceTargetKind: "project",
      runtimeTargetKind: "main_branch",
      targetEnvironmentId: null,
      targetBranchId: null,
    });
  });

  it("normalizes durable run projections from snake_case and camelCase responses", () => {
    assertEquals(
      ConversationRunProjectionSchema.parse({
        run_id: "run_snake_1",
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        latest_event_id: 3,
        latest_external_event_sequence: 5,
        waiting_tool_call_id: "tool-call-1",
        waiting_tool_name: "form_input",
        status: "waiting_for_tool",
      }),
      {
        runId: "run_snake_1",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 3,
        latestExternalEventSequence: 5,
        waitingToolCallId: "tool-call-1",
        waitingToolName: "form_input",
        status: "waiting_for_tool",
      },
    );

    assertEquals(
      ConversationRunProjectionSchema.parse({
        runId: "run_camel_1",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 7,
        latestExternalEventSequence: 9,
        status: "running",
      }),
      {
        runId: "run_camel_1",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        latestEventId: 7,
        latestExternalEventSequence: 9,
        waitingToolCallId: null,
        waitingToolName: null,
        status: "running",
      },
    );
  });

  it("rejects durable run projections without external event sequence metadata", () => {
    assertThrows(
      () =>
        ConversationRunProjectionSchema.parse({
          runId: "run_missing_sequence",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 7,
          status: "running",
        }),
      Error,
      "Missing latestExternalEventSequence in durable run response",
    );
  });

  it("normalizes append-event responses from canonical snake_case payloads", () => {
    assertEquals(
      AppendConversationRunEventsResponseSchema.parse({
        latest_event_id: 11,
        latest_external_event_sequence: 13,
        appended_count: 2,
        run: {
          run_id: "run_events_1",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 11,
          latest_external_event_sequence: 13,
        },
      }),
      {
        latestEventId: 11,
        latestExternalEventSequence: 13,
        appendedCount: 2,
        run: {
          run_id: "run_events_1",
          conversation_id: CONVERSATION_ID,
          latest_event_id: 11,
          latest_external_event_sequence: 13,
          runId: "run_events_1",
          conversationId: CONVERSATION_ID,
          latestEventId: 11,
          latestExternalEventSequence: 13,
        },
      },
    );
  });
});
