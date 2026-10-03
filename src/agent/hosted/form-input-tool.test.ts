import { getFormInputToolInputSchema } from "../input/request-protocol.ts";
import {
  createHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import {
  createHostedFormInputTool,
  findSubmittedFormInputResult,
  type HostedFormInputToolContext,
} from "./form-input-tool.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const INPUT_REQUEST_ID = "11111111-1111-4111-a111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const RUN_ID = "44444444-4444-4444-a444-444444444444";
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
    response_id: "33333333-3333-4333-a333-333333333333",
    actor: { type: "user", id: "user-1" },
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
    input_request_id: INPUT_REQUEST_ID,
    project_id: CONVERSATION_ID,
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
    response: overrides.latest_response ?? null,
    resolved_at: overrides.submitted_at ?? overrides.cancelled_at ?? overrides.expired_at ??
      undefined,
    ...overrides,
  };
}

function createContext(overrides: Record<string, unknown> = {}): HostedFormInputToolContext {
  return {
    authToken: AUTH_TOKEN,
    conversationId: CONVERSATION_ID,
    parentRunId: RUN_ID,
    ...overrides,
  };
}

function createExecuteInput(fields: Array<Record<string, unknown>>) {
  return getFormInputToolInputSchema().parse({ title: "Choose one", description: "Pick", fields });
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

function createSubmittedFormInputPart(inputRequestId: string, values: Record<string, unknown>) {
  return {
    type: "dynamic-tool" as const,
    toolCallId: `tool-call-${inputRequestId}`,
    toolName: "form_input",
    state: "output-available" as const,
    input: { title: "Plan intake" },
    output: { submitted: true, values, inputRequestId },
  };
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
      `${API_URL}/runs/${RUN_ID}/input-requests`,
    );
    assertEquals(calls[0]?.init?.method, "POST");
    assertEquals(JSON.parse(String(calls[0]?.init?.body)).run_id, undefined);
    assertEquals(JSON.parse(String(calls[0]?.init?.body)).tool_call_id, TOOL_CALL_ID);
    assertEquals(
      String(calls[1]?.input),
      `${API_URL}/input-requests/${INPUT_REQUEST_ID}`,
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
      reason:
        "A submitted form_input result already exists for this run. Use these values as final input, do not call form_input again, and continue to the requested output.",
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

  it("ignores submitted form_input results from before the latest user message", () => {
    const result = findSubmittedFormInputResult([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          createSubmittedFormInputPart(INPUT_REQUEST_ID, { idea: "Build a support assistant" }),
        ],
      },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Next turn" }] },
      { id: "assistant-3", role: "assistant", parts: [{ type: "text", text: "Working" }] },
    ]);

    assertEquals(
      result,
      undefined,
      "a result persisted before the latest user message must not be reused",
    );
  });

  it("returns the latest submitted form_input result after the latest user message", () => {
    const result = findSubmittedFormInputResult([
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Start" }] },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [createSubmittedFormInputPart("req-1", { idea: "first" })],
      },
      {
        id: "assistant-3",
        role: "assistant",
        parts: [createSubmittedFormInputPart("req-2", { idea: "second" })],
      },
    ]);

    assertEquals(
      result,
      { values: { idea: "second" }, inputRequestId: "req-2" },
      "the later submitted result must win",
    );
  });

  it("rejects execution without a durable conversation or run context", async () => {
    const calls = stubFetchSequence([]);
    const executeInput = createExecuteInput([
      { type: "confirm", name: "confirmed", label: "Confirm?" },
    ]);

    await assertRejects(
      () =>
        createHostedFormInputTool({ authToken: AUTH_TOKEN }, API_URL).execute(
          executeInput,
          { toolCallId: TOOL_CALL_ID },
        ),
      Error,
      "form_input requires a durable conversation context",
    );
    await assertRejects(
      () =>
        createHostedFormInputTool(
          { authToken: AUTH_TOKEN, conversationId: CONVERSATION_ID },
          API_URL,
        ).execute(executeInput, { toolCallId: TOOL_CALL_ID }),
      Error,
      "form_input requires a durable run context",
    );
    assertEquals(
      calls.length,
      0,
      "missing durable identifiers must fail before any API request",
    );
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

it("hosted form hands off to durable replay without reading or publishing secret values", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error("Public polling must not resolve private form results");
  };
  try {
    const controller = new AbortController();
    const form = createHostedFormInputTool(createContext(), API_URL, { controlPlaneReplay: true });
    const waiting = form.execute({
      title: "Secret",
      submitLabel: "Submit",
      fields: [{
        name: "password",
        label: "Password",
        type: "password",
        required: false,
        secret: true,
      }],
    }, { toolCallId: "secret-tool", abortSignal: controller.signal });
    let settled = false;
    const result = Promise.resolve(waiting).then(() => {
      settled = true;
      return "resolved";
    }, (error) => {
      settled = true;
      return error;
    });
    await Promise.resolve();
    assertEquals(settled, false);
    await assertRejects(
      () =>
        Promise.resolve(
          form.execute({
            title: "Second",
            submitLabel: "Submit",
            fields: [{
              name: "value",
              label: "Value",
              type: "text",
              required: false,
              secret: false,
            }],
          }, { toolCallId: "second-tool", abortSignal: controller.signal }),
        ),
      Error,
      "Only one form_input",
    );
    const suspended = new DOMException("Owning run parked", "AbortError");
    controller.abort(suspended);
    assertEquals(await result, suspended);
    assertEquals(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("rejects secret polling forms before creating an input request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error("No request expected");
  };
  try {
    const form = createHostedFormInputTool(createContext(), API_URL);
    await assertRejects(
      () =>
        Promise.resolve(
          form.execute({
            title: "Secret",
            submitLabel: "Submit",
            fields: [{
              name: "password",
              label: "Password",
              type: "password",
              required: false,
              secret: true,
            }],
          }, { toolCallId: "secret" }),
        ),
      Error,
      "Secret forms require hosted durable replay",
    );
    assertEquals(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("rejects attached child forms before allocating or waiting for an input request", async () => {
  const capability = createHostedRunEventWriterCapability({
    apiUrl: API_URL,
    runId: RUN_ID,
    runEventAppendToken: "child-writer",
    inheritedExecution: true,
  });
  const form = await runWithHostedRunEventWriterCapability(
    capability,
    () => createHostedFormInputTool(createContext(), API_URL, { controlPlaneReplay: true }),
  );
  await assertRejects(
    () =>
      Promise.resolve(
        form.execute(
          {
            title: "Input",
            submitLabel: "Submit",
            fields: [{
              name: "value",
              label: "Value",
              type: "text",
              required: false,
              secret: false,
            }],
          },
          { toolCallId: "child-form" },
        ),
      ),
    Error,
    "Forms are not supported inside attached local child callbacks",
  );
});

it("reuses a privately replayed form result without parking the resumed turn again", async () => {
  const context = createContext({
    submittedFormInputResult: {
      values: { password: "private-replayed" },
      inputRequestId: INPUT_REQUEST_ID,
    },
  });
  const form = createHostedFormInputTool(context, API_URL, { controlPlaneReplay: true });
  const result = await form.execute(
    getFormInputToolInputSchema().parse({
      title: "Secret",
      fields: [{ name: "password", label: "Password", type: "password" }],
    }),
    { toolCallId: "repeated-form" },
  );
  assertEquals((result as { reused: boolean }).reused, true);
  assertEquals((result as { values: unknown }).values, { password: "private-replayed" });
});
