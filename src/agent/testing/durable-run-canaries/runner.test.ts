import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDurableRunCanaryApiClient,
  createDurableRunCanaryRunner,
  type DurableRunCanaryApiClient,
  type DurableRunCanaryMessage,
  durableRunCanaryRunnerInternals,
  type DurableRunCanaryRunSummary,
  parseDurableRunCanaryRunSummary,
} from "./runner.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const childConversationId = "33333333-3333-4333-8333-333333333333";

function createRunSummary(
  overrides: Partial<DurableRunCanaryRunSummary> = {},
): DurableRunCanaryRunSummary {
  return {
    runId: "run_1",
    conversationId,
    messageId,
    agentId: "agent-a",
    status: "completed",
    latestEventId: 1,
    latestExternalEventSequence: null,
    waitingToolCallId: null,
    waitingToolName: null,
    terminalErrorCode: null,
    terminalErrorMessage: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("agent testing durable run canary runner", () => {
  it("parses snake-case and camel-case run summaries", () => {
    assertEquals(
      parseDurableRunCanaryRunSummary({
        run_id: "run_1",
        conversation_id: conversationId,
        message_id: messageId,
        agent_id: "agent-a",
        status: "completed",
        latest_event_id: 7,
      }),
      createRunSummary({ latestEventId: 7 }),
    );

    assertEquals(
      parseDurableRunCanaryRunSummary({
        runId: "run_2",
        conversationId,
        messageId,
        agentId: "agent-b",
        status: "failed",
        latestEventId: 9,
        terminalErrorCode: "boom",
      }),
      createRunSummary({
        runId: "run_2",
        agentId: "agent-b",
        status: "failed",
        latestEventId: 9,
        terminalErrorCode: "boom",
      }),
    );
  });

  it("collects child conversation ids from tool results", () => {
    assertEquals(
      durableRunCanaryRunnerInternals.collectReferencedChildConversationIds([
        {
          id: "message-1",
          role: "assistant",
          parts: [
            {
              type: "tool_result",
              output: JSON.stringify({ childConversationId }),
            },
            {
              type: "tool-result",
              output: { child_conversation_id: childConversationId },
            },
          ],
        },
      ]),
      [childConversationId],
    );
  });

  it("runs a canary case through the durable API client contract", async () => {
    const calls: string[] = [];
    let cleanedRunId = "";
    let stoppedSidecar = false;
    const rootMessages: DurableRunCanaryMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "tool_result", output: { childConversationId } }],
      },
    ];
    const childMessages: DurableRunCanaryMessage[] = [
      {
        id: "child-assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "child done" }],
      },
    ];
    const apiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async (input) => {
        calls.push(`create:${input.conversationId}:${input.runId}`);
      },
      getRunSummary: async (input) => {
        calls.push(`get:${input.conversationId}:${input.runId}`);
        return createRunSummary({ runId: input.runId });
      },
      listMessagesForCanary: async (input) => {
        calls.push(`messages:${input.conversationId}`);
        return input.conversationId === childConversationId ? childMessages : rootMessages;
      },
      sendUserMessageForCanary: async (input) => {
        calls.push(`send:${input.conversationId}:${input.prompt}`);
        return {
          id: "user-message-1",
          role: "user",
          parts: [{ type: "text", text: input.prompt }],
        };
      },
      startDurableRun: async (input) => {
        calls.push(`start:${input.conversationId}:${input.messageId}:${input.userMessageId}`);
      },
    };

    const runner = createDurableRunCanaryRunner(
      {
        apiUrl: "https://api.example.test",
        authToken: "token",
        agentId: "agent-a",
        projectId: null,
        requestTimeoutMs: 1_000,
        keepSuccessfulEvidence: false,
      },
      apiClient,
    );

    const result = await runner.runCase({
      id: "case-a",
      label: "Case A",
      prepare: async () => ({
        conversationId,
        prompt: "hello",
        title: "case-a",
        artifactPaths: (runId) => [`evidence/${runId}.json`],
        cleanup: async (input) => {
          cleanedRunId = input?.runId ?? "missing";
        },
        startSidecar: async () => async () => {
          stoppedSidecar = true;
        },
        validate: ({ messages, run }) => {
          assertEquals(run.status, "completed");
          assertEquals(messages.map((message) => message.id), ["assistant-1", "child-assistant-1"]);
        },
      }),
    });

    assertEquals(result.status, "pass");
    assertMatch(result.runId, /^run_/);
    assertEquals(result.artifactPaths, [`evidence/${result.runId}.json`]);
    assertEquals(cleanedRunId, result.runId);
    assertEquals(stoppedSidecar, true);
    assertEquals(calls, [
      "send:11111111-1111-4111-8111-111111111111:hello",
      `create:11111111-1111-4111-8111-111111111111:${result.runId}`,
      `get:11111111-1111-4111-8111-111111111111:${result.runId}`,
      `start:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:user-message-1`,
      `get:11111111-1111-4111-8111-111111111111:${result.runId}`,
      "messages:11111111-1111-4111-8111-111111111111",
      "messages:33333333-3333-4333-8333-333333333333",
    ]);
  });

  it("creates control-plane requests for durable run canaries", async () => {
    const requests: { path: string; method: string; body: unknown }[] = [];
    const client = createDurableRunCanaryApiClient({
      apiUrl: "https://api.example.test/root",
      authToken: "token-a",
      agentId: "agent-b",
      projectId: "project-a",
      branchId: "branch-a",
      requestTimeoutMs: 1_000,
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        requests.push({
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });

        if (url.pathname.endsWith("/messages") && init?.method === "POST") {
          return Response.json({ id: "user-message-1", role: "user", parts: [] });
        }
        if (url.pathname.endsWith("/runs/run_1")) {
          return Response.json({
            run_id: "run_1",
            conversation_id: conversationId,
            message_id: messageId,
            agent_id: "agent-b",
            status: "completed",
            latest_event_id: 1,
          });
        }
        if (url.pathname.endsWith("/messages") && init?.method !== "POST") {
          return Response.json({ data: [] });
        }
        return Response.json({ ok: true });
      },
    });

    await client.sendUserMessageForCanary({ conversationId, prompt: "hello" });
    await client.createDurableRootRun({ conversationId, runId: "run_1" });
    await client.startDurableRun({
      conversationId,
      runId: "run_1",
      messageId,
      prompt: "hello",
      userMessageId: "user-message-1",
    });
    await client.getRunSummary({ conversationId, runId: "run_1" });
    await client.listMessagesForCanary({ conversationId });

    assertEquals(requests[0], {
      path: `/root/conversations/${conversationId}/messages`,
      method: "POST",
      body: { role: "user", parts: [{ type: "text", text: "hello" }] },
    });
    assertEquals(requests[1], {
      path: "/root/runs",
      method: "POST",
      body: {
        kind: "agent",
        owner: { kind: "conversation", id: conversationId },
        public_id: "run_1",
        request: {
          mode: "default_chat",
          agent_id: "agent-b",
          initial_status: "pending",
          source_target_kind: "project",
          runtime_target_kind: "production",
          runtime_target_branch_id: "branch-a",
        },
      },
    });
    const startRunRequest = requests[2];
    if (!startRunRequest) {
      throw new Error("Expected a start run request");
    }
    assertEquals(startRunRequest.path, "/root/runs");
    assertEquals(startRunRequest.method, "POST");
    assertEquals(startRunRequest.body, {
      kind: "agent",
      owner: { kind: "conversation", id: conversationId },
      public_id: "run_1",
      request: {
        mode: "default_chat",
        agent_id: "agent-b",
        input: {
          messages: [
            {
              id: "user-message-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
          context: {
            conversation_id: conversationId,
            project_id: "project-a",
            branch_id: "branch-a",
          },
          durable_root_run: {
            run_id: "run_1",
            message_id: messageId,
          },
        },
      },
    });
    const getRunRequest = requests[3];
    const listMessagesRequest = requests[4];
    if (!getRunRequest || !listMessagesRequest) {
      throw new Error("Expected get-run and list-messages requests");
    }
    assertEquals(getRunRequest.path, `/root/conversations/${conversationId}/runs/run_1`);
    assertEquals(
      listMessagesRequest.path,
      `/root/conversations/${conversationId}/messages?limit=100`,
    );
  });
});
