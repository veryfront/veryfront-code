import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { bootstrapHostedChildRun, buildHostedChildConversationBody } from "./child-bootstrap.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const PARENT_CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const CHILD_CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const PARENT_MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const CHILD_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const BRANCH_ID = "66666666-6666-4666-8666-666666666666";
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function acceptedRunResponse(run: unknown): Response {
  return jsonResponse({ accepted: true, run }, 202);
}

function stubFetchWithRecorder(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
) {
  globalThis.fetch = (async (input, init) => handler(input, init)) as typeof fetch;
}

describe("agent/hosted-child-bootstrap", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds hidden child conversation metadata", () => {
    assertEquals(
      buildHostedChildConversationBody({
        ensureProjectId: PROJECT_ID,
        parentConversationId: PARENT_CONVERSATION_ID,
        parentRunId: "parent-run-1",
        parentMessageId: PARENT_MESSAGE_ID,
        spawnedFromToolCallId: "tool-call-1",
        description: "Inspect logs",
      }),
      {
        project_id: PROJECT_ID,
        type: "project_agent",
        title: "Inspect logs",
        metadata: {
          hiddenFromChatList: true,
          projectAgentChildRun: {
            parentConversationId: PARENT_CONVERSATION_ID,
            parentRunId: "parent-run-1",
            spawnedFromMessageId: PARENT_MESSAGE_ID,
            spawnedFromToolCallId: "tool-call-1",
            description: "Inspect logs",
          },
        },
      },
    );
  });

  it("bootstraps a hosted child conversation, handoff message, and run", async () => {
    const requests: { url: string; body: unknown }[] = [];
    stubFetchWithRecorder(async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      const requestCount = requests.length;
      if (requestCount === 1) {
        return jsonResponse({ id: PARENT_CONVERSATION_ID, project_id: PROJECT_ID }, 200);
      }
      if (requestCount === 2) {
        return jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200);
      }
      if (requestCount === 3) {
        return jsonResponse({ id: CHILD_MESSAGE_ID }, 200);
      }
      if (requestCount === 4) {
        return acceptedRunResponse({ run_id: "run_child_1" });
      }
      if (requestCount === 5) {
        return jsonResponse(
          {
            run_id: "run_child_1",
            conversation_id: CHILD_CONVERSATION_ID,
            message_id: CHILD_MESSAGE_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 3,
            status: "running",
          },
          200,
        );
      }

      throw new Error("Unexpected fetch call");
    });

    const result = await bootstrapHostedChildRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      ensureProjectId: PROJECT_ID,
      runProjectId: PROJECT_ID,
      parentConversationId: PARENT_CONVERSATION_ID,
      parentRunId: "parent-run-1",
      parentMessageId: PARENT_MESSAGE_ID,
      spawnedFromToolCallId: "tool-call-1",
      description: "Inspect logs",
      prompt: "Find the latest logs.",
      runId: "run_child_1",
      agentId: "invoke-agent-child",
      branchId: BRANCH_ID,
    });

    assertEquals(result, {
      childConversationId: CHILD_CONVERSATION_ID,
      childRunId: "run_child_1",
      childMessageId: CHILD_MESSAGE_ID,
      latestEventId: 7,
      latestExternalEventSequence: 3,
      status: "running",
    });
    assertEquals(requests[1].body, {
      project_id: PROJECT_ID,
      type: "project_agent",
      title: "Inspect logs",
      metadata: {
        hiddenFromChatList: true,
        projectAgentChildRun: {
          parentConversationId: PARENT_CONVERSATION_ID,
          parentRunId: "parent-run-1",
          spawnedFromMessageId: PARENT_MESSAGE_ID,
          spawnedFromToolCallId: "tool-call-1",
          description: "Inspect logs",
        },
      },
    });
    assertEquals(requests[2].body, {
      role: "user",
      parts: [{ type: "text", text: "Find the latest logs." }],
    });
    assertEquals(requests[3].body, {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: CHILD_CONVERSATION_ID,
      },
      public_id: "run_child_1",
      request: {
        mode: "agent",
        agent_id: "invoke-agent-child",
        initial_status: "running",
        source_target_kind: "preview_branch",
        runtime_target_kind: "preview_branch",
        source_target_branch_id: BRANCH_ID,
        runtime_target_branch_id: BRANCH_ID,
      },
    });
  });

  it("returns the queued child run status for external agent implementations", async () => {
    const requests: { url: string; body: unknown }[] = [];
    stubFetchWithRecorder(async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      const requestCount = requests.length;
      if (requestCount === 1) {
        return jsonResponse({ id: PARENT_CONVERSATION_ID, project_id: PROJECT_ID }, 200);
      }
      if (requestCount === 2) {
        return jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200);
      }
      if (requestCount === 3) {
        return jsonResponse({ id: CHILD_MESSAGE_ID }, 200);
      }
      if (requestCount === 4) {
        return acceptedRunResponse({ run_id: "run_child_queued" });
      }
      if (requestCount === 5) {
        return jsonResponse(
          {
            run_id: "run_child_queued",
            conversation_id: CHILD_CONVERSATION_ID,
            message_id: CHILD_MESSAGE_ID,
            latest_event_id: 0,
            latest_external_event_sequence: 0,
            status: "pending",
          },
          200,
        );
      }

      throw new Error("Unexpected fetch call");
    });

    const result = await bootstrapHostedChildRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      ensureProjectId: PROJECT_ID,
      runProjectId: PROJECT_ID,
      parentConversationId: PARENT_CONVERSATION_ID,
      parentRunId: "parent-run-1",
      parentMessageId: PARENT_MESSAGE_ID,
      spawnedFromToolCallId: "tool-call-1",
      description: "Inspect logs",
      prompt: "Find the latest logs.",
      runId: "run_child_queued",
      agentId: "invoke-agent-child",
      implementationKind: "codex",
      branchId: BRANCH_ID,
    });

    assertEquals(result.status, "pending");
    assertEquals(requests[3].body, {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: CHILD_CONVERSATION_ID,
      },
      public_id: "run_child_queued",
      request: {
        mode: "agent",
        agent_id: "invoke-agent-child",
        implementation_kind: "codex",
        initial_status: "pending",
        source_target_kind: "preview_branch",
        runtime_target_kind: "preview_branch",
        source_target_branch_id: BRANCH_ID,
        runtime_target_branch_id: BRANCH_ID,
      },
    });
  });
});
