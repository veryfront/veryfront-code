import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  bootstrapConversationAgentRun,
  createConversationMessage,
  createConversationRecord,
  ensureConversationProjectLink,
  fetchConversationRecord,
  findLatestUserConversationMessageContext,
  persistConversationUserMessage,
  persistLatestConversationUserMessage,
} from "./bootstrap.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const CHILD_CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const USER_MESSAGE_ID = "33333333-3333-4333-a333-333333333334";
const PARENT_MESSAGE_ID = "33333333-3333-4333-a333-333333333335";
const SECOND_USER_MESSAGE_ID = "33333333-3333-4333-a333-333333333337";
const SYSTEM_MESSAGE_ID = "33333333-3333-4333-a333-333333333336";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const BRANCH_ID = "55555555-5555-4555-8555-555555555555";
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
    stubFetchWithRecorder((input, init) => {
      calls.push({ url: String(input), method: init?.method, body: init?.body ?? null });
      return calls.length === 1
        ? jsonResponse({ id: CONVERSATION_ID, project_id: null }, 200)
        : jsonResponse({ id: CONVERSATION_ID, project_id: PROJECT_ID }, 200);
    });

    await ensureConversationProjectLink({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
    });

    assertEquals(calls.length, 2, "linking must issue the fetch and the PATCH");
    assertEquals(
      calls[1]?.url,
      `${API_URL}/conversations/${CONVERSATION_ID}`,
      "the PATCH targets the conversation record",
    );
    assertEquals(calls[1]?.method, "PATCH", "the link is written with PATCH");
    assertEquals(
      JSON.parse(String(calls[1]?.body)),
      { project_id: PROJECT_ID },
      "the PATCH body carries the project id",
    );
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
    const calls: { url: string; init?: RequestInit }[] = [];
    stubFetchWithRecorder((input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200)
        : jsonResponse({ id: MESSAGE_ID }, 200);
    });
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
    assertEquals(
      calls[0]?.url,
      `${API_URL}/conversations`,
      "createConversationRecord must POST to the conversations collection",
    );
    assertEquals(calls[0]?.init?.method, "POST", "createConversationRecord must use POST");
    assertEquals(
      JSON.parse(String(calls[0]?.init?.body)),
      { project_id: PROJECT_ID, title: "Child task" },
      "the conversation body must be forwarded verbatim",
    );
    assertEquals(
      (calls[0]?.init?.headers as Record<string, string> | undefined)?.Authorization,
      `Bearer ${AUTH_TOKEN}`,
      "the create call must carry the bearer token",
    );
  });

  it("persists a UI user message through the conversation messages endpoint", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    stubFetchWithRecorder((input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({ id: MESSAGE_ID }, 201);
    });

    const result = await persistConversationUserMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      parentMessageId: PARENT_MESSAGE_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { agentId: "test-agent" },
      },
    });

    assertEquals(result, { id: MESSAGE_ID });
    assertEquals(capturedUrl, `${API_URL}/conversations/${CONVERSATION_ID}/messages`);
    assertEquals(capturedInit?.method, "POST");
    assertEquals(capturedInit?.headers, {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    });
    assertEquals(JSON.parse(String(capturedInit?.body)), {
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
      idempotency_key: USER_MESSAGE_ID,
      parent_id: PARENT_MESSAGE_ID,
      metadata: { agentId: "test-agent" },
    });
  });

  it("rejects UI user messages without persistable parts", async () => {
    await assertRejects(
      () =>
        persistConversationUserMessage({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          message: {
            id: USER_MESSAGE_ID,
            role: "user",
            parts: [],
          },
        }),
      Error,
      "CONVERSATION_USER_MESSAGE_REQUIRES_PERSISTABLE_PARTS",
    );
  });

  it("finds the latest user message and visible non-system parent", () => {
    const result = findLatestUserConversationMessageContext([
      { id: SYSTEM_MESSAGE_ID, role: "system", parts: [{ type: "text", text: "system" }] },
      { id: PARENT_MESSAGE_ID, role: "assistant", parts: [{ type: "text", text: "reply" }] },
      { id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] },
    ]);

    assertEquals(result.latestUserMessage?.id, USER_MESSAGE_ID);
    assertEquals(result.visibleParentMessageId, PARENT_MESSAGE_ID);

    const multiTurn = findLatestUserConversationMessageContext([
      { id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] },
      { id: PARENT_MESSAGE_ID, role: "assistant", parts: [{ type: "text", text: "reply" }] },
      { id: SECOND_USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Second" }] },
    ]);

    assertEquals(
      multiTurn.latestUserMessage?.id,
      SECOND_USER_MESSAGE_ID,
      "the newest user message wins over an earlier one",
    );
    assertEquals(
      multiTurn.visibleParentMessageId,
      PARENT_MESSAGE_ID,
      "the parent is the visible message before the newest user message",
    );
  });

  it("does not use a system message as latest user message parent", () => {
    const result = findLatestUserConversationMessageContext([
      { id: SYSTEM_MESSAGE_ID, role: "system", parts: [{ type: "text", text: "system" }] },
      { id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] },
    ]);

    assertEquals(result.latestUserMessage?.id, USER_MESSAGE_ID);
    assertEquals(result.visibleParentMessageId, undefined);
  });

  it("persists the latest conversation user message with a visible UUID parent", async () => {
    let capturedInit: RequestInit | undefined;
    stubFetchWithRecorder((_input, init) => {
      capturedInit = init;
      return jsonResponse({ id: MESSAGE_ID }, 201);
    });

    await persistLatestConversationUserMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      enabled: true,
      messages: [
        { id: PARENT_MESSAGE_ID, role: "assistant", parts: [{ type: "text", text: "reply" }] },
        { id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] },
      ],
      operation: "Persist latest user message",
    });

    assertEquals(JSON.parse(String(capturedInit?.body)), {
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
      idempotency_key: USER_MESSAGE_ID,
      parent_id: PARENT_MESSAGE_ID,
    });

    await persistLatestConversationUserMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      enabled: true,
      messages: [
        { id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] },
        { id: PARENT_MESSAGE_ID, role: "assistant", parts: [{ type: "text", text: "reply" }] },
        { id: SECOND_USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Second" }] },
      ],
      operation: "Persist latest user message",
    });

    assertEquals(
      JSON.parse(String(capturedInit?.body)),
      {
        role: "user",
        parts: [{ type: "text", text: "Second" }],
        idempotency_key: SECOND_USER_MESSAGE_ID,
        parent_id: PARENT_MESSAGE_ID,
      },
      "the newest user message of a multi-turn thread is the one persisted",
    );
  });

  it("omits a non-UUID visible parent id from the persisted message", async () => {
    let capturedInit: RequestInit | undefined;
    stubFetchWithRecorder((_input, init) => {
      capturedInit = init;
      return jsonResponse({ id: MESSAGE_ID }, 201);
    });

    await persistLatestConversationUserMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      enabled: true,
      messages: [
        { id: "msg-local-1", role: "assistant", parts: [{ type: "text", text: "reply" }] },
        { id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] },
      ],
    });

    const latestBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    assertEquals(
      Object.hasOwn(latestBody, "parent_id"),
      false,
      "a non-UUID visible parent id must not be sent as parent_id",
    );
    assertEquals(
      latestBody,
      {
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        idempotency_key: USER_MESSAGE_ID,
      },
      "the message must still carry role, parts and idempotency_key",
    );

    await persistConversationUserMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      parentMessageId: "msg-local-1",
      message: {
        id: USER_MESSAGE_ID,
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    });

    const directBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    assertEquals(
      Object.hasOwn(directBody, "parent_id"),
      false,
      "a non-UUID parent message id must not be sent as parent_id",
    );
  });

  it("skips latest user message persistence when disabled", async () => {
    globalThis.fetch = () => {
      throw new Error("Unexpected fetch call");
    };

    await persistLatestConversationUserMessage({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      enabled: false,
      messages: [{ id: USER_MESSAGE_ID, role: "user", parts: [{ type: "text", text: "Hello" }] }],
    });
  });

  it("rejects latest user message persistence when no user message exists", async () => {
    await assertRejects(
      () =>
        persistLatestConversationUserMessage({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          enabled: true,
          messages: [{
            id: SYSTEM_MESSAGE_ID,
            role: "system",
            parts: [{ type: "text", text: "system" }],
          }],
          missingUserMessageErrorMessage: "DURABLE_CHAT_ROOT_REQUIRES_USER_MESSAGE",
        }),
      Error,
      "DURABLE_CHAT_ROOT_REQUIRES_USER_MESSAGE",
    );
  });

  it("refuses missing admission authority before any conversation writes", async () => {
    let calls = 0;
    stubFetchWithRecorder(() => {
      calls++;
      return jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 201);
    });
    await assertRejects(
      () =>
        bootstrapConversationAgentRun({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          parentConversationId: CONVERSATION_ID,
          ensureProjectId: PROJECT_ID,
          conversationBody: {},
          handoffMessageBody: {},
          agentId: "child",
        }),
      Error,
      "admission capability",
    );
    assertEquals(calls, 0);
  });

  it("bootstraps a conversation-backed run through its bound admission capability", async () => {
    const requests: unknown[] = [];
    const projection = {
      runId: "run_child_1",
      conversationId: CHILD_CONVERSATION_ID,
      messageId: MESSAGE_ID,
      latestEventId: 1,
      latestExternalEventSequence: 1,
      waitingToolCallId: null,
      waitingToolName: null,
      streamProtocolVersion: 1 as const,
      status: "running" as const,
    };
    stubFetchSequence(
      jsonResponse({ id: CONVERSATION_ID, project_id: PROJECT_ID }, 200),
      jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 201),
      jsonResponse({ id: MESSAGE_ID }, 201),
    );
    const result = await bootstrapConversationAgentRun({
      admitRun: async (input) => {
        requests.push(input);
        return projection;
      },
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      parentConversationId: CONVERSATION_ID,
      ensureProjectId: PROJECT_ID,
      conversationBody: { project_id: PROJECT_ID, title: "Child task" },
      handoffMessageBody: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
      runId: "run_child_1",
      parentRunId: "run_parent",
      agentId: "invoke-agent-child",
      projectId: PROJECT_ID,
      branchId: BRANCH_ID,
    });
    assertEquals(result.conversation, { id: CHILD_CONVERSATION_ID, projectId: PROJECT_ID });
    assertEquals(result.message, { id: MESSAGE_ID });
    assertEquals(result.run, projection);
    assertEquals(requests, [{
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CHILD_CONVERSATION_ID,
      runId: "run_child_1",
      parentRunId: "run_parent",
      agentId: "invoke-agent-child",
      implementationKind: undefined,
      projectId: PROJECT_ID,
      runtimeTargetKind: undefined,
      runtimeTargetEnvironmentId: undefined,
      branchId: BRANCH_ID,
    }]);
  });

  it("preserves the bound admission result and propagates its failures", async () => {
    stubFetchSequence(
      jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: null }, 201),
      jsonResponse({ id: MESSAGE_ID }, 201),
    );
    await assertRejects(
      () =>
        bootstrapConversationAgentRun({
          admitRun: () => Promise.reject(new Error("Parent execution was fenced")),
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationBody: { title: "Child task" },
          handoffMessageBody: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
          runId: "run_child_2",
          agentId: "invoke-agent-child",
        }),
      Error,
      "Parent execution was fenced",
    );
  });

  it("propagates the created conversation project and branch to the admission capability", async () => {
    const requests: unknown[] = [];
    stubFetchSequence(
      jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 201),
      jsonResponse({ id: MESSAGE_ID }, 201),
    );
    await bootstrapConversationAgentRun({
      admitRun: async (input) => {
        requests.push(input);
        return {
          runId: "run_child_targeted",
          conversationId: CHILD_CONVERSATION_ID,
          messageId: MESSAGE_ID,
          latestEventId: 1,
          latestExternalEventSequence: 1,
          waitingToolCallId: null,
          waitingToolName: null,
          streamProtocolVersion: 1,
          status: "running",
        };
      },
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationBody: { project_id: PROJECT_ID, title: "Child task" },
      handoffMessageBody: { role: "user", parts: [{ type: "text", text: "Do the task" }] },
      runId: "run_child_targeted",
      agentId: "invoke-agent-child",
      branchId: BRANCH_ID,
    });
    assertEquals(requests, [{
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CHILD_CONVERSATION_ID,
      runId: "run_child_targeted",
      parentRunId: undefined,
      agentId: "invoke-agent-child",
      implementationKind: undefined,
      projectId: PROJECT_ID,
      runtimeTargetKind: undefined,
      runtimeTargetEnvironmentId: undefined,
      branchId: BRANCH_ID,
    }]);
  });
});
