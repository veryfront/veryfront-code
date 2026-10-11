import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHostedChatRequestInputFromRuntimeAgentInvocation,
  RuntimeAgentRunInvocationSchema,
} from "#veryfront/agent";
import { createLiveEvalCaseSupport, type LiveEvalCase } from "./runner.ts";
import { isEvalRecord } from "../../validation.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const USER_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";

type CapturedRequest = {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
};

function parseBody(init: RequestInit | undefined): unknown {
  return init?.body === undefined ? undefined : JSON.parse(String(init.body));
}

function conversationMessagesUrl(conversationId: string): string {
  return `https://api.example.test/conversations/${encodeURIComponent(conversationId)}/messages`;
}

function persistedUserMessageResponse(messageId = USER_MESSAGE_ID): Response {
  return Response.json({
    id: messageId,
    role: "user",
    parts: [],
  }, { status: 201 });
}

function canonicalFrame(
  eventId: number | null,
  eventType: string,
  payload: Record<string, unknown>,
): string {
  const idLine = eventId === null ? "" : `id: ${eventId}\n`;
  return `${idLine}event: ${eventType}\ndata: ${
    JSON.stringify({
      event_id: eventId,
      event_type: eventType,
      payload: { type: eventType, ...payload },
      is_error: eventType === "RUN_ERROR",
      created_at: "2026-10-11T00:00:00.000Z",
    })
  }\n\n`;
}

function canonicalStreamResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function readCanonicalInput(body: unknown): Record<string, unknown> {
  if (!isEvalRecord(body)) return {};
  return isEvalRecord(body.input) ? body.input : {};
}

function readCanonicalRequestMessageId(body: unknown): string {
  const input = readCanonicalInput(body);
  const messages = input.messages;
  if (!Array.isArray(messages)) return "";
  const message = messages[0];
  if (typeof message !== "object" || message === null || !("id" in message)) return "";
  return typeof message.id === "string" ? message.id : "";
}

function readCanonicalClientRunId(body: unknown): string {
  if (typeof body !== "object" || body === null || !("config" in body)) return "";
  const config = body.config;
  if (typeof config !== "object" || config === null || !("agent_admission" in config)) return "";
  const admission = config.agent_admission;
  if (typeof admission !== "object" || admission === null || !("client_run_id" in admission)) {
    return "";
  }
  return typeof admission.client_run_id === "string" ? admission.client_run_id : "";
}

function createRuntimeInvocationFromCanonicalInput(input: Record<string, unknown>) {
  return RuntimeAgentRunInvocationSchema.parse({
    run: {
      agentServiceId: "veryfront",
      agentId: "veryfront",
      conversationId: CONVERSATION_ID,
      runId: readCanonicalClientRunId({
        config: { agent_admission: { client_run_id: "run_adapter" } },
      }),
      messageId: "66666666-6666-4666-8666-666666666666",
      inputAnchorMessageId: readCanonicalRequestMessageId({ input }),
      requestedByUserId: USER_ID,
      project: {
        projectId: PROJECT_ID,
        projectSlug: "demo-project",
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: BRANCH_ID,
      },
      validatedClaims: {
        subject: USER_ID,
        projectId: PROJECT_ID,
        projectSlug: "demo-project",
        scopes: ["agent:run"],
      },
    },
    messages: input.messages,
    context: [],
    tools: [],
    credentials: { authToken: "request-scoped-user-token" },
    agentSource: { type: "branch", branch: "main" },
    forwardedProps: input.forwardedProps,
  });
}

function directCompletedResponse(): Response {
  return new Response(
    'data: {"type":"RUN_STARTED","runId":"direct-run"}\n\n' +
      'data: {"type":"RUN_FINISHED","runId":"direct-run"}\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function createSupport(
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
  options: { branchId?: string | null; projectId?: string | null } = {},
) {
  return createLiveEvalCaseSupport({
    endpoint: "http://127.0.0.1:4311/api/ag-ui",
    apiUrl: "https://api.example.test",
    authToken: "fixture-token",
    projectId: options.projectId === undefined ? PROJECT_ID : options.projectId,
    branchId: options.branchId === undefined ? BRANCH_ID : options.branchId,
    model: "openai:gpt-test",
    requestTimeoutMs: 1_000,
    progressLogIntervalMs: 60_000,
    enableLlmJudge: false,
    log: () => {},
    fetch: (input, init) => Promise.resolve(fetchImpl(input, init)),
  });
}

describe("conversation-backed live eval canonical routing", () => {
  it("keeps direct AG-UI routing for cases without a prepared conversation", async () => {
    const requests: CapturedRequest[] = [];
    const support = createSupport((input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      });
      return directCompletedResponse();
    });

    const result = await support.runEval({
      id: "direct-case",
      label: "Direct case",
      prompt: "Say OK",
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "pass");
    assertEquals(requests.map((request) => request.url), ["http://127.0.0.1:4311/api/ag-ui"]);
    assertEquals(requests[0]?.method, "POST");
    assertEquals(requests[0]?.headers.get("Authorization"), "Bearer fixture-token");
  });

  it("admits prepared conversation cases through canonical runs and preserves prompt, model and runtime overrides", async () => {
    const requests: CapturedRequest[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === "http://127.0.0.1:4311/api/ag-ui") {
        return new Response("old direct route should not be used", { status: 500 });
      }
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return persistedUserMessageResponse();
      }
      if (request.url === "https://api.example.test/runs") {
        return Response.json({ id: RUN_ID, status: "running" }, { status: 202 });
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/stream`) {
        return canonicalStreamResponse([
          canonicalFrame(1, "RUN_STARTED", { runId: RUN_ID }),
          canonicalFrame(2, "TOOL_CALL_START", {
            toolCallId: "tool-1",
            toolCallName: "invoke_agent",
          }),
          canonicalFrame(3, "TOOL_CALL_ARGS", {
            toolCallId: "tool-1",
            delta: '{"task":"explain"}',
          }),
          canonicalFrame(4, "TEXT_MESSAGE_CONTENT", { messageId: "msg-1", delta: "Done" }),
          canonicalFrame(5, "RUN_FINISHED", { runId: RUN_ID }),
        ]);
      }
      throw new Error(`unexpected request ${request.url}`);
    });

    let verifierSawText = "";
    let verifierSawTools: string[] = [];
    const testCase: LiveEvalCase = {
      id: "delegation-root-voice-synthesis",
      label: "Delegation root voice",
      prompt: "Fallback prompt must not be used.",
      allowedTools: ["invoke_agent"],
      forceRuntimeOverrides: true,
      maxSteps: 5,
      prepare: () =>
        Promise.resolve({
          prompt: "Use invoke_agent exactly once.",
          metadata: {
            conversationId: CONVERSATION_ID,
            customTag: "retained",
            evalCase: "spoofed",
          },
        }),
      verify: (run) => {
        verifierSawText = run.text;
        verifierSawTools = run.toolStarts;
        return null;
      },
    };

    const result = await support.runEval(testCase, "framework");

    assertEquals(result.status, "pass");
    assertEquals(verifierSawText, "Done");
    assertEquals(verifierSawTools, ["invoke_agent"]);
    assertEquals(requests.map((request) => request.url), [
      conversationMessagesUrl(CONVERSATION_ID),
      "https://api.example.test/runs",
      `https://api.example.test/runs/${RUN_ID}/stream`,
    ]);
    assertStringIncludes(
      requests[1]?.headers.get("Idempotency-Key") ?? "",
      "live-eval:delegation-root-voice-synthesis:",
    );
    assertEquals(requests[0]?.method, "POST");
    assertEquals(requests[0]?.headers.get("Authorization"), "Bearer fixture-token");
    assertEquals(requests[0]?.body, {
      role: "user",
      parts: [{ type: "text", text: "Use invoke_agent exactly once." }],
    });
    assertEquals(requests[1]?.headers.get("Authorization"), "Bearer fixture-token");
    const userMessageId = readCanonicalRequestMessageId(requests[1]?.body);
    const clientRunId = readCanonicalClientRunId(requests[1]?.body);
    const canonicalInput = readCanonicalInput(requests[1]?.body);
    assertEquals(userMessageId, USER_MESSAGE_ID);
    assertStringIncludes(clientRunId, "run_");
    assertEquals(requests[1]?.body, {
      project_id: PROJECT_ID,
      title: "Delegation root voice",
      target: { type: "agent", id: "veryfront" },
      conversation_id: CONVERSATION_ID,
      execution: { runtime: { type: "preview_branch", id: BRANCH_ID } },
      input: {
        messages: [
          {
            id: USER_MESSAGE_ID,
            role: "user",
            parts: [{ type: "text", text: "Use invoke_agent exactly once." }],
          },
        ],
        state: {
          conversationId: CONVERSATION_ID,
          customTag: "retained",
          evalCase: "delegation-root-voice-synthesis",
        },
        context: {
          conversationId: CONVERSATION_ID,
          projectId: PROJECT_ID,
          branchId: BRANCH_ID,
        },
        forwardedProps: {
          model: "openai:gpt-test",
          runtimeOverrides: { allowedTools: ["invoke_agent"], maxSteps: 5 },
          veryfront: {
            projectId: PROJECT_ID,
            conversationId: CONVERSATION_ID,
            branchId: BRANCH_ID,
            model: "openai:gpt-test",
            runtimeOverrides: { allowedTools: ["invoke_agent"], maxSteps: 5 },
          },
        },
      },
      config: {
        agent_admission: {
          mode: "hosted",
          input_message_id: USER_MESSAGE_ID,
          client_run_id: clientRunId,
        },
      },
    });

    const hostedInput = buildHostedChatRequestInputFromRuntimeAgentInvocation(
      createRuntimeInvocationFromCanonicalInput(canonicalInput),
    );
    assertEquals(hostedInput.forwardedProps, {
      model: "openai:gpt-test",
      runtimeOverrides: { allowedTools: ["invoke_agent"], maxSteps: 5 },
      veryfront: {
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        branchId: BRANCH_ID,
        model: "openai:gpt-test",
        runtimeOverrides: { allowedTools: ["invoke_agent"], maxSteps: 5 },
      },
    });
  });

  it("uses main branch canonical execution when no branch is configured", async () => {
    const requests: CapturedRequest[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return persistedUserMessageResponse();
      }
      if (request.url === "https://api.example.test/runs") {
        return Response.json({ id: RUN_ID, status: "running" }, { status: 202 });
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/stream`) {
        return canonicalStreamResponse([
          canonicalFrame(1, "RUN_STARTED", { runId: RUN_ID }),
          canonicalFrame(2, "RUN_FINISHED", { runId: RUN_ID }),
        ]);
      }
      throw new Error(`unexpected request ${request.url}`);
    }, { branchId: null });

    const result = await support.runEval({
      id: "canonical-main-branch",
      label: "Canonical main branch",
      prompt: "Run",
      prepare: () => Promise.resolve({ metadata: { conversationId: CONVERSATION_ID } }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "pass");
    const body = requests[1]?.body;
    assertEquals(
      typeof body === "object" && body !== null && "execution" in body ? body.execution : null,
      { runtime: { type: "main_branch" } },
    );
  });

  it("cancels admitted canonical runs on stream failure and still runs prepared cleanup", async () => {
    const requests: CapturedRequest[] = [];
    const lifecycle: string[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return persistedUserMessageResponse();
      }
      if (request.url === "https://api.example.test/runs") {
        return Response.json({ id: RUN_ID, status: "running" }, { status: 202 });
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/stream`) {
        throw new Error("stream exploded");
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/cancel`) {
        return Response.json({ id: RUN_ID, status: "cancelled" }, { status: 202 });
      }
      throw new Error(`unexpected request ${request.url}`);
    });

    const result = await support.runEval({
      id: "canonical-timeout",
      label: "Canonical timeout",
      prompt: "Run slowly",
      prepare: () =>
        Promise.resolve({
          metadata: { conversationId: CONVERSATION_ID },
          cleanup: () => {
            lifecycle.push("prepared:cleanup");
            return Promise.resolve();
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "stream exploded");
    assertEquals(lifecycle, ["prepared:cleanup"]);
    assertEquals(requests.map((request) => [request.method, request.url]), [
      ["POST", conversationMessagesUrl(CONVERSATION_ID)],
      ["POST", "https://api.example.test/runs"],
      ["GET", `https://api.example.test/runs/${RUN_ID}/stream`],
      ["POST", `https://api.example.test/runs/${RUN_ID}/cancel`],
    ]);
    assertStringIncludes(
      requests[3]?.headers.get("Idempotency-Key") ?? "",
      `live-eval-cancel:${RUN_ID}`,
    );
  });

  it("deduplicates replayed durable canonical event ids while keeping transient null ids", async () => {
    const requests: CapturedRequest[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return persistedUserMessageResponse();
      }
      if (request.url === "https://api.example.test/runs") {
        return Response.json({ id: RUN_ID, status: "running" }, { status: 202 });
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/stream`) {
        return canonicalStreamResponse([
          canonicalFrame(1, "RUN_STARTED", { runId: RUN_ID }),
          canonicalFrame(2, "TOOL_CALL_START", {
            toolCallId: "tool-1",
            toolCallName: "invoke_agent",
          }),
          canonicalFrame(2, "TOOL_CALL_START", {
            toolCallId: "tool-1",
            toolCallName: "invoke_agent",
          }),
          canonicalFrame(3, "TEXT_MESSAGE_CONTENT", { messageId: "msg-1", delta: "Done " }),
          canonicalFrame(3, "TEXT_MESSAGE_CONTENT", { messageId: "msg-1", delta: "Done " }),
          canonicalFrame(null, "TEXT_MESSAGE_CONTENT", { messageId: "transient-1", delta: "A" }),
          canonicalFrame(null, "TEXT_MESSAGE_CONTENT", { messageId: "transient-2", delta: "B" }),
          canonicalFrame(4, "RUN_FINISHED", { runId: RUN_ID }),
        ]);
      }
      throw new Error(`unexpected request ${request.url}`);
    });

    let verifierText = "";
    let verifierToolStarts: string[] = [];
    let verifierEventTypes: string[] = [];
    const result = await support.runEval({
      id: "canonical-duplicate-replay",
      label: "Canonical duplicate replay",
      prompt: "Run",
      prepare: () => Promise.resolve({ metadata: { conversationId: CONVERSATION_ID } }),
      verify: (run) => {
        verifierText = run.text;
        verifierToolStarts = run.toolStarts;
        verifierEventTypes = run.eventTypes;
        return null;
      },
    }, "framework");

    assertEquals(result.status, "pass");
    assertEquals(verifierText, "Done AB");
    assertEquals(verifierToolStarts, ["invoke_agent"]);
    assertEquals(verifierEventTypes, [
      "RUN_STARTED",
      "TOOL_CALL_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    assertEquals(requests.map((request) => [request.method, request.url]), [
      ["POST", conversationMessagesUrl(CONVERSATION_ID)],
      ["POST", "https://api.example.test/runs"],
      ["GET", `https://api.example.test/runs/${RUN_ID}/stream`],
    ]);
  });

  it("rejects missing project binding before persisting a message", async () => {
    const requests: string[] = [];
    let cleanupCalled = false;
    const support = createSupport((input) => {
      requests.push(String(input));
      return persistedUserMessageResponse();
    }, { projectId: null });

    const result = await support.runEval({
      id: "canonical-missing-project",
      label: "Canonical missing project",
      prompt: "Do not persist without a project binding",
      prepare: () =>
        Promise.resolve({
          metadata: { conversationId: CONVERSATION_ID },
          cleanup: () => {
            cleanupCalled = true;
            return Promise.resolve();
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "require AG_UI_EVAL_PROJECT_ID");
    assertEquals(requests, []);
    assertEquals(cleanupCalled, true);
  });

  it("fails before run admission when message persistence fails", async () => {
    const requests: CapturedRequest[] = [];
    const lifecycle: string[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return new Response("Bearer fixture-token; private customer prompt", { status: 503 });
      }
      throw new Error(`unexpected request ${request.url}`);
    });

    const result = await support.runEval({
      id: "canonical-message-persist-failure",
      label: "Canonical message persist failure",
      prompt: "Persist me",
      prepare: () =>
        Promise.resolve({
          metadata: { conversationId: CONVERSATION_ID },
          cleanup: () => {
            lifecycle.push("prepared:cleanup");
            return Promise.resolve();
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "Failed to persist canonical live eval user message");
    assertStringIncludes(result.details, "503");
    assertEquals(result.details.includes("fixture-token"), false);
    assertEquals(result.details.includes("private customer prompt"), false);
    assertEquals(lifecycle, ["prepared:cleanup"]);
    assertEquals(requests.map((request) => [request.method, request.url]), [
      ["POST", conversationMessagesUrl(CONVERSATION_ID)],
    ]);
  });

  it("sanitizes malformed message response JSON before reporting failure", async () => {
    const requests: string[] = [];
    let cleanupCalled = false;
    const support = createSupport((input) => {
      requests.push(String(input));
      return new Response("LEAK_THIS_HEADER_CUSTOMER_DATA", { status: 201 });
    });

    const result = await support.runEval({
      id: "canonical-message-invalid-json",
      label: "Canonical message invalid JSON",
      prompt: "Persist me",
      prepare: () =>
        Promise.resolve({
          metadata: { conversationId: CONVERSATION_ID },
          cleanup: () => {
            cleanupCalled = true;
            return Promise.resolve();
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "message persistence returned invalid JSON");
    assertEquals(result.details.includes("LEAK"), false);
    assertEquals(requests, [conversationMessagesUrl(CONVERSATION_ID)]);
    assertEquals(cleanupCalled, true);
  });

  it("fails before run admission when message persistence response is malformed", async () => {
    const requests: CapturedRequest[] = [];
    const lifecycle: string[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return Response.json({ role: "user", parts: [] }, { status: 201 });
      }
      throw new Error(`unexpected request ${request.url}`);
    });

    const result = await support.runEval({
      id: "canonical-message-persist-malformed",
      label: "Canonical message persist malformed",
      prompt: "Persist me",
      prepare: () =>
        Promise.resolve({
          metadata: { conversationId: CONVERSATION_ID },
          cleanup: () => {
            lifecycle.push("prepared:cleanup");
            return Promise.resolve();
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(
      result.details,
      "Canonical live eval message persistence did not return a message id",
    );
    assertEquals(lifecycle, ["prepared:cleanup"]);
    assertEquals(requests.map((request) => [request.method, request.url]), [
      ["POST", conversationMessagesUrl(CONVERSATION_ID)],
    ]);
  });

  it("rejects prepared custom bodies on canonical conversation admission", async () => {
    const requests: CapturedRequest[] = [];
    const support = createSupport((input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      });
      return Response.json({ id: RUN_ID, status: "running" }, { status: 202 });
    });

    const result = await support.runEval({
      id: "canonical-custom-body",
      label: "Canonical custom body",
      prompt: "Run",
      prepare: () =>
        Promise.resolve({
          metadata: {
            conversationId: CONVERSATION_ID,
            customBody: JSON.stringify({ runId: "legacy-direct" }),
          },
        }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "metadata.customBody");
    assertEquals(requests, []);
  });

  it("treats a child terminal without a root terminal as unfinished and cancels", async () => {
    const requests: CapturedRequest[] = [];
    const support = createSupport((input, init) => {
      const request = {
        url: String(input),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: parseBody(init),
      };
      requests.push(request);
      if (request.url === conversationMessagesUrl(CONVERSATION_ID)) {
        return persistedUserMessageResponse();
      }
      if (request.url === "https://api.example.test/runs") {
        return Response.json({ id: RUN_ID, status: "running" }, { status: 202 });
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/stream`) {
        return canonicalStreamResponse([
          canonicalFrame(1, "RUN_STARTED", { runId: RUN_ID }),
          canonicalFrame(2, "CHILD_RUN_STATUS_CHANGED", {
            childRunId: "child-run",
            status: "completed",
            toolCallId: "tool-1",
          }),
        ]);
      }
      if (request.url === `https://api.example.test/runs/${RUN_ID}/cancel`) {
        return Response.json({ id: RUN_ID, status: "cancelled" }, { status: 202 });
      }
      throw new Error(`unexpected request ${request.url}`);
    });

    let verifierCalls = 0;
    const result = await support.runEval({
      id: "canonical-child-terminal",
      label: "Canonical child terminal",
      prompt: "Run",
      prepare: () => Promise.resolve({ metadata: { conversationId: CONVERSATION_ID } }),
      verify: () => {
        verifierCalls++;
        return null;
      },
    }, "framework");

    assertEquals(result.status, "fail");
    assertEquals(verifierCalls, 0);
    assertStringIncludes(
      result.details,
      "Canonical live eval stream ended before terminal RUN_FINISHED/RUN_ERROR",
    );
    assertEquals(requests.map((request) => [request.method, request.url]), [
      ["POST", conversationMessagesUrl(CONVERSATION_ID)],
      ["POST", "https://api.example.test/runs"],
      ["GET", `https://api.example.test/runs/${RUN_ID}/stream`],
      ["POST", `https://api.example.test/runs/${RUN_ID}/cancel`],
    ]);
  });
});
