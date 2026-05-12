import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, RefinementCtx } from "#veryfront/extensions/schema/index.ts";
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

export const getRuntimeAgentRunIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
);

/** @deprecated Use getRuntimeAgentRunIdSchema() */
export const RuntimeAgentRunIdSchema = getRuntimeAgentRunIdSchema();

export const getRuntimeAgentToolCallIdSchema = defineSchema((v) => v.string().min(1).max(128));

/** @deprecated Use getRuntimeAgentToolCallIdSchema() */
export const RuntimeAgentToolCallIdSchema = getRuntimeAgentToolCallIdSchema();

export const getRuntimeAgentServiceIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
    "Agent service ids must start with an alphanumeric character and use a valid service-id format",
  )
);

/** @deprecated Use getRuntimeAgentServiceIdSchema() */
export const RuntimeAgentServiceIdSchema = getRuntimeAgentServiceIdSchema();

export const getRuntimeAgentIdSchema = defineSchema((v) => v.string().min(1).max(128));

/** @deprecated Use getRuntimeAgentIdSchema() */
export const RuntimeAgentIdSchema = getRuntimeAgentIdSchema();

export const getRuntimeAgentToolNameSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
    "Tool names must start with a letter and use a valid client-tool format",
  )
);

/** @deprecated Use getRuntimeAgentToolNameSchema() */
export const RuntimeAgentToolNameSchema = getRuntimeAgentToolNameSchema();

const getRuntimeAgentToolJsonSchemaDocumentSchema = defineSchema((v) =>
  v.record(v.string(), v.unknown()).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool schema metadata must be less than 16 KB" },
  )
);

export const getRuntimeAgentToolSchema = defineSchema((v) =>
  v.object({
    name: getRuntimeAgentToolNameSchema(),
    description: v.string().max(1024).optional(),
    parameters: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
      { message: "Tool parameters must be less than 16 KB" },
    ),
    inputSchema: getRuntimeAgentToolJsonSchemaDocumentSchema().optional(),
    outputSchema: getRuntimeAgentToolJsonSchemaDocumentSchema().optional(),
  })
);

/** @deprecated Use getRuntimeAgentToolSchema() */
export const RuntimeAgentToolSchema = getRuntimeAgentToolSchema();

export const getRuntimeAgentContextItemSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("text"),
      title: v.string().max(256).optional(),
      text: v.string().max(MAX_CONTEXT_ITEM_BYTES),
    }),
    v.object({
      type: v.literal("json"),
      title: v.string().max(256).optional(),
      data: v.record(v.string(), v.unknown()).refine(
        (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_ITEM_BYTES),
        { message: "JSON context item must be less than 16 KB" },
      ),
    }),
    v.object({
      type: v.literal("resource"),
      title: v.string().max(256).optional(),
      uri: v.string().max(2048),
      mimeType: v.string().max(256).optional(),
      text: v.string().max(MAX_CONTEXT_ITEM_BYTES).optional(),
    }),
  ])
);

/** @deprecated Use getRuntimeAgentContextItemSchema() */
export const RuntimeAgentContextItemSchema = getRuntimeAgentContextItemSchema();

export const getRuntimeAgentSourceContextSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("branch"),
      branch: v.string().min(1).max(255),
    }),
    v.object({
      type: v.literal("environment"),
      environmentName: v.string().min(1).max(255),
      releaseId: v.string().min(1).max(255).optional(),
    }),
    v.object({
      type: v.literal("release"),
      releaseId: v.string().min(1).max(255),
    }),
  ])
);

/** @deprecated Use getRuntimeAgentSourceContextSchema() */
export const RuntimeAgentSourceContextSchema = getRuntimeAgentSourceContextSchema();

export const getRuntimeAgentTargetKindSchema = defineSchema((v) =>
  v.enum(["production", "environment", "preview_branch"])
);

/** @deprecated Use getRuntimeAgentTargetKindSchema() */
export const RuntimeAgentTargetKindSchema = getRuntimeAgentTargetKindSchema();

type RuntimeAgentTargetSelectionInput = {
  runtimeTargetKind?: InferSchema<ReturnType<typeof getRuntimeAgentTargetKindSchema>> | null;
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
};

export function validateRuntimeAgentTargetSelection(
  input: RuntimeAgentTargetSelectionInput,
  ctx: RefinementCtx,
) {
  const kind = input.runtimeTargetKind;
  if (!kind || kind === "production") {
    if (input.runtimeTargetEnvironmentId || input.runtimeTargetBranchId) {
      ctx.addIssue({
        code: "custom",
        message: "production target does not accept environment or branch identifiers",
        path: ["runtimeTargetKind"],
      });
    }
    return;
  }

  if (kind === "environment") {
    if (!input.runtimeTargetEnvironmentId || input.runtimeTargetBranchId) {
      ctx.addIssue({
        code: "custom",
        message:
          "environment target requires runtimeTargetEnvironmentId and no runtimeTargetBranchId",
        path: ["runtimeTargetKind"],
      });
    }
    return;
  }

  if (!input.runtimeTargetBranchId || input.runtimeTargetEnvironmentId) {
    ctx.addIssue({
      code: "custom",
      message:
        "preview_branch target requires runtimeTargetBranchId and no runtimeTargetEnvironmentId",
      path: ["runtimeTargetKind"],
    });
  }
}

export const getRuntimeAgentProjectContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().uuid(),
    projectSlug: v.string().min(1).max(255),
    runtimeTargetKind: getRuntimeAgentTargetKindSchema().nullable().optional(),
    runtimeTargetEnvironmentId: v.string().uuid().nullable().optional(),
    runtimeTargetBranchId: v.string().uuid().nullable().optional(),
  }).superRefine(validateRuntimeAgentTargetSelection)
);

/** @deprecated Use getRuntimeAgentProjectContextSchema() */
export const RuntimeAgentProjectContextSchema = getRuntimeAgentProjectContextSchema();

export const getRuntimeAgentValidatedClaimsSchema = defineSchema((v) =>
  v.object({
    subject: v.string().min(1).max(256),
    projectId: v.string().uuid().optional(),
    projectSlug: v.string().min(1).max(255).optional(),
    scopes: v.array(v.string().min(1).max(128)).max(50).default([]),
  })
);

/** @deprecated Use getRuntimeAgentValidatedClaimsSchema() */
export const RuntimeAgentValidatedClaimsSchema = getRuntimeAgentValidatedClaimsSchema();

export const getRuntimeAgentRunContextSchema = defineSchema((v) =>
  v.object({
    agentServiceId: getRuntimeAgentServiceIdSchema(),
    agentId: getRuntimeAgentIdSchema(),
    conversationId: v.string().uuid(),
    runId: getRuntimeAgentRunIdSchema(),
    messageId: v.string().uuid(),
    inputAnchorMessageId: v.string().uuid(),
    requestedByUserId: v.string().uuid(),
    project: getRuntimeAgentProjectContextSchema(),
    parentConversationId: v.string().uuid().nullable().optional(),
    parentRunId: getRuntimeAgentRunIdSchema().nullable().optional(),
    spawnedFromMessageId: v.string().uuid().nullable().optional(),
    spawnedFromToolCallId: getRuntimeAgentToolCallIdSchema().nullable().optional(),
    validatedClaims: getRuntimeAgentValidatedClaimsSchema().optional(),
  }).superRefine((input, ctx) => {
    if (input.parentRunId && input.parentRunId === input.runId) {
      ctx.addIssue({
        code: "custom",
        message: "parentRunId cannot match runId",
        path: ["parentRunId"],
      });
    }

    if (!input.parentRunId && input.spawnedFromMessageId) {
      ctx.addIssue({
        code: "custom",
        message: "spawnedFromMessageId requires parentRunId",
        path: ["spawnedFromMessageId"],
      });
    }

    if (!input.parentRunId && input.spawnedFromToolCallId) {
      ctx.addIssue({
        code: "custom",
        message: "spawnedFromToolCallId requires parentRunId",
        path: ["spawnedFromToolCallId"],
      });
    }

    if (
      input.validatedClaims?.projectId &&
      input.validatedClaims.projectId !== input.project.projectId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "validatedClaims.projectId must match project.projectId",
        path: ["validatedClaims", "projectId"],
      });
    }

    if (
      input.validatedClaims?.projectSlug &&
      input.validatedClaims.projectSlug !== input.project.projectSlug
    ) {
      ctx.addIssue({
        code: "custom",
        message: "validatedClaims.projectSlug must match project.projectSlug",
        path: ["validatedClaims", "projectSlug"],
      });
    }
  })
);

/** @deprecated Use getRuntimeAgentRunContextSchema() */
export const RuntimeAgentRunContextSchema = getRuntimeAgentRunContextSchema();

export const getRuntimeAgentRunInvocationSchema = defineSchema((v) =>
  v.object({
    run: getRuntimeAgentRunContextSchema(),
    messages: v.array(v.unknown()).default([]),
    tools: v.array(getRuntimeAgentToolSchema()).max(50).default([]),
    context: v.array(getRuntimeAgentContextItemSchema()).max(10).default([]).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
      { message: "context must be less than 64 KB total" },
    ),
    agentSource: getRuntimeAgentSourceContextSchema().optional(),
    forwardedProps: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
      { message: "forwardedProps must be less than 64 KB" },
    ),
  })
);

/** @deprecated Use getRuntimeAgentRunInvocationSchema() */
export const RuntimeAgentRunInvocationSchema = getRuntimeAgentRunInvocationSchema();

export type RuntimeAgentTool = InferSchema<ReturnType<typeof getRuntimeAgentToolSchema>>;
export type RuntimeAgentContextItem = InferSchema<
  ReturnType<typeof getRuntimeAgentContextItemSchema>
>;
export type RuntimeAgentSourceContext = InferSchema<
  ReturnType<typeof getRuntimeAgentSourceContextSchema>
>;
export type RuntimeAgentTargetKind = InferSchema<
  ReturnType<typeof getRuntimeAgentTargetKindSchema>
>;
export type RuntimeAgentProjectContext = InferSchema<
  ReturnType<typeof getRuntimeAgentProjectContextSchema>
>;
export type RuntimeAgentValidatedClaims = InferSchema<
  ReturnType<typeof getRuntimeAgentValidatedClaimsSchema>
>;
export type RuntimeAgentRunContext = InferSchema<
  ReturnType<typeof getRuntimeAgentRunContextSchema>
>;
export type RuntimeAgentRunInvocation = InferSchema<
  ReturnType<typeof getRuntimeAgentRunInvocationSchema>
>;

export async function parseRuntimeAgentRunInvocation(
  request: Request,
): Promise<RuntimeAgentRunInvocation> {
  return getRuntimeAgentRunInvocationSchema().parse(await request.json());
}

export async function parseRuntimeAgentRunInvocationOrError(
  request: Request,
): Promise<RuntimeAgentRunInvocation | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseRuntimeAgentRunInvocation(request),
    "Invalid runtime agent invocation",
  );
}
