import { computeHash } from "#veryfront/utils/hash-utils.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  buildInputRequestLifecycleDataEvent,
  createInputRequest,
  getCreateInputRequestResponseSchema,
  getFormInputToolInputSchema,
  getInputRequest,
} from "./request-protocol.ts";
import {
  createAgUiEncoderState,
  mapRuntimeStreamEventToAgUiEvents,
} from "#veryfront/agent/ag-ui/encoder.ts";
import { ConversationRunEventEncoder } from "#veryfront/agent/conversation/run-events.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const RUN_ID = "44444444-4444-4444-a444-444444444444";
const TOOL_CALL_ID = "tool-call-1";
const INPUT_REQUEST_ID = "11111111-1111-4111-a111-111111111111";
const CREATED_AT = "2026-04-04T00:00:00.000Z";
const EXPIRES_AT = "2026-04-04T00:05:00.000Z";

function jsonResponse(body: unknown, status: number): Response {
  const record = body as Record<string, unknown>;
  if (record?.fields) {
    const response = record.latest_response as Record<string, unknown> | null;
    body = {
      ...record,
      input_request_id: record.id,
      resolved_at: record.submitted_at ?? record.cancelled_at ?? record.expired_at,
      response: response
        ? {
          ...response,
          response_id: response.id,
          actor: { type: response.actor_type, id: response.actor_id },
        }
        : null,
    };
  }
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
  installMockFetch(async (input, init) => handler(input, init));
}

describe("agent/input-request-protocol", () => {
  afterEach(() => {
    restoreMockFetch();
  });

  const createWithField = (field: Record<string, unknown>) =>
    createInputRequest({
      authToken: AUTH_TOKEN,
      apiUrl: API_URL,
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      expiresAt: EXPIRES_AT,
      form: getFormInputToolInputSchema().parse({
        title: "Input",
        fields: [{ name: "answer", label: "Answer", ...field }],
      }),
    });

  for (const defaultValue of ["", " ", "not-a-number", "NaN", "Infinity", "-Infinity", "1e309"]) {
    it(`rejects invalid numeric default ${JSON.stringify(defaultValue)} before HTTP`, async () => {
      let requests = 0;
      stubFetchWithRecorder(() => {
        requests++;
        return jsonResponse(createInputRequestRecord(), 201);
      });
      const error = await assertRejects(() => createWithField({ type: "number", defaultValue }));
      if (!(error instanceof Error)) throw new Error("Expected an input validation error");
      assertEquals(error.message.includes('field "answer"'), true);
      assertEquals(error.message.includes("defaultValue"), true);
      assertEquals(requests, 0);
    });
  }

  for (
    const field of [
      { type: "text", placeholder: "Example" },
      { type: "text", pattern: "[a-z]+" },
      { type: "text", minLength: 1 },
      { type: "text", maxLength: 20 },
      { type: "number", min: 1 },
      { type: "number", max: 10 },
      { type: "textarea", rows: 8 },
      { type: "confirm", confirmLabel: "Approve" },
      { type: "confirm", denyLabel: "Reject" },
    ]
  ) {
    it(`rejects unsupported canonical field options ${JSON.stringify(field)} before HTTP`, async () => {
      let requests = 0;
      stubFetchWithRecorder(() => {
        requests++;
        return jsonResponse(createInputRequestRecord(), 201);
      });
      const error = await assertRejects(() => createWithField(field));
      if (!(error instanceof Error)) throw new Error("Expected an input validation error");
      assertEquals(error.message.includes('field "answer"'), true);
      const property = Object.keys(field).find((key) => key !== "type")!;
      assertEquals(error.message.includes(`"${property}"`), true);
      assertEquals(requests, 0);
    });
  }

  for (const [defaultValue, expected] of [["0", 0], [" 2.5 ", 2.5], ["1e3", 1000]] as const) {
    it(`preserves finite numeric default ${defaultValue}`, async () => {
      let body: Record<string, unknown> = {};
      stubFetchWithRecorder((_input, init) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse(createInputRequestRecord(), 201);
      });
      await createWithField({ type: "number", defaultValue });
      assertEquals(body.fields, [{
        name: "answer",
        label: "Answer",
        required: false,
        type: "number",
        default: expected,
      }]);
    });
  }

  it("retains supported choice properties and accepts injected textarea/confirm defaults", async () => {
    const bodies: { fields: unknown[] }[] = [];
    stubFetchWithRecorder((_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(createInputRequestRecord(), 201);
    });
    const options = [{ value: "one", label: "One", description: "First", recommended: true }];
    await createWithField({
      type: "select",
      required: true,
      description: "Pick",
      options,
      defaultValue: "one",
    });
    await createWithField({ type: "textarea" });
    await createWithField({ type: "confirm" });
    assertEquals(bodies[0]?.fields, [{
      name: "answer",
      label: "Answer",
      description: "Pick",
      required: true,
      type: "select",
      default: "one",
      options,
    }]);
    assertEquals(bodies[1]?.fields, [{
      name: "answer",
      label: "Answer",
      required: false,
      type: "textarea",
    }]);
    assertEquals(bodies[2]?.fields, [{
      name: "answer",
      label: "Answer",
      required: false,
      type: "confirm",
    }]);
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
    assertEquals(capturedUrl, `${API_URL}/runs/${RUN_ID}/input-requests`);
    assertEquals(capturedInit?.method, "POST");
    assertEquals(capturedInit?.headers, {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `runtime-input:${await computeHash(`${RUN_ID}:${TOOL_CALL_ID}`)}`,
    });
    assertEquals(JSON.parse(String(capturedInit?.body)), {
      tool_call_id: TOOL_CALL_ID,
      requested_responder_type: "human",
      title: "Choose one",
      description: "Pick",
      fields: [
        {
          type: "confirm",
          name: "confirmed",
          label: "Confirm?",
          required: false,
        },
      ],
      expires_at: EXPIRES_AT,
      metadata: { submitLabel: "Send" },
    });
  });

  for (const reason of ["not_recorded", "identity_removed"] as const) {
    it(`preserves unavailable input response provenance (${reason}) without inventing an actor`, async () => {
      const actor = {
        type: "unavailable",
        reason,
        ...(reason === "identity_removed"
          ? { legacy_role: "human", legacy_id: "removed-user" }
          : {}),
      };
      stubFetchWithRecorder(() =>
        Response.json({
          ...createInputRequestRecord({ status: "submitted" }),
          input_request_id: INPUT_REQUEST_ID,
          resolved_at: CREATED_AT,
          response: {
            response_id: "33333333-3333-4333-a333-333333333333",
            actor,
            values: { confirmed: true },
            redacted_fields: ["password"],
            created_at: CREATED_AT,
          },
        })
      );
      const result = await getInputRequest({
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        conversationId: CONVERSATION_ID,
        inputRequestId: INPUT_REQUEST_ID,
      });
      assertEquals(result.latestResponse?.actorType, "unavailable");
      assertEquals(result.latestResponse?.actorId, null);
      assertEquals(result.latestResponse?.unavailableActor, actor);
      assertEquals(result.latestResponse?.values, { confirmed: true });
      assertEquals(result.latestResponse?.redactedFields, ["password"]);
    });
  }

  for (
    const actor of [{ type: "user", id: null }, { type: "unavailable" }, {
      type: "unavailable",
      reason: "unknown",
    }]
  ) {
    it(`rejects invalid response actor provenance ${JSON.stringify(actor)}`, async () => {
      stubFetchWithRecorder(() =>
        Response.json({
          ...createInputRequestRecord({ status: "submitted" }),
          input_request_id: INPUT_REQUEST_ID,
          resolved_at: CREATED_AT,
          response: {
            response_id: "33333333-3333-4333-a333-333333333333",
            actor,
            values: {},
            created_at: CREATED_AT,
          },
        })
      );
      await assertRejects(() =>
        getInputRequest({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          inputRequestId: INPUT_REQUEST_ID,
        })
      );
    });
  }

  it("fetches and normalizes durable input request snapshots", async () => {
    stubFetchWithRecorder((input, init) => {
      assertEquals(
        String(input),
        `${API_URL}/input-requests/${INPUT_REQUEST_ID}`,
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

    assertEquals(result, {
      id: INPUT_REQUEST_ID,
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      kind: "form",
      status: "submitted",
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
      cancelledAt: null,
      expiredAt: null,
      latestResponse: {
        id: "33333333-3333-4333-a333-333333333333",
        inputRequestId: INPUT_REQUEST_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        actorType: "human",
        actorId: "user-1",
        redactedFields: undefined,
        values: { confirmed: true },
        createdAt: CREATED_AT,
      },
    }, "every snake_case snapshot key must normalize to its camelCase counterpart");
  });

  it("normalizes omitted optional snapshot keys to null", () => {
    const record = createInputRequestRecord();
    for (
      const key of [
        "recommendations",
        "metadata",
        "submitted_at",
        "cancelled_at",
        "expired_at",
        "latest_response",
      ]
    ) {
      delete (record as Record<string, unknown>)[key];
    }

    assertEquals(
      getCreateInputRequestResponseSchema().parse(record),
      {
        id: INPUT_REQUEST_ID,
        conversationId: CONVERSATION_ID,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        kind: "form",
        status: "open",
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
        cancelledAt: null,
        expiredAt: null,
        latestResponse: null,
      },
      "absent optional REST keys must normalize to null, not undefined, per InputRequestRestOutput",
    );
  });

  it("surfaces create failures with response text", async () => {
    stubFetchWithRecorder(() => new Response("create failed", { status: 500 }));

    await assertRejects(
      () =>
        createInputRequest({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          toolCallId: TOOL_CALL_ID,
          form: {
            title: "Choose one",
            description: "Pick",
            submitLabel: "Send",
            fields: [{ type: "confirm", name: "confirmed", label: "Confirm?" }],
          } as unknown as Parameters<typeof createInputRequest>[0]["form"],
          expiresAt: EXPIRES_AT,
        }),
      Error,
      "create failed",
      "a failed create must surface the server explanation, not a schema parse error",
    );
  });

  it("falls back to a status-coded detail when a failed create has no body", async () => {
    stubFetchWithRecorder(() => new Response("", { status: 500 }));

    await assertRejects(
      () =>
        createInputRequest({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          toolCallId: TOOL_CALL_ID,
          form: {
            title: "Choose one",
            description: "Pick",
            submitLabel: "Send",
            fields: [{ type: "confirm", name: "confirmed", label: "Confirm?" }],
          } as unknown as Parameters<typeof createInputRequest>[0]["form"],
          expiresAt: EXPIRES_AT,
        }),
      Error,
      "Failed to create durable input request (HTTP 500)",
      "an empty failure body must fall back to a status-coded detail",
    );
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

  it("reaches both encoders as a native input request event", () => {
    const inputRequest = getCreateInputRequestResponseSchema().parse(createInputRequestRecord());
    const created = buildInputRequestLifecycleDataEvent({ action: "created", inputRequest });
    const updated = buildInputRequestLifecycleDataEvent({ action: "updated", inputRequest });

    // The bridge serializes a named data event as `data-<name>` carrying its
    // value, so pin the name first and then drive that chunk through both
    // encoders. This is the whole path from the tool to the wire.
    assertEquals(created.name, "veryfront.input_request.lifecycle");
    assertEquals(updated.name, "veryfront.input_request.lifecycle");
    const createdChunk = {
      type: "data-veryfront.input_request.lifecycle" as const,
      data: created.value,
    };
    const updatedChunk = {
      type: "data-veryfront.input_request.lifecycle" as const,
      data: updated.value,
    };

    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, createdChunk),
      [{ event: "InputRequestCreated", payload: { inputRequest } }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, updatedChunk),
      [{ event: "InputRequestUpdated", payload: { inputRequest } }],
    );

    const encoder = new ConversationRunEventEncoder();
    assertEquals(encoder.encode(createdChunk), [
      { type: "INPUT_REQUEST_CREATED", inputRequest },
    ]);
    assertEquals(encoder.encode(updatedChunk), [
      { type: "INPUT_REQUEST_UPDATED", inputRequest },
    ]);
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
