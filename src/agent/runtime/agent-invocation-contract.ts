import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { RefinementCtx, Schema } from "#veryfront/extensions/schema/index.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import { parseAgUiJsonBody, parseAgUiJsonRequestOrError } from "../ag-ui/request-shared.ts";
import {
  getRuntimeAgentMarkdownDefinitionSchema,
  type RuntimeAgentMarkdownDefinition,
} from "./agent-definition.ts";

ensureBuiltinSchemaValidator();

const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_AGENT_CONFIG_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 196_608;
const MAX_CREDENTIAL_BYTES = 16_384;
const encoder = new TextEncoder();

/** Tool declaration forwarded with a runtime agent invocation. */
export interface RuntimeAgentTool {
  /** Tool name. */
  name: string;
  /** Optional tool description. */
  description?: string;
  /** Optional provider-facing JSON Schema parameters. */
  parameters?: Record<string, unknown>;
  /** Optional input JSON Schema document. */
  inputSchema?: Record<string, unknown>;
  /** Optional output JSON Schema document. */
  outputSchema?: Record<string, unknown>;
}

/** Context item forwarded with a runtime agent invocation. */
export type RuntimeAgentContextItem =
  | { type: "text"; title?: string; text: string }
  | { type: "json"; title?: string; data: Record<string, unknown> }
  | { type: "resource"; title?: string; uri: string; mimeType?: string; text?: string };

/** Source revision used to load a runtime agent. */
export type RuntimeAgentSourceContext =
  | { type: "branch"; branch: string }
  | { type: "environment"; environmentName: string; releaseId: string }
  | { type: "release"; releaseId: string };

/** Deployment target used by a runtime agent invocation. */
export type RuntimeAgentTargetKind = "main_branch" | "environment" | "preview_branch";

/** Project context bound to a runtime agent invocation. */
export interface RuntimeAgentProjectContext {
  /** Project identifier. */
  projectId: string;
  /** Project slug. */
  projectSlug: string;
  /** Optional runtime target category. */
  runtimeTargetKind?: RuntimeAgentTargetKind | null;
  /** Environment identifier for an environment target. */
  runtimeTargetEnvironmentId?: string | null;
  /** Branch identifier for a preview-branch target. */
  runtimeTargetBranchId?: string | null;
}

/** Claims validated by the runtime service before invocation. */
export interface RuntimeAgentValidatedClaims {
  /** Authenticated subject. */
  subject: string;
  /** Optional project identifier claim. */
  projectId?: string;
  /** Optional project slug claim. */
  projectSlug?: string;
  /** Granted authorization scopes. */
  scopes: string[];
}

/** Durable run context bound to a runtime agent invocation. */
export interface RuntimeAgentRunContext {
  /** Agent service identifier. */
  agentServiceId: string;
  /** Agent identifier. */
  agentId: string;
  /** Conversation identifier. */
  conversationId: string;
  /** Run identifier. */
  runId: string;
  /** Output message identifier. */
  messageId: string;
  /** Input anchor message identifier. */
  inputAnchorMessageId: string;
  /** User that requested the run. */
  requestedByUserId: string;
  /** Project and deployment target context. */
  project: RuntimeAgentProjectContext;
  /** Parent conversation identifier for a child run. */
  parentConversationId?: string | null;
  /** Parent run identifier for a child run. */
  parentRunId?: string | null;
  /** Message that spawned a child run. */
  spawnedFromMessageId?: string | null;
  /** Tool call that spawned a child run. */
  spawnedFromToolCallId?: string | null;
  /** Claims already validated by the runtime service. */
  validatedClaims?: RuntimeAgentValidatedClaims;
}

/** Validated payload for invoking a runtime agent. */
export interface RuntimeAgentRunInvocation {
  /** Durable run context. */
  run: RuntimeAgentRunContext;
  /** Provider-neutral input messages. */
  messages: unknown[];
  /** Client-provided tool declarations. */
  tools: RuntimeAgentTool[];
  /** Additional context items. */
  context: RuntimeAgentContextItem[];
  /** Source revision used to load the agent. */
  agentSource: RuntimeAgentSourceContext;
  /** Optional inline agent definition. */
  agentConfig?: RuntimeAgentMarkdownDefinition;
  /** Optional invocation credentials. */
  credentials?: { authToken: string };
  /** Opaque properties forwarded to the agent runtime. */
  forwardedProps?: Record<string, unknown>;
}

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

/** Schema for runtime agent run ID.
 * @deprecated Use getRuntimeAgentRunIdSchema()
 */
export const RuntimeAgentRunIdSchema: Schema<string> = lazySchema(getRuntimeAgentRunIdSchema);

export const getRuntimeAgentToolCallIdSchema = defineSchema((v) => v.string().min(1).max(128));

/** Schema for runtime agent tool call ID.
 * @deprecated Use getRuntimeAgentToolCallIdSchema()
 */
export const RuntimeAgentToolCallIdSchema: Schema<string> = lazySchema(
  getRuntimeAgentToolCallIdSchema,
);

export const getRuntimeAgentServiceIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
    "Agent service ids must start with an alphanumeric character and use a valid service-id format",
  )
);

/** Schema for runtime agent service ID.
 * @deprecated Use getRuntimeAgentServiceIdSchema()
 */
export const RuntimeAgentServiceIdSchema: Schema<string> = lazySchema(
  getRuntimeAgentServiceIdSchema,
);

export const getRuntimeAgentIdSchema = defineSchema((v) => v.string().min(1).max(128));

/** Schema for runtime agent ID.
 * @deprecated Use getRuntimeAgentIdSchema()
 */
export const RuntimeAgentIdSchema: Schema<string> = lazySchema(getRuntimeAgentIdSchema);

export const getRuntimeAgentToolNameSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
    "Tool names must start with a letter and use a valid client-tool format",
  )
);

/** Schema for runtime agent tool name.
 * @deprecated Use getRuntimeAgentToolNameSchema()
 */
export const RuntimeAgentToolNameSchema: Schema<string> = lazySchema(
  getRuntimeAgentToolNameSchema,
);

const getRuntimeAgentToolJsonSchemaDocumentSchema = defineSchema((v) =>
  v.record(v.string(), v.unknown()).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool schema metadata must be less than 16 KB" },
  )
);

/** Returns the runtime agent tool schema. */
export const getRuntimeAgentToolSchema: () => Schema<RuntimeAgentTool> = defineSchema((v) =>
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

/** Schema for runtime agent tool.
 * @deprecated Use getRuntimeAgentToolSchema()
 */
export const RuntimeAgentToolSchema: Schema<RuntimeAgentTool> = lazySchema(
  getRuntimeAgentToolSchema,
);

/** Returns the runtime agent context item schema. */
export const getRuntimeAgentContextItemSchema: () => Schema<RuntimeAgentContextItem> = defineSchema(
  (
    v,
  ) =>
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
    ]),
);

/** Schema for runtime agent context item.
 * @deprecated Use getRuntimeAgentContextItemSchema()
 */
export const RuntimeAgentContextItemSchema: Schema<RuntimeAgentContextItem> = lazySchema(
  getRuntimeAgentContextItemSchema,
);

/** Returns the runtime agent source context schema. */
export const getRuntimeAgentSourceContextSchema: () => Schema<RuntimeAgentSourceContext> =
  defineSchema((v) =>
    v.discriminatedUnion("type", [
      v.object({
        type: v.literal("branch"),
        branch: v.string().min(1).max(255),
      }),
      v.object({
        type: v.literal("environment"),
        environmentName: v.string().min(1).max(255),
        releaseId: v.string().min(1).max(255),
      }),
      v.object({
        type: v.literal("release"),
        releaseId: v.string().min(1).max(255),
      }),
    ])
  );

/** Schema for runtime agent source context.
 * @deprecated Use getRuntimeAgentSourceContextSchema()
 */
export const RuntimeAgentSourceContextSchema: Schema<RuntimeAgentSourceContext> = lazySchema(
  getRuntimeAgentSourceContextSchema,
);

/** Returns the runtime agent target kind schema. */
export const getRuntimeAgentTargetKindSchema: () => Schema<RuntimeAgentTargetKind> = defineSchema((
  v,
) => v.enum(["main_branch", "environment", "preview_branch"] as const));

/** Schema for runtime agent target kind.
 * @deprecated Use getRuntimeAgentTargetKindSchema()
 */
export const RuntimeAgentTargetKindSchema: Schema<RuntimeAgentTargetKind> = lazySchema(
  getRuntimeAgentTargetKindSchema,
);

/** Target fields validated together for one runtime invocation. */
export interface RuntimeAgentTargetSelectionInput {
  /** Runtime target category. */
  runtimeTargetKind?: RuntimeAgentTargetKind | null;
  /** Environment identifier required by environment targets. */
  runtimeTargetEnvironmentId?: string | null;
  /** Branch identifier required by preview-branch targets. */
  runtimeTargetBranchId?: string | null;
}

/** Validates runtime agent target selection. */
export function validateRuntimeAgentTargetSelection(
  input: RuntimeAgentTargetSelectionInput,
  ctx: RefinementCtx,
): void {
  const kind = input.runtimeTargetKind;
  if (!kind || kind === "main_branch") {
    if (input.runtimeTargetEnvironmentId || input.runtimeTargetBranchId) {
      ctx.addIssue({
        code: "custom",
        message: "main_branch target does not accept environment or branch identifiers",
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

/** Returns the runtime agent project context schema. */
export const getRuntimeAgentProjectContextSchema: () => Schema<RuntimeAgentProjectContext> =
  defineSchema((v) =>
    v.object({
      projectId: v.string().uuid(),
      projectSlug: v.string().min(1).max(255),
      runtimeTargetKind: getRuntimeAgentTargetKindSchema().nullable().optional(),
      runtimeTargetEnvironmentId: v.string().uuid().nullable().optional(),
      runtimeTargetBranchId: v.string().uuid().nullable().optional(),
    }).superRefine(validateRuntimeAgentTargetSelection)
  );

/** Schema for runtime agent project context.
 * @deprecated Use getRuntimeAgentProjectContextSchema()
 */
export const RuntimeAgentProjectContextSchema: Schema<RuntimeAgentProjectContext> = lazySchema(
  getRuntimeAgentProjectContextSchema,
);

/** Returns the validated runtime agent claims schema. */
export const getRuntimeAgentValidatedClaimsSchema: () => Schema<RuntimeAgentValidatedClaims> =
  defineSchema((v) =>
    v.object({
      subject: v.string().min(1).max(256),
      projectId: v.string().uuid().optional(),
      projectSlug: v.string().min(1).max(255).optional(),
      scopes: v.array(v.string().min(1).max(128)).max(50).default([]),
    })
  );

/** Schema for runtime agent validated claims.
 * @deprecated Use getRuntimeAgentValidatedClaimsSchema()
 */
export const RuntimeAgentValidatedClaimsSchema: Schema<RuntimeAgentValidatedClaims> = lazySchema(
  getRuntimeAgentValidatedClaimsSchema,
);

/** Returns the runtime agent run context schema. */
export const getRuntimeAgentRunContextSchema: () => Schema<RuntimeAgentRunContext> = defineSchema((
  v,
) =>
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

/** Schema for runtime agent run context.
 * @deprecated Use getRuntimeAgentRunContextSchema()
 */
export const RuntimeAgentRunContextSchema: Schema<RuntimeAgentRunContext> = lazySchema(
  getRuntimeAgentRunContextSchema,
);

export const getRuntimeAgentCredentialsSchema = defineSchema((v) =>
  v.object({
    authToken: v.string().min(1).max(MAX_CREDENTIAL_BYTES),
  }).strict()
);

/** Returns the runtime agent invocation schema. */
export const getRuntimeAgentRunInvocationSchema: () => Schema<RuntimeAgentRunInvocation> =
  defineSchema((v) =>
    v.object({
      run: getRuntimeAgentRunContextSchema(),
      messages: v.array(v.unknown()).default([]),
      tools: v.array(getRuntimeAgentToolSchema()).max(50).default([]),
      context: v.array(getRuntimeAgentContextItemSchema()).max(10).default([]).refine(
        (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
        { message: "context must be less than 64 KB total" },
      ),
      agentSource: getRuntimeAgentSourceContextSchema(),
      agentConfig: getRuntimeAgentMarkdownDefinitionSchema().optional().refine(
        (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_AGENT_CONFIG_BYTES),
        { message: "agentConfig must be less than 64 KB" },
      ),
      credentials: getRuntimeAgentCredentialsSchema().optional(),
      forwardedProps: v.record(v.string(), v.unknown()).optional().refine(
        (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
        { message: "forwardedProps must be less than 192 KB" },
      ),
    }).superRefine((input, ctx) => {
      if (input.agentConfig && input.agentConfig.id !== input.run.agentId) {
        ctx.addIssue({
          code: "custom",
          message: "agentConfig.id must match run.agentId",
          path: ["agentConfig", "id"],
        });
      }
    })
  );

/** Schema for runtime agent run invocation.
 * @deprecated Use getRuntimeAgentRunInvocationSchema()
 */
export const RuntimeAgentRunInvocationSchema: Schema<RuntimeAgentRunInvocation> = lazySchema(
  getRuntimeAgentRunInvocationSchema,
);

/** Request payload for runtime agent control plane stream. */
export type RuntimeAgentControlPlaneStreamRequest = {
  agentId: RuntimeAgentRunContext["agentId"];
  threadId: RuntimeAgentRunContext["conversationId"];
  runId: RuntimeAgentRunContext["runId"];
  parentRunId?: Exclude<RuntimeAgentRunContext["parentRunId"], null | undefined>;
  messages: RuntimeAgentRunInvocation["messages"];
  tools: RuntimeAgentRunInvocation["tools"];
  context: RuntimeAgentRunInvocation["context"];
  credentials?: RuntimeAgentRunInvocation["credentials"];
  agentSource: RuntimeAgentRunInvocation["agentSource"];
  agentConfig?: RuntimeAgentRunInvocation["agentConfig"];
  forwardedProps?: RuntimeAgentRunInvocation["forwardedProps"];
};

/** Builds runtime agent control plane stream request from invocation. */
export function buildRuntimeAgentControlPlaneStreamRequestFromInvocation(
  input: RuntimeAgentRunInvocation,
): RuntimeAgentControlPlaneStreamRequest {
  return {
    agentId: input.run.agentId,
    threadId: input.run.conversationId,
    runId: input.run.runId,
    ...(input.run.parentRunId ? { parentRunId: input.run.parentRunId } : {}),
    messages: input.messages,
    tools: input.tools,
    context: input.context,
    ...(input.credentials ? { credentials: input.credentials } : {}),
    agentSource: input.agentSource,
    ...(input.agentConfig ? { agentConfig: input.agentConfig } : {}),
    ...(input.forwardedProps ? { forwardedProps: input.forwardedProps } : {}),
  };
}

/** Parses runtime agent run invocation. */
export async function parseRuntimeAgentRunInvocation(
  request: Request,
): Promise<RuntimeAgentRunInvocation> {
  return getRuntimeAgentRunInvocationSchema().parse(await parseAgUiJsonBody(request));
}

/** Error shape for parse runtime agent run invocation or. */
export async function parseRuntimeAgentRunInvocationOrError(
  request: Request,
): Promise<RuntimeAgentRunInvocation | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseRuntimeAgentRunInvocation(request),
    "Invalid runtime agent invocation",
  );
}
