import { z } from "zod";
import { parseAgUiJsonRequestOrError } from "./ag-ui-request-shared.ts";

const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 65_536;
const encoder = new TextEncoder();

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

export const RuntimeAgentRunIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export const RuntimeAgentToolCallIdSchema = z.string().min(1).max(128);

export const RuntimeAgentServiceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
    "Agent service ids must start with an alphanumeric character and use a valid service-id format",
  );

export const RuntimeAgentIdSchema = z.string().min(1).max(128);

export const RuntimeAgentToolNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
    "Tool names must start with a letter and use a valid client-tool format",
  );

const RuntimeAgentToolJsonSchemaDocumentSchema = z.record(z.string(), z.unknown()).refine(
  (value) => isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
  { message: "Tool schema metadata must be less than 16 KB" },
);

export const RuntimeAgentToolSchema = z.object({
  name: RuntimeAgentToolNameSchema,
  description: z.string().max(1024).optional(),
  parameters: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool parameters must be less than 16 KB" },
  ),
  inputSchema: RuntimeAgentToolJsonSchemaDocumentSchema.optional(),
  outputSchema: RuntimeAgentToolJsonSchemaDocumentSchema.optional(),
});

export const RuntimeAgentContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    title: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  z.object({
    type: z.literal("json"),
    title: z.string().max(256).optional(),
    data: z.record(z.string(), z.unknown()).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_ITEM_BYTES),
      { message: "JSON context item must be less than 16 KB" },
    ),
  }),
  z.object({
    type: z.literal("resource"),
    title: z.string().max(256).optional(),
    uri: z.string().max(2048),
    mimeType: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES).optional(),
  }),
]);

export const RuntimeAgentSourceContextSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("branch"),
    branch: z.string().min(1).max(255),
  }),
  z.object({
    type: z.literal("environment"),
    environmentName: z.string().min(1).max(255),
    releaseId: z.string().min(1).max(255).optional(),
  }),
  z.object({
    type: z.literal("release"),
    releaseId: z.string().min(1).max(255),
  }),
]);

export const RuntimeAgentTargetKindSchema = z.enum([
  "production",
  "environment",
  "preview_branch",
]);

type RuntimeAgentTargetSelectionInput = {
  runtimeTargetKind?: z.infer<typeof RuntimeAgentTargetKindSchema> | null;
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
};

export function validateRuntimeAgentTargetSelection(
  input: RuntimeAgentTargetSelectionInput,
  ctx: z.RefinementCtx,
) {
  const kind = input.runtimeTargetKind;
  if (!kind || kind === "production") {
    if (input.runtimeTargetEnvironmentId || input.runtimeTargetBranchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "production target does not accept environment or branch identifiers",
        path: ["runtimeTargetKind"],
      });
    }
    return;
  }

  if (kind === "environment") {
    if (!input.runtimeTargetEnvironmentId || input.runtimeTargetBranchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "environment target requires runtimeTargetEnvironmentId and no runtimeTargetBranchId",
        path: ["runtimeTargetKind"],
      });
    }
    return;
  }

  if (!input.runtimeTargetBranchId || input.runtimeTargetEnvironmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "preview_branch target requires runtimeTargetBranchId and no runtimeTargetEnvironmentId",
      path: ["runtimeTargetKind"],
    });
  }
}

export const RuntimeAgentProjectContextSchema = z.object({
  projectId: z.string().uuid(),
  projectSlug: z.string().min(1).max(255),
  runtimeTargetKind: RuntimeAgentTargetKindSchema.nullable().optional(),
  runtimeTargetEnvironmentId: z.string().uuid().nullable().optional(),
  runtimeTargetBranchId: z.string().uuid().nullable().optional(),
}).superRefine(validateRuntimeAgentTargetSelection);

export const RuntimeAgentValidatedClaimsSchema = z.object({
  subject: z.string().min(1).max(256),
  projectId: z.string().uuid().optional(),
  projectSlug: z.string().min(1).max(255).optional(),
  scopes: z.array(z.string().min(1).max(128)).max(50).default([]),
});

export const RuntimeAgentRunContextSchema = z.object({
  agentServiceId: RuntimeAgentServiceIdSchema,
  agentId: RuntimeAgentIdSchema,
  conversationId: z.string().uuid(),
  runId: RuntimeAgentRunIdSchema,
  messageId: z.string().uuid(),
  inputAnchorMessageId: z.string().uuid(),
  requestedByUserId: z.string().uuid(),
  project: RuntimeAgentProjectContextSchema,
  parentConversationId: z.string().uuid().nullable().optional(),
  parentRunId: RuntimeAgentRunIdSchema.nullable().optional(),
  spawnedFromMessageId: z.string().uuid().nullable().optional(),
  spawnedFromToolCallId: RuntimeAgentToolCallIdSchema.nullable().optional(),
  validatedClaims: RuntimeAgentValidatedClaimsSchema.optional(),
}).superRefine((input, ctx) => {
  if (input.parentRunId && input.parentRunId === input.runId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "parentRunId cannot match runId",
      path: ["parentRunId"],
    });
  }

  if (!input.parentRunId && input.spawnedFromMessageId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "spawnedFromMessageId requires parentRunId",
      path: ["spawnedFromMessageId"],
    });
  }

  if (!input.parentRunId && input.spawnedFromToolCallId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "spawnedFromToolCallId requires parentRunId",
      path: ["spawnedFromToolCallId"],
    });
  }

  if (
    input.validatedClaims?.projectId && input.validatedClaims.projectId !== input.project.projectId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "validatedClaims.projectId must match project.projectId",
      path: ["validatedClaims", "projectId"],
    });
  }

  if (
    input.validatedClaims?.projectSlug &&
    input.validatedClaims.projectSlug !== input.project.projectSlug
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "validatedClaims.projectSlug must match project.projectSlug",
      path: ["validatedClaims", "projectSlug"],
    });
  }
});

export const RuntimeAgentRunInvocationSchema = z.object({
  run: RuntimeAgentRunContextSchema,
  messages: z.array(z.unknown()).default([]),
  tools: z.array(RuntimeAgentToolSchema).max(50).default([]),
  context: z.array(RuntimeAgentContextItemSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  agentSource: RuntimeAgentSourceContextSchema.optional(),
  forwardedProps: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
});

export type RuntimeAgentTool = z.infer<typeof RuntimeAgentToolSchema>;
export type RuntimeAgentContextItem = z.infer<typeof RuntimeAgentContextItemSchema>;
export type RuntimeAgentSourceContext = z.infer<typeof RuntimeAgentSourceContextSchema>;
export type RuntimeAgentTargetKind = z.infer<typeof RuntimeAgentTargetKindSchema>;
export type RuntimeAgentProjectContext = z.infer<typeof RuntimeAgentProjectContextSchema>;
export type RuntimeAgentValidatedClaims = z.infer<typeof RuntimeAgentValidatedClaimsSchema>;
export type RuntimeAgentRunContext = z.infer<typeof RuntimeAgentRunContextSchema>;
export type RuntimeAgentRunInvocation = z.infer<typeof RuntimeAgentRunInvocationSchema>;

export async function parseRuntimeAgentRunInvocation(
  request: Request,
): Promise<RuntimeAgentRunInvocation> {
  return RuntimeAgentRunInvocationSchema.parse(await request.json());
}

export async function parseRuntimeAgentRunInvocationOrError(
  request: Request,
): Promise<RuntimeAgentRunInvocation | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseRuntimeAgentRunInvocation(request),
    "Invalid runtime agent invocation",
  );
}
