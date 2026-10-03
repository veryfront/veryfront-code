import { createHostedRunEventWriterCapability } from "./child-run-event-writer-token.ts";
import {
  hostedInheritedRunAdmitter,
  registerHostedTerminalCredential,
} from "./terminal-credential.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
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
const ENVIRONMENT_ID = "77777777-7777-4777-8777-777777777777";
const BRANCH_ID = "66666666-6666-4666-8666-666666666666";
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  for (
    const selection of [
      { branchId: BRANCH_ID },
      { runtimeTargetKind: "environment" as const, runtimeTargetEnvironmentId: ENVIRONMENT_ID },
    ]
  ) {
    it(`bootstraps one inherited child while preserving parent runtime ownership (${JSON.stringify(selection)})`, async () => {
      const parentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const childId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const token = (runId: string, canonicalRunId: string) =>
        `header.${
          btoa(
            JSON.stringify({
              runId,
              canonicalRunId,
              tokenUse: "run_event_writer",
              writerPurpose: "current_run_terminal",
              dispatchNonce: "generation",
            }),
          )
        }.signature`;
      const parent = {
        projectId: PROJECT_ID,
        authToken: AUTH_TOKEN,
        durableRootRun: { runId: "parent-run-1" },
      } as ParsedHostedChatRequest;
      registerHostedTerminalCredential(parent, token("parent-run-1", parentId));
      const requests: Request[] = [];
      const send: typeof fetch = (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url === `${API_URL}/runs`) {
          return Promise.resolve(
            Response.json({
              id: childId,
              conversation_id: CHILD_CONVERSATION_ID,
              output_message_id: CHILD_MESSAGE_ID,
              status: "running",
            }, {
              status: 202,
              headers: {
                "Cache-Control": "no-store",
                "X-Veryfront-Run-Invocation-Token": "child-invocation",
                "X-Veryfront-Run-Terminal-Token": token("run_child_1", childId),
                "X-Veryfront-Run-Renewal-Token": "child-renewal",
                "X-Veryfront-Run-Event-Token": "child-event",
                "X-Veryfront-Run-Event-Sequence": "7",
                "X-Veryfront-Run-External-Event-Sequence": "3",
              },
            }),
          );
        }
        if (request.method === "GET") {
          return Promise.resolve(
            jsonResponse({ id: PARENT_CONVERSATION_ID, project_id: PROJECT_ID }, 200),
          );
        }
        if (request.url.endsWith("/messages")) {
          return Promise.resolve(jsonResponse({ id: CHILD_MESSAGE_ID }, 200));
        }
        return Promise.resolve(
          jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: PROJECT_ID }, 200),
        );
      };
      globalThis.fetch = send;
      const capability = createHostedRunEventWriterCapability({
        apiUrl: API_URL,
        runId: "parent-run-1",
        canonicalRunId: parentId,
        runEventAppendToken: "parent-event",
        inheritedAdmitter: hostedInheritedRunAdmitter(parent, { apiUrl: API_URL, fetch: send }),
        fetch: send,
      });
      const result = await bootstrapHostedChildRun({
        runEventWriterCapability: capability,
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
        agentId: "invoke-agent-child",
        ...selection,
      });
      assertEquals(result, {
        childCanonicalRunId: childId,
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        latestEventId: 7,
        latestExternalEventSequence: 3,
        status: "running",
      });
      const admission = requests.filter((request) => request.url === `${API_URL}/runs`);
      assertEquals(admission.length, 1);
      assertEquals(admission[0]!.headers.get("X-Veryfront-Run-Execution-Mode"), "inherited");
      assertEquals(await admission[0]!.json(), {
        project_id: PROJECT_ID,
        target: { type: "agent", id: "invoke-agent-child" },
        parent_run_id: parentId,
        tool_call_id: "tool-call-1",
        input: { prompt: "Find the latest logs." },
      });
      assertEquals(requests.length, 1, "admission owns conversation and handoff creation");
      const replay = await bootstrapHostedChildRun({
        runEventWriterCapability: capability,
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
        agentId: "invoke-agent-child",
        ...selection,
      });
      assertEquals(replay, result);
      assertEquals(requests.length, 2);
      assertEquals(
        requests[1]!.headers.get("Idempotency-Key"),
        requests[0]!.headers.get("Idempotency-Key"),
      );
      assertEquals(await requests[1]!.json(), {
        project_id: PROJECT_ID,
        target: { type: "agent", id: "invoke-agent-child" },
        parent_run_id: parentId,
        tool_call_id: "tool-call-1",
        input: { prompt: "Find the latest logs." },
      });
    });
  }
});
