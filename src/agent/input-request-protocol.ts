import { z } from "zod";
import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import { HumanInputFieldSchema, HumanInputRequestSchema } from "./human-input.ts";

export const formInputToolInputSchema = HumanInputRequestSchema.omit({ metadata: true });
export const inputResponseValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.number(), z.null()]),
);

export const createInputRequestRequestSchema = z.object({
  run_id: z.string().min(1),
  tool_call_id: z.string().min(1),
  kind: z.literal("form"),
  requested_responder_type: z.literal("human"),
  title: z.string(),
  description: z.string().optional(),
  fields: z.array(HumanInputFieldSchema).min(1),
  expires_at: z.string().datetime({ offset: true }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const inputResponseRestSchema = z
  .object({
    id: z.string().uuid(),
    input_request_id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    run_id: z.string().min(1),
    actor_type: z.string(),
    actor_id: z.string(),
    values: inputResponseValuesSchema,
    created_at: z.string(),
  })
  .passthrough()
  .transform((value) => ({
    id: value.id,
    inputRequestId: value.input_request_id,
    conversationId: value.conversation_id,
    runId: value.run_id,
    actorType: value.actor_type,
    actorId: value.actor_id,
    values: value.values,
    createdAt: value.created_at,
  }));

export const inputRequestRestSchema = z
  .object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    run_id: z.string().min(1),
    tool_call_id: z.string().min(1),
    kind: z.literal("form"),
    status: z.enum(["open", "submitted", "cancelled", "expired"]),
    requested_responder_type: z.enum(["human", "agent", "system"]),
    title: z.string(),
    description: z.string().nullable(),
    fields: z.array(HumanInputFieldSchema),
    recommendations: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.string(),
    expires_at: z.string().nullable(),
    submitted_at: z.string().nullable().optional(),
    cancelled_at: z.string().nullable().optional(),
    expired_at: z.string().nullable().optional(),
    latest_response: inputResponseRestSchema.nullable().optional(),
  })
  .passthrough()
  .transform((value) => ({
    id: value.id,
    conversationId: value.conversation_id,
    runId: value.run_id,
    toolCallId: value.tool_call_id,
    kind: value.kind,
    status: value.status,
    requestedResponderType: value.requested_responder_type,
    title: value.title,
    description: value.description,
    fields: value.fields,
    recommendations: value.recommendations ?? null,
    metadata: value.metadata ?? null,
    createdAt: value.created_at,
    expiresAt: value.expires_at,
    submittedAt: value.submitted_at ?? null,
    cancelledAt: value.cancelled_at ?? null,
    expiredAt: value.expired_at ?? null,
    latestResponse: value.latest_response ?? null,
  }));

export const createInputRequestResponseSchema = inputRequestRestSchema;
export const getInputRequestResponseSchema = inputRequestRestSchema;
export const inputRequestOutputSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  kind: z.literal("form"),
  status: z.enum(["open", "submitted", "cancelled", "expired"]),
  requestedResponderType: z.enum(["human", "agent", "system"]),
  title: z.string(),
  description: z.string().nullable(),
  fields: z.array(HumanInputFieldSchema),
  recommendations: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
  latestResponse: inputResponseRestSchema.nullable(),
});

export const inputRequestLifecycleDataEventSchema = z.object({
  type: z.literal("veryfront.input_request.lifecycle"),
  data: z.object({
    action: z.enum(["created", "updated"]),
    inputRequest: inputRequestOutputSchema,
  }),
  name: z.literal("veryfront.input_request.lifecycle"),
  value: z.object({
    action: z.enum(["created", "updated"]),
    inputRequest: inputRequestOutputSchema,
  }),
});

export type FormInputToolInput = z.infer<typeof formInputToolInputSchema>;
export type InputRequestOutput = z.infer<typeof inputRequestOutputSchema>;

export async function createInputRequest(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  toolCallId: string;
  form: FormInputToolInput;
  expiresAt: string;
}): Promise<InputRequestOutput> {
  const requestBody = createInputRequestRequestSchema.parse({
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
    throw new Error(detail || `Failed to create durable input request (HTTP ${response.status})`);
  }

  return createInputRequestResponseSchema.parse(await response.json());
}

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
    throw new Error(detail || `Failed to fetch durable input request (HTTP ${response.status})`);
  }

  return getInputRequestResponseSchema.parse(await response.json());
}

export function buildInputRequestLifecycleDataEvent(input: {
  action: "created" | "updated";
  inputRequest: InputRequestOutput;
}): ToolExecutionDataEvent {
  return inputRequestLifecycleDataEventSchema.parse({
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
