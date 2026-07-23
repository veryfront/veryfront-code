import { defineSchema } from "#veryfront/schemas/index.ts";
import { NETWORK_ERROR } from "#veryfront/errors";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import {
  getHumanInputFieldSchema,
  type HumanInputField,
  type HumanInputRequest,
  humanInputRequestBaseFields,
} from "./human-input.ts";

/** Form definition accepted by the durable form-input tool. */
export type FormInputToolInput = Omit<HumanInputRequest, "metadata">;

/** Scalar values accepted in one durable input response. */
export type InputResponseValues = Record<string, string | boolean | number | null>;

/** REST request body used to create a durable input request. */
export interface CreateInputRequestRequest {
  /** Parent run identifier. */
  run_id: string;
  /** Tool call waiting for the response. */
  tool_call_id: string;
  /** Durable input request kind. */
  kind: "form";
  /** Responder category required by the request. */
  requested_responder_type: "human";
  /** Form title. */
  title: string;
  /** Optional form description. */
  description?: string;
  /** Form fields displayed to the responder. */
  fields: HumanInputField[];
  /** ISO timestamp when the request expires. */
  expires_at: string;
  /** Optional request metadata. */
  metadata?: Record<string, unknown>;
}

// `formInputToolInputSchema` is `HumanInputRequestSchema` minus its `metadata`
// field. The contract DSL doesn't expose `.omit(...)`, so we share the base
// shape via `humanInputRequestBaseFields(v)` and construct two object schemas.
/** Zod schema for get form input tool input. */
export const getFormInputToolInputSchema: () => Schema<FormInputToolInput> = defineSchema((v) =>
  v.object(humanInputRequestBaseFields(v))
);

/** Zod schema for get input response values. */
export const getInputResponseValuesSchema: () => Schema<InputResponseValues> = defineSchema((v) =>
  v.record(
    v.string(),
    v.union([v.string(), v.boolean(), v.number(), v.null()]),
  )
);

/** Zod schema for get create input request request. */
export const getCreateInputRequestRequestSchema: () => Schema<CreateInputRequestRequest> =
  defineSchema((v) =>
    v.object({
      run_id: v.string().min(1),
      tool_call_id: v.string().min(1),
      kind: v.literal("form"),
      requested_responder_type: v.literal("human"),
      title: v.string(),
      description: v.string().optional(),
      fields: v.array(getHumanInputFieldSchema()).min(1),
      // Note: original used `.datetime({ offset: true })`; the contract DSL only
      // exposes `.datetime()` without the offset option. Validation is slightly
      // looser (offset is no longer enforced); acceptable for migration.
      expires_at: v.string().datetime(),
      metadata: v.record(v.string(), v.unknown()).optional(),
    })
  );

// Hand-written transform output type. The contract DSL erases the parameter
// type through `.transform()` (the adapter casts the callback parameter to
// `never`), so we need an explicit annotation to keep the downstream type
// inference flowing.
/** Normalized durable input response returned by the REST API. */
export interface InputResponseRestOutput {
  /** Input response identifier. */
  id: string;
  /** Input request identifier. */
  inputRequestId: string;
  /** Conversation identifier. */
  conversationId: string;
  /** Run identifier. */
  runId: string;
  /** Responder category. */
  actorType: string;
  /** Responder identifier. */
  actorId: string;
  /** Submitted field values. */
  values: Record<string, string | number | boolean | null>;
  /** ISO timestamp when the response was created. */
  createdAt: string;
}

/** Zod schema for get input response rest. */
export const getInputResponseRestSchema: () => Schema<InputResponseRestOutput> = defineSchema((v) =>
  v
    .object({
      id: v.string().uuid(),
      input_request_id: v.string().uuid(),
      conversation_id: v.string().uuid(),
      run_id: v.string().min(1),
      actor_type: v.string(),
      actor_id: v.string(),
      values: getInputResponseValuesSchema(),
      created_at: v.string(),
    })
    .passthrough()
    .transform((value): InputResponseRestOutput => {
      const v2 = value as Record<string, unknown>;
      return {
        id: v2.id as string,
        inputRequestId: v2.input_request_id as string,
        conversationId: v2.conversation_id as string,
        runId: v2.run_id as string,
        actorType: v2.actor_type as string,
        actorId: v2.actor_id as string,
        values: v2.values as Record<string, string | number | boolean | null>,
        createdAt: v2.created_at as string,
      };
    })
);

// Hand-written transform output type — see InputResponseRestOutput note.
/** Normalized durable input request returned by the REST API. */
export interface InputRequestRestOutput {
  /** Input request identifier. */
  id: string;
  /** Conversation identifier. */
  conversationId: string;
  /** Run identifier. */
  runId: string;
  /** Tool call waiting for this input. */
  toolCallId: string;
  /** Durable input request kind. */
  kind: "form";
  /** Current input request status. */
  status: "open" | "submitted" | "cancelled" | "expired";
  /** Responder category requested by the run. */
  requestedResponderType: "human" | "agent" | "system";
  /** Form title. */
  title: string;
  /** Optional form description returned as null when absent. */
  description: string | null;
  /** Form field definitions. */
  fields: unknown[];
  /** Optional responder recommendations. */
  recommendations: Record<string, unknown> | null;
  /** Optional request metadata. */
  metadata: Record<string, unknown> | null;
  /** ISO timestamp when the request was created. */
  createdAt: string;
  /** ISO timestamp when the request expires. */
  expiresAt: string | null;
  /** ISO timestamp when a response was submitted. */
  submittedAt: string | null;
  /** ISO timestamp when the request was cancelled. */
  cancelledAt: string | null;
  /** ISO timestamp when the request expired. */
  expiredAt: string | null;
  /** Most recent submitted response. */
  latestResponse: InputResponseRestOutput | null;
}

/** Zod schema for get input request rest. */
export const getInputRequestRestSchema: () => Schema<InputRequestRestOutput> = defineSchema((v) =>
  v
    .object({
      id: v.string().uuid(),
      conversation_id: v.string().uuid(),
      run_id: v.string().min(1),
      tool_call_id: v.string().min(1),
      kind: v.literal("form"),
      status: v.enum(["open", "submitted", "cancelled", "expired"] as const),
      requested_responder_type: v.enum(["human", "agent", "system"] as const),
      title: v.string(),
      description: v.string().nullable(),
      fields: v.array(getHumanInputFieldSchema()),
      recommendations: v.record(v.string(), v.unknown()).nullable().optional(),
      metadata: v.record(v.string(), v.unknown()).nullable().optional(),
      created_at: v.string(),
      expires_at: v.string().nullable(),
      submitted_at: v.string().nullable().optional(),
      cancelled_at: v.string().nullable().optional(),
      expired_at: v.string().nullable().optional(),
      latest_response: getInputResponseRestSchema().nullable().optional(),
    })
    .passthrough()
    .transform((value): InputRequestRestOutput => {
      const v2 = value as Record<string, unknown>;
      return {
        id: v2.id as string,
        conversationId: v2.conversation_id as string,
        runId: v2.run_id as string,
        toolCallId: v2.tool_call_id as string,
        kind: v2.kind as "form",
        status: v2.status as InputRequestRestOutput["status"],
        requestedResponderType: v2
          .requested_responder_type as InputRequestRestOutput["requestedResponderType"],
        title: v2.title as string,
        description: v2.description as string | null,
        fields: v2.fields as unknown[],
        recommendations: (v2.recommendations as Record<string, unknown> | null | undefined) ?? null,
        metadata: (v2.metadata as Record<string, unknown> | null | undefined) ?? null,
        createdAt: v2.created_at as string,
        expiresAt: v2.expires_at as string | null,
        submittedAt: (v2.submitted_at as string | null | undefined) ?? null,
        cancelledAt: (v2.cancelled_at as string | null | undefined) ?? null,
        expiredAt: (v2.expired_at as string | null | undefined) ?? null,
        latestResponse: (v2.latest_response as InputResponseRestOutput | null | undefined) ?? null,
      };
    })
);

/** Zod schema for get create input request response. */
export const getCreateInputRequestResponseSchema: typeof getInputRequestRestSchema =
  getInputRequestRestSchema;
/** Zod schema for get get input request response. */
export const getGetInputRequestResponseSchema: typeof getInputRequestRestSchema =
  getInputRequestRestSchema;

/** Zod schema for get input request output. */
export const getInputRequestOutputSchema: () => Schema<InputRequestOutput> = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    conversationId: v.string().uuid(),
    runId: v.string().min(1),
    toolCallId: v.string().min(1),
    kind: v.literal("form"),
    status: v.enum(["open", "submitted", "cancelled", "expired"] as const),
    requestedResponderType: v.enum(["human", "agent", "system"] as const),
    title: v.string(),
    description: v.string().nullable(),
    fields: v.array(getHumanInputFieldSchema()),
    recommendations: v.record(v.string(), v.unknown()).nullable(),
    metadata: v.record(v.string(), v.unknown()).nullable(),
    createdAt: v.string(),
    expiresAt: v.string().nullable(),
    submittedAt: v.string().nullable(),
    cancelledAt: v.string().nullable(),
    expiredAt: v.string().nullable(),
    latestResponse: getInputResponseRestSchema().nullable(),
  })
);

/** Zod schema for get input request lifecycle data event. */
export const getInputRequestLifecycleDataEventSchema: () => Schema<ToolExecutionDataEvent> =
  defineSchema((v) =>
    v.object({
      type: v.literal("veryfront.input_request.lifecycle"),
      data: v.object({
        action: v.enum(["created", "updated"] as const),
        inputRequest: getInputRequestOutputSchema(),
      }),
      name: v.literal("veryfront.input_request.lifecycle"),
      value: v.object({
        action: v.enum(["created", "updated"] as const),
        inputRequest: getInputRequestOutputSchema(),
      }),
    })
  );

// `InputRequestOutput` mirrors `InputRequestRestOutput` (the transform result
// of `getInputRequestRestSchema`); both share the camelCase output shape.
/** Output from input request. */
export type InputRequestOutput = InputRequestRestOutput;

/** Request payload for create input. */
export async function createInputRequest(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  toolCallId: string;
  form: FormInputToolInput;
  expiresAt: string;
}): Promise<InputRequestOutput> {
  const requestBody = getCreateInputRequestRequestSchema().parse({
    run_id: input.runId,
    tool_call_id: input.toolCallId,
    kind: "form",
    requested_responder_type: "human",
    title: input.form.title,
    ...(input.form.description ? { description: input.form.description } : {}),
    fields: input.form.fields,
    expires_at: input.expiresAt,
    ...(input.form.submitLabel ? { metadata: { submitLabel: input.form.submitLabel } } : {}),
  });
  const response = await fetch(
    `${input.apiUrl}/conversations/${input.conversationId}/input-requests`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw NETWORK_ERROR.create({
      detail: detail || `Failed to create durable input request (HTTP ${response.status})`,
    });
  }

  return getCreateInputRequestResponseSchema().parse(await response.json()) as InputRequestOutput;
}

/** Request payload for get input. */
export async function getInputRequest(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  inputRequestId: string;
}): Promise<InputRequestOutput> {
  const response = await fetch(
    `${input.apiUrl}/conversations/${input.conversationId}/input-requests/${input.inputRequestId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw NETWORK_ERROR.create({
      detail: detail || `Failed to fetch durable input request (HTTP ${response.status})`,
    });
  }

  return getGetInputRequestResponseSchema().parse(await response.json()) as InputRequestOutput;
}

/** Event emitted for build input request lifecycle data. */
export function buildInputRequestLifecycleDataEvent(input: {
  action: "created" | "updated";
  inputRequest: InputRequestOutput;
}): ToolExecutionDataEvent {
  return getInputRequestLifecycleDataEventSchema().parse({
    type: "veryfront.input_request.lifecycle",
    data: {
      action: input.action,
      inputRequest: input.inputRequest,
    },
    name: "veryfront.input_request.lifecycle",
    value: {
      action: input.action,
      inputRequest: input.inputRequest,
    },
  });
}
