import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  bootstrapConversationAgentRun,
  createConversationMessage,
  createConversationRecord,
  ensureConversationProjectLink,
  fetchConversationRecord,
} from "./conversation-bootstrap.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const CHILD_CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const BRANCH_ID = "55555555-5555-4555-8555-555555555555";
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

function camelCaseDurableRunProjection(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run_child_2",
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    latestEventId: 0,
    latestExternalEventSequence: 0,
    status: "running",
    projectId: null,
    ...overrides,
  };
}

function stubFetchSequence(...steps: Response[]) {
  const queue = [...steps];
  globalThis.fetch = (async () => {
    const next = queue.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  }) as typeof fetch;
}

function stubFetchWithRecorder(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
) {
  globalThis.fetch = (async (input, init) => handler(input, init)) as typeof fetch;
}

describe("agent/conversation-bootstrap", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a conversation record", async () => {
    stubFetchSequence(jsonResponse({ id: CONVERSATION_ID, project_id: PROJECT_ID }, 200));
    const result = await fetchConversationRecord({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
    });
    assertEquals(result, { id: CONVERSATION_ID, projectId: PROJECT_ID });
  });

  it("links an unowned conversation to a project", async () => {
    stubFetchSequence(
      jsonResponse({ id: CONVERSATION_ID, project_id: null }, 200),
      jsonResponse({ id: CONVERSATION_ID, project_id: PROJECT_ID }, 200),
    );
    await ensureConversationProjectLink({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
    });
  });

  it("rejects linking when the conversation already belongs to another project", async () => {
    stubFetchSequence(jsonResponse({ id: CONVERSATION_ID, project_id: "other-project" }, 200));
    await assertRejects(
      () =>
        ensureConversationProjectLink({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          projectId: PROJECT_ID,
        }),
      Error,
      "already linked to a different project",
    );
  });

  it("creates a conversation and a handoff message", async () => {
    stubFetchSequence(
      jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200),
      jsonResponse({ id: MESSAGE_ID }, 200),
    );
    const conversation = await createConversationRecord({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      body: { project_id: PROJECT_ID, title: "Child task" },
    });
    const message = await createConversationMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CHILD_CONVERSATION_ID,
      body: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
    });
    assertEquals(conversation, { id: CHILD_CONVERSATION_ID, projectId: PROJECT_ID });
    assertEquals(message, { id: MESSAGE_ID });
  });

  it("bootstraps a conversation-backed agent run", async () => {
    stubFetchSequence(
      jsonResponse({ id: CONVERSATION_ID, project_id: PROJECT_ID }, 200),
      jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200),
      jsonResponse({ id: MESSAGE_ID }, 200),
      acceptedRunResponse({ run_id: "run_child_1" }),
      jsonResponse(
        {
          run_id: "run_child_1",
          conversation_id: CHILD_CONVERSATION_ID,
          message_id: MESSAGE_ID,
          latest_event_id: 1,
          latest_external_event_sequence: 1,
          status: "running",
        },
        200,
      ),
    );

    const result = await bootstrapConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      parentConversationId: CONVERSATION_ID,
      ensureProjectId: PROJECT_ID,
      conversationBody: { project_id: PROJECT_ID, title: "Child task" },
      handoffMessageBody: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
      runId: "run_child_1",
      agentId: "invoke-agent-child",
      projectId: PROJECT_ID,
      branchId: BRANCH_ID,
    });

    assertEquals(result.conversation, { id: CHILD_CONVERSATION_ID, projectId: PROJECT_ID });
    assertEquals(result.message, { id: MESSAGE_ID });
    assertEquals(result.run.runId, "run_child_1");
    assertEquals(result.run.conversationId, CHILD_CONVERSATION_ID);
  });

  it("accepts camelCase durable run responses for backward compatibility", async () => {
    stubFetchSequence(
      jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: null }, 200),
      jsonResponse({ id: MESSAGE_ID }, 200),
      acceptedRunResponse({ runId: "run_child_2" }),
      jsonResponse(camelCaseDurableRunProjection(), 200),
    );
    const result = await bootstrapConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationBody: { title: "Child task" },
      handoffMessageBody: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
      runId: "run_child_2",
      agentId: "invoke-agent-child",
    });
    assertEquals(result.run.runId, "run_child_2");
  });

  it("propagates project targeting from the created conversation when callers only pass branchId", async () => {
    const requests: unknown[] = [];
    stubFetchWithRecorder(async (_input, init) => {
      requests.push(init?.body ? JSON.parse(String(init.body)) : null);

      const requestCount = requests.length;
      if (requestCount === 1) {
        return jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200);
      }
      if (requestCount === 2) {
        return jsonResponse({ id: MESSAGE_ID }, 200);
      }
      if (requestCount === 3) {
        return acceptedRunResponse({ run_id: "run_child_targeted" });
      }
      if (requestCount === 4) {
        return jsonResponse(
          {
            run_id: "run_child_targeted",
            conversation_id: CHILD_CONVERSATION_ID,
            message_id: MESSAGE_ID,
            latest_event_id: 1,
            latest_external_event_sequence: 1,
            status: "running",
          },
          200,
        );
      }

      throw new Error("Unexpected fetch call");
    });

    await bootstrapConversationAgentRun({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationBody: { project_id: PROJECT_ID, title: "Child task" },
      handoffMessageBody: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
      runId: "run_child_targeted",
      agentId: "invoke-agent-child",
      branchId: BRANCH_ID,
    });

    assertEquals(requests[2], {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: CHILD_CONVERSATION_ID,
      },
      public_id: "run_child_targeted",
      request: {
        mode: "default_chat",
        agent_id: "invoke-agent-child",
        initial_status: "running",
        source_target_kind: "preview_branch",
        runtime_target_kind: "preview_branch",
        source_target_branch_id: BRANCH_ID,
        runtime_target_branch_id: BRANCH_ID,
      },
    });
  });
});
