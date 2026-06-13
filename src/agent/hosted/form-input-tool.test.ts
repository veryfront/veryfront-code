import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import { createHostedFormInputTool, findSubmittedFormInputResult } from "../index.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const INPUT_REQUEST_ID = "11111111-1111-4111-a111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const RUN_ID = "run_1";
const TOOL_CALL_ID = "tool-call-1";
const CREATED_AT = "2026-04-04T00:00:00.000Z";
const EXPIRES_AT = "2026-04-04T00:05:00.000Z";
const originalFetch = globalThis.fetch;

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createLatestResponse(values: Record<string, unknown>) {
  return {
    id: "33333333-3333-4333-a333-333333333333",
    input_request_id: INPUT_REQUEST_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    actor_type: "human",
    actor_id: "user-1",
    values,
    created_at: CREATED_AT,
  };
}

function createInputRequestRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: INPUT_REQUEST_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    tool_call_id: TOOL_CALL_ID,
    kind: "form",
    status: "open",
    requested_responder_type: "human",
    title: "Choose one",
    description: "Pick",
    fields: [
      {
        type: "confirm",
        name: "confirmed",
        label: "Confirm?",
        required: false,
        secret: false,
        confirmLabel: "Yes",
        denyLabel: "No",
      },
    ],
    recommendations: null,
    metadata: null,
    created_at: CREATED_AT,
    expires_at: EXPIRES_AT,
    submitted_at: null,
    cancelled_at: null,
    expired_at: null,
    latest_response: null,
    ...overrides,
  };
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    authToken: AUTH_TOKEN,
    conversationId: CONVERSATION_ID,
    parentRunId: RUN_ID,
    ...overrides,
  };
}

function createExecuteInput(fields: Array<Record<string, unknown>>) {
  return {
    title: "Choose one",
    description: "Pick",
    fields,
  };
}

function stubFetchSequence(responses: Response[]) {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    return response;
  };
  return calls;
}

describe("agent/hosted-form-input-tool", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates and polls a durable input request until it is submitted", async () => {
    const calls = stubFetchSequence([
      jsonResponse(createInputRequestRecord(), 201),
      jsonResponse(
        createInputRequestRecord({
          status: "submitted",
          submitted_at: "2026-04-04T00:00:30.000Z",
          latest_response: createLatestResponse({ confirmed: true }),
        }),
        200,
      ),
    ]);

    const formInputTool = createHostedFormInputTool(createContext(), API_URL);
    const result = await formInputTool.execute(
      createExecuteInput([{ type: "confirm", name: "confirmed", label: "Confirm?" }]),
      { toolCallId: TOOL_CALL_ID },
    );

    assertEquals(result, {
      submitted: true,
      values: { confirmed: true },
      inputRequestId: INPUT_REQUEST_ID,
    });
    assertEquals(
      String(calls[0]?.input),
      `${API_URL}/conversations/${CONVERSATION_ID}/input-requests`,
    );
    assertEquals(calls[0]?.init?.method, "POST");
    assertEquals(JSON.parse(String(calls[0]?.init?.body)).run_id, RUN_ID);
    assertEquals(JSON.parse(String(calls[0]?.init?.body)).tool_call_id, TOOL_CALL_ID);
    assertEquals(
      String(calls[1]?.input),
      `${API_URL}/conversations/${CONVERSATION_ID}/input-requests/${INPUT_REQUEST_ID}`,
    );
    assertEquals(calls[1]?.init?.method, "GET");
  });

  it("reuses a submitted form result instead of opening another form in the same run", async () => {
    const calls = stubFetchSequence([
      jsonResponse(createInputRequestRecord(), 201),
      jsonResponse(
        createInputRequestRecord({
          status: "submitted",
          submitted_at: "2026-04-04T00:00:30.000Z",
          latest_response: createLatestResponse({ topic: "Support FAQ assistant" }),
        }),
        200,
      ),
    ]);

    const context = createContext();
    const formInputTool = createHostedFormInputTool(context, API_URL);
    const firstResult = await formInputTool.execute(
      createExecuteInput([{ type: "textarea", name: "topic", label: "Topic" }]),
      { toolCallId: TOOL_CALL_ID },
    );
    const secondResult = await formInputTool.execute(
      createExecuteInput([{ type: "textarea", name: "topic", label: "Topic" }]),
      { toolCallId: "tool-call-2" },
    );

    assertEquals(firstResult, {
      submitted: true,
      values: { topic: "Support FAQ assistant" },
      inputRequestId: INPUT_REQUEST_ID,
    });
    assertEquals(secondResult, {
      submitted: true,
      values: { topic: "Support FAQ assistant" },
      inputRequestId: INPUT_REQUEST_ID,
      reused: true,
      reason: "A submitted form_input result already exists for this run.",
    });
    assertEquals(calls.length, 2);
  });

  it("finds a submitted form_input result from persisted UI tool parts", () => {
    const result = findSubmittedFormInputResult([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolCallId: TOOL_CALL_ID,
          toolName: "form_input",
          state: "output-available",
          input: { title: "Plan intake" },
          output: {
            submitted: true,
            values: { idea: "Build a support assistant" },
            inputRequestId: INPUT_REQUEST_ID,
          },
        }],
      },
    ]);

    assertEquals(result, {
      values: { idea: "Build a support assistant" },
      inputRequestId: INPUT_REQUEST_ID,
    });
  });

  it("publishes a lifecycle data event for the created durable input request", async () => {
    const publishedEvents: unknown[] = [];
    stubFetchSequence([
      jsonResponse(
        createInputRequestRecord({ status: "cancelled", cancelled_at: CREATED_AT }),
        201,
      ),
      jsonResponse(
        createInputRequestRecord({ status: "cancelled", cancelled_at: CREATED_AT }),
        200,
      ),
    ]);

    const formInputTool = createHostedFormInputTool(createContext(), API_URL);
    const execContext: ToolExecutionContext = {
      toolCallId: TOOL_CALL_ID,
      publishDataEvent: (event) => {
        publishedEvents.push(event);
      },
    };

    await formInputTool.execute(
      createExecuteInput([{ type: "confirm", name: "confirmed", label: "Confirm?" }]),
      execContext,
    );

    assertEquals(publishedEvents, [
      {
        type: "veryfront.input_request.lifecycle",
        data: {
          action: "created",
          inputRequest: {
            id: INPUT_REQUEST_ID,
            conversationId: CONVERSATION_ID,
            runId: RUN_ID,
            toolCallId: TOOL_CALL_ID,
            kind: "form",
            status: "cancelled",
            requestedResponderType: "human",
            title: "Choose one",
            description: "Pick",
            fields: [
              {
                type: "confirm",
                name: "confirmed",
                label: "Confirm?",
                required: false,
                secret: false,
                confirmLabel: "Yes",
                denyLabel: "No",
              },
            ],
            recommendations: null,
            metadata: null,
            createdAt: CREATED_AT,
            expiresAt: EXPIRES_AT,
            submittedAt: null,
            cancelledAt: CREATED_AT,
            expiredAt: null,
            latestResponse: null,
          },
        },
        name: "veryfront.input_request.lifecycle",
        value: {
          action: "created",
          inputRequest: {
            id: INPUT_REQUEST_ID,
            conversationId: CONVERSATION_ID,
            runId: RUN_ID,
            toolCallId: TOOL_CALL_ID,
            kind: "form",
            status: "cancelled",
            requestedResponderType: "human",
            title: "Choose one",
            description: "Pick",
            fields: [
              {
                type: "confirm",
                name: "confirmed",
                label: "Confirm?",
                required: false,
                secret: false,
                confirmLabel: "Yes",
                denyLabel: "No",
              },
            ],
            recommendations: null,
            metadata: null,
            createdAt: CREATED_AT,
            expiresAt: EXPIRES_AT,
            submittedAt: null,
            cancelledAt: CREATED_AT,
            expiredAt: null,
            latestResponse: null,
          },
        },
      },
    ]);
  });

  it("marks exact artifact path submissions as conversation-first", async () => {
    stubFetchSequence([
      jsonResponse(
        createInputRequestRecord({ fields: [{ type: "textarea", name: "idea", label: "Idea" }] }),
        201,
      ),
      jsonResponse(
        createInputRequestRecord({
          status: "submitted",
          fields: [{ type: "textarea", name: "idea", label: "Idea" }],
          submitted_at: "2026-04-04T00:00:30.000Z",
          latest_response: createLatestResponse({
            idea: "Write the final plan to /plans/budget-planning.md",
          }),
        }),
        200,
      ),
    ]);

    const context = createContext();
    const formInputTool = createHostedFormInputTool(context, API_URL);

    await formInputTool.execute(
      createExecuteInput([{ type: "textarea", name: "idea", label: "Idea" }]),
      { toolCallId: TOOL_CALL_ID },
    );

    assertEquals(context.slashCommandArtifactPathSeen, true);
  });

  it("surfaces durable input polling failures", async () => {
    stubFetchSequence([
      jsonResponse(createInputRequestRecord(), 201),
      new Response("poll failed", { status: 500 }),
    ]);

    const formInputTool = createHostedFormInputTool(createContext(), API_URL);

    await assertRejects(
      () =>
        formInputTool.execute(
          createExecuteInput([{ type: "confirm", name: "confirmed", label: "Confirm?" }]),
          { toolCallId: TOOL_CALL_ID },
        ),
      Error,
      "poll failed",
    );
  });
});
