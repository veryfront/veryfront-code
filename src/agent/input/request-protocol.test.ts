import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildInputRequestLifecycleDataEvent,
  createInputRequest,
  getCreateInputRequestResponseSchema,
  getInputRequest,
} from "../index.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const RUN_ID = "run_1";
const TOOL_CALL_ID = "tool-call-1";
const INPUT_REQUEST_ID = "11111111-1111-4111-a111-111111111111";
const CREATED_AT = "2026-04-04T00:00:00.000Z";
const EXPIRES_AT = "2026-04-04T00:05:00.000Z";
const originalFetch = globalThis.fetch;

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

function stubFetchWithRecorder(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
) {
  globalThis.fetch = async (input, init) => handler(input, init);
}

describe("agent/input-request-protocol", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates durable form input requests through the conversation endpoint", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    stubFetchWithRecorder((input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse(createInputRequestRecord({ metadata: { submitLabel: "Send" } }), 201);
    });

    const result = await createInputRequest({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      // Cast through `unknown` since the contract DSL types optional object
      // fields with required keys (value `T | undefined`); the actual schema
      // accepts the looser literal here at runtime.
      form: {
        title: "Choose one",
        description: "Pick",
        submitLabel: "Send",
        fields: [{ type: "confirm", name: "confirmed", label: "Confirm?" }],
      } as unknown as Parameters<typeof createInputRequest>[0]["form"],
      expiresAt: EXPIRES_AT,
    });

    assertEquals(result.id, INPUT_REQUEST_ID);
    assertEquals(result.toolCallId, TOOL_CALL_ID);
    assertEquals(capturedUrl, `${API_URL}/conversations/${CONVERSATION_ID}/input-requests`);
    assertEquals(capturedInit?.method, "POST");
    assertEquals(capturedInit?.headers, {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    });
    assertEquals(JSON.parse(String(capturedInit?.body)), {
      run_id: RUN_ID,
      tool_call_id: TOOL_CALL_ID,
      kind: "form",
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
      expires_at: EXPIRES_AT,
      metadata: { submitLabel: "Send" },
    });
  });

  it("fetches and normalizes durable input request snapshots", async () => {
    stubFetchWithRecorder((input, init) => {
      assertEquals(
        String(input),
        `${API_URL}/conversations/${CONVERSATION_ID}/input-requests/${INPUT_REQUEST_ID}`,
      );
      assertEquals(init?.method, "GET");
      return jsonResponse(
        createInputRequestRecord({
          status: "submitted",
          latest_response: createLatestResponse({ confirmed: true }),
        }),
        200,
      );
    });

    const result = await getInputRequest({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      inputRequestId: INPUT_REQUEST_ID,
    });

    assertEquals(result.status, "submitted");
    assertEquals(result.latestResponse?.values, { confirmed: true });
  });

  it("builds input request lifecycle data events", () => {
    const inputRequest = getCreateInputRequestResponseSchema().parse(createInputRequestRecord());

    assertEquals(buildInputRequestLifecycleDataEvent({ action: "created", inputRequest }), {
      type: "veryfront.input_request.lifecycle",
      data: { action: "created", inputRequest },
      name: "veryfront.input_request.lifecycle",
      value: { action: "created", inputRequest },
    });
  });

  it("surfaces API failures with response text", async () => {
    stubFetchWithRecorder(() => new Response("poll failed", { status: 500 }));

    await assertRejects(
      () =>
        getInputRequest({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          inputRequestId: INPUT_REQUEST_ID,
        }),
      Error,
      "poll failed",
    );
  });
});
