import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { INVALID_ARGUMENT, NETWORK_ERROR } from "#veryfront/errors";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import {
  getHumanInputFieldSchema,
  getHumanInputOptionSchema,
  humanInputRequestBaseFields,
} from "./human-input.ts";

// `formInputToolInputSchema` is `HumanInputRequestSchema` minus its `metadata`
// field. The contract DSL doesn't expose `.omit(...)`, so we share the base
// shape via `humanInputRequestBaseFields(v)` and construct two object schemas.
/** Zod schema for get form input tool input. */
export const getFormInputToolInputSchema = defineSchema((v) =>
  v.object(humanInputRequestBaseFields(v))
);

// The hosted model must not request presentation controls that the durable API rejects.
// Keep local form schemas and their public inferred types unchanged.
const getDurableHumanInputFieldSchema = defineSchema((v) => {
  const base = {
    name: v.string().min(1).max(128),
    label: v.string().min(1).max(256),
    description: v.string().max(1024).optional(),
    required: v.boolean().optional().default(false),
    secret: v.boolean().optional().default(false),
  };
  return v.discriminatedUnion("type", [
    v.object({
      ...base,
      type: v.enum(["text", "email", "url", "password", "number"] as const),
      defaultValue: v.string().optional(),
    }),
    v.object({ ...base, type: v.literal("textarea"), defaultValue: v.string().optional() }),
    v.object({
      ...base,
      type: v.literal("select"),
      options: v.array(getHumanInputOptionSchema()).min(1),
      defaultValue: v.string().optional(),
    }),
    v.object({
      ...base,
      type: v.literal("checkbox"),
      defaultValue: v.boolean().optional().default(false),
    }),
    v.object({
      ...base,
      type: v.literal("radio"),
      options: v.array(getHumanInputOptionSchema()).min(1),
      defaultValue: v.string().optional(),
    }),
    v.object({ ...base, type: v.literal("confirm") }),
  ]).transform((field) => {
    // Existing renderers consume these defaults; they are not advertised to the model.
    if (field.type === "textarea") return { ...field, rows: 3 };
    if (field.type === "confirm") return { ...field, confirmLabel: "Yes", denyLabel: "No" };
    return field;
  });
});

/** Form controls supported by the owning Runs API for hosted execution. */
export const getDurableFormInputToolInputSchema = defineSchema((v) =>
  v.object({
    ...humanInputRequestBaseFields(v),
    fields: v.array(getDurableHumanInputFieldSchema()).min(1),
  })
);

/** Zod schema for get input response values. */
export const getInputResponseValuesSchema = defineSchema((v) =>
  v.record(
    v.string(),
    v.union([v.string(), v.boolean(), v.number(), v.null()]),
  )
);

/** Zod schema for get create input request request. */
export const getCreateInputRequestRequestSchema = defineSchema((v) =>
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

interface UnavailableInputResponseActor {
  type: "unavailable";
  reason: "not_recorded" | "identity_removed";
  legacy_role?:
    | "human"
    | "agent"
    | "integration"
    | "system"
    | "user"
    | "api_key"
    | "service_account";
  legacy_id?: string;
}

const getUnavailableInputResponseActorSchema = defineSchema((v) =>
  v.object({
    type: v.literal("unavailable"),
    reason: v.enum(["not_recorded", "identity_removed"] as const),
    legacy_role: v.enum(
      ["human", "agent", "integration", "system", "user", "api_key", "service_account"] as const,
    ).optional(),
    legacy_id: v.string().min(1).max(255).optional(),
  }).strict()
);

// Hand-written transform output type. The contract DSL erases the parameter
// type through `.transform()` (the adapter casts the callback parameter to
// `never`), so we need an explicit annotation to keep the downstream type
// inference flowing.
export interface InputResponseRestOutput {
  id: string;
  inputRequestId: string;
  conversationId: string;
  runId: string;
  actorType: string;
  actorId: string | null;
  unavailableActor?: UnavailableInputResponseActor;
  values: Record<string, string | number | boolean | null>;
  redactedFields?: string[];
  createdAt: string;
}

/** Zod schema for get input response rest. */
export const getInputResponseRestSchema = defineSchema((v) =>
  v
    .object({
      id: v.string().uuid(),
      input_request_id: v.string().uuid(),
      conversation_id: v.string().uuid(),
      run_id: v.string().min(1),
      actor_type: v.string(),
      actor_id: v.string().nullable(),
      unavailable_actor: getUnavailableInputResponseActorSchema().optional(),
      values: getInputResponseValuesSchema(),
      redacted_fields: v.array(v.string()).optional(),
      created_at: v.string(),
    })
    .passthrough()
    .refine((value) => {
      const response = value as Record<string, unknown>;
      return response.actor_type === "unavailable"
        ? response.actor_id === null && response.unavailable_actor !== undefined
        : typeof response.actor_id === "string" && response.unavailable_actor === undefined;
    }, "Recorded actors require an identity; unavailable actors require explicit provenance")
    .transform((value): InputResponseRestOutput => {
      const v2 = value as Record<string, unknown>;
      return {
        id: v2.id as string,
        inputRequestId: v2.input_request_id as string,
        conversationId: v2.conversation_id as string,
        runId: v2.run_id as string,
        actorType: v2.actor_type as string,
        actorId: v2.actor_id as string | null,
        ...(v2.unavailable_actor
          ? { unavailableActor: v2.unavailable_actor as UnavailableInputResponseActor }
          : {}),
        values: v2.values as Record<string, string | number | boolean | null>,
        redactedFields: v2.redacted_fields as string[] | undefined,
        createdAt: v2.created_at as string,
      };
    })
);

// Hand-written transform output type — see InputResponseRestOutput note.
export interface InputRequestRestOutput {
  id: string;
  conversationId: string;
  runId: string;
  toolCallId?: string;
  kind: "form";
  status: "open" | "submitted" | "cancelled" | "expired";
  requestedResponderType: "human" | "agent" | "system";
  title: string;
  description: string | null;
  fields: unknown[];
  recommendations: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  latestResponse: InputResponseRestOutput | null;
}

// Canonical reads accept wider field labels/descriptions than local form creation.
// Keep this projection separate so reading a valid request never relaxes creation.
const getInputRequestReadFieldSchema = defineSchema((v) => {
  const base = {
    name: v.string().min(1).max(128),
    label: v.string().max(1000),
    description: v.string().max(4000).optional(),
    required: v.boolean().optional().default(false),
    secret: v.boolean().optional().default(false),
  };
  const option = v.object({
    value: v.string().min(1),
    label: v.string().min(1),
    description: v.string().optional(),
    recommended: v.boolean().optional(),
  });
  return v.discriminatedUnion("type", [
    v.object({
      ...base,
      type: v.enum(["text", "email", "url", "password", "number"] as const),
      defaultValue: v.string().optional(),
    }),
    v.object({
      ...base,
      type: v.literal("textarea"),
      defaultValue: v.string().optional(),
      rows: v.number().int().positive().optional().default(3),
    }),
    v.object({
      ...base,
      type: v.literal("select"),
      options: v.array(option).min(1).max(100),
      defaultValue: v.string().optional(),
    }),
    v.object({
      ...base,
      type: v.literal("radio"),
      options: v.array(option).min(1).max(100),
      defaultValue: v.string().optional(),
    }),
    v.object({
      ...base,
      type: v.literal("checkbox"),
      defaultValue: v.boolean().optional().default(false),
    }),
    v.object({
      ...base,
      type: v.literal("confirm"),
      defaultValue: v.boolean().optional(),
      confirmLabel: v.string().optional().default("Yes"),
      denyLabel: v.string().optional().default("No"),
    }),
  ]);
});

/** Zod schema for get input request rest. */
export const getInputRequestRestSchema = defineSchema((v) =>
  v
    .object({
      id: v.string().uuid(),
      conversation_id: v.string().uuid(),
      run_id: v.string().min(1),
      tool_call_id: v.string().min(1).optional(),
      kind: v.literal("form"),
      status: v.enum(["open", "submitted", "cancelled", "expired"] as const),
      requested_responder_type: v.enum(["human", "agent", "system"] as const),
      title: v.string(),
      description: v.string().nullable(),
      fields: v.array(getInputRequestReadFieldSchema()),
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
        ...(typeof v2.tool_call_id === "string" ? { toolCallId: v2.tool_call_id } : {}),
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
export const getCreateInputRequestResponseSchema = getInputRequestRestSchema;
/** Zod schema for get get input request response. */
export const getGetInputRequestResponseSchema = getInputRequestRestSchema;

/** Zod schema for get input request output. */
export const getInputRequestOutputSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    conversationId: v.string().uuid(),
    runId: v.string().min(1),
    toolCallId: v.string().min(1).optional(),
    kind: v.literal("form"),
    status: v.enum(["open", "submitted", "cancelled", "expired"] as const),
    requestedResponderType: v.enum(["human", "agent", "system"] as const),
    title: v.string(),
    description: v.string().nullable(),
    fields: v.array(getInputRequestReadFieldSchema()),
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
export const getInputRequestLifecycleDataEventSchema = defineSchema((v) =>
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

/** Input payload for form input tool. */
export type FormInputToolInput = InferSchema<ReturnType<typeof getFormInputToolInputSchema>>;
// `InputRequestOutput` mirrors `InputRequestRestOutput` (the transform result
// of `getInputRequestRestSchema`); both share the camelCase output shape.
/** Output from input request. */
export type InputRequestOutput = InputRequestRestOutput;

function toCanonicalInputRequestField(source: Record<string, unknown>) {
  const unsupportedOptions = [
    "placeholder",
    "pattern",
    "minLength",
    "maxLength",
    "min",
    "max",
    "rows",
    "confirmLabel",
    "denyLabel",
  ];
  for (const property of unsupportedOptions) {
    const value = source[property];
    if (value === undefined) continue;
    // These values are injected by the form parser and match the default controls.
    if (source.type === "textarea" && property === "rows" && value === 3) continue;
    if (source.type === "confirm" && property === "confirmLabel" && value === "Yes") continue;
    if (source.type === "confirm" && property === "denyLabel" && value === "No") continue;
    throw INVALID_ARGUMENT.create({
      detail: `Canonical input field "${source.name}" does not support "${property}"`,
    });
  }
  const type = source.secret === true ? "password" : source.type;
  let defaultValue = source.defaultValue;
  if (type === "number" && typeof defaultValue === "string") {
    if (defaultValue.trim() === "" || !Number.isFinite(Number(defaultValue))) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Canonical input field "${source.name}" requires a finite, non-empty numeric defaultValue`,
      });
    }
    defaultValue = Number(defaultValue);
  }
  return Object.fromEntries(
    Object.entries({
      name: source.name,
      label: source.label,
      description: source.description,
      required: source.required,
      type,
      ...(type !== "password" ? { default: defaultValue } : {}),
      ...(source.options ? { options: source.options } : {}),
    }).filter(([, value]) => value !== undefined),
  );
}

/** Request payload for create input. */
export async function createInputRequest(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  canonicalRunId?: string;
  toolCallId: string;
  form: FormInputToolInput;
  expiresAt: string;
}): Promise<InputRequestOutput> {
  const canonicalRunId = input.canonicalRunId ?? input.runId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canonicalRunId)) {
    throw NETWORK_ERROR.create({ detail: "Canonical run identity is required for input requests" });
  }
  const { run_id: _runId, kind: _kind, ...requestBody } = getCreateInputRequestRequestSchema()
    .parse({
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
    `${input.apiUrl}/runs/${canonicalRunId}/input-requests`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `runtime-input:${await computeHash(
          `${canonicalRunId}:${input.toolCallId}`,
        )}`,
      },
      body: JSON.stringify({
        ...requestBody,
        fields: requestBody.fields.map((field) =>
          toCanonicalInputRequestField(field as Record<string, unknown>)
        ),
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw NETWORK_ERROR.create({
      detail: detail || `Failed to create durable input request (HTTP ${response.status})`,
    });
  }

  return parseCanonicalInputRequest(await response.json(), input.conversationId);
}

/** Request payload for get input. */
export async function getInputRequest(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  inputRequestId: string;
}): Promise<InputRequestOutput> {
  const response = await fetch(
    `${input.apiUrl}/input-requests/${input.inputRequestId}`,
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

  return parseCanonicalInputRequest(await response.json(), input.conversationId);
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

function parseCanonicalInputRequest(value: unknown, conversationId: string): InputRequestOutput {
  const row = value as Record<string, unknown>;
  const response = row.response as Record<string, unknown> | null;
  const actor = response?.actor as Record<string, unknown> | undefined;
  return getInputRequestRestSchema().parse({
    ...row,
    id: row.input_request_id,
    conversation_id: row.conversation_id ?? conversationId,
    kind: "form",
    description: row.description ?? null,
    expires_at: row.expires_at ?? null,
    fields: Array.isArray(row.fields)
      ? row.fields.map((field) => {
        const definition = field as Record<string, unknown>;
        return {
          ...definition,
          label: definition.label ?? definition.name,
          ...(definition.default !== undefined
            ? {
              defaultValue: definition.type === "number"
                ? String(definition.default)
                : definition.default,
            }
            : {}),
        };
      })
      : row.fields,
    submitted_at: row.status === "submitted" ? row.resolved_at : null,
    cancelled_at: row.status === "cancelled" ? row.resolved_at : null,
    expired_at: row.status === "expired" ? row.resolved_at : null,
    latest_response: response
      ? {
        ...response,
        id: response.response_id,
        input_request_id: row.input_request_id,
        conversation_id: row.conversation_id ?? conversationId,
        run_id: row.run_id,
        actor_type: actor?.type,
        actor_id: actor?.type === "unavailable" ? null : actor?.id,
        ...(actor?.type === "unavailable" ? { unavailable_actor: actor } : {}),
      }
      : null,
  }) as InputRequestOutput;
}
