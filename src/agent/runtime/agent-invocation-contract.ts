import { encodePrivateText, PrivateTextEncoder } from "#veryfront/security/private-text.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, RefinementCtx } from "#veryfront/extensions/schema/index.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import { parseAgUiJsonBody, parseAgUiJsonRequestOrError } from "../ag-ui/request-shared.ts";
import { getRuntimeAgentMarkdownDefinitionSchema } from "./agent-definition.ts";
import { MAX_RUNTIME_INFERENCE_CREDENTIAL_BYTES } from "#veryfront/security/credential-limits.ts";
import { agentLogger } from "#veryfront/utils/logger/index.ts";
import { AGENT_DELEGATE_TOOL_PREFIX } from "./agent-delegation-names.ts";

ensureBuiltinSchemaValidator();

const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_AGENT_CONFIG_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 196_608;
const MAX_CREDENTIAL_BYTES = MAX_RUNTIME_INFERENCE_CREDENTIAL_BYTES;
const encoder = new PrivateTextEncoder();
const IntrinsicReflectApply = Reflect.apply;
const RegExpPrototypeTest = RegExp.prototype.test;
const INFERENCE_CREDENTIAL_PATTERN = /^[\x21-\x7e]+$/;

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return privateByteLength(encodePrivateText(privateJsonStringify(value), encoder)) <= maxBytes;
  } catch {
    return false;
  }
}

function isWithinUtf8SizeLimit(value: string, maxBytes: number): boolean {
  return privateByteLength(encodePrivateText(value, encoder)) <=
    maxBytes;
}

export const getRuntimeAgentRunIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
);

/** Schema for runtime agent run ID.
 * @deprecated Use getRuntimeAgentRunIdSchema()
 */
export const RuntimeAgentRunIdSchema = lazySchema(getRuntimeAgentRunIdSchema);

export const getRuntimeAgentToolCallIdSchema = defineSchema((v) => v.string().min(1).max(128));

const getRuntimeAgentResumeToolCallIdSchema = defineSchema((v) => v.string().min(1).max(256));

/** Signed calls support depth 128 and 100,000 visited values, including array lengths. */
export const getRuntimeAgentResumeToolCallSchema = defineSchema((v) =>
  v.object({
    id: getRuntimeAgentResumeToolCallIdSchema(),
    name: v.string().min(1).max(128),
    input: v.record(v.string(), v.unknown()),
  }).strict().refine((value) => {
    try {
      privateJsonStringify(value);
      return true;
    } catch {
      return false;
    }
  }, { message: "resumeToolCall exceeds supported JSON structure (depth 128, 100000 values)" })
);

/** Schema for durable runtime task identity. */
export const getRuntimeAgentTaskIdSchema = defineSchema((v) =>
  v.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
);

/** Schema for runtime agent tool call ID.
 * @deprecated Use getRuntimeAgentToolCallIdSchema()
 */
export const RuntimeAgentToolCallIdSchema = lazySchema(getRuntimeAgentToolCallIdSchema);

export const getRuntimeAgentServiceIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
    "Agent service ids must start with an alphanumeric character and use a valid service-id format",
  )
);

/** Schema for runtime agent service ID.
 * @deprecated Use getRuntimeAgentServiceIdSchema()
 */
export const RuntimeAgentServiceIdSchema = lazySchema(getRuntimeAgentServiceIdSchema);

export const getRuntimeAgentIdSchema = defineSchema((v) => v.string().min(1).max(128));

/** Schema for runtime agent ID.
 * @deprecated Use getRuntimeAgentIdSchema()
 */
export const RuntimeAgentIdSchema = lazySchema(getRuntimeAgentIdSchema);

export const getRuntimeAgentToolNameSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
    "Tool names must start with a letter and use a valid client-tool format",
  )
);

/** Schema for runtime agent tool name.
 * @deprecated Use getRuntimeAgentToolNameSchema()
 */
export const RuntimeAgentToolNameSchema = lazySchema(getRuntimeAgentToolNameSchema);

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

/** Schema for runtime agent tool.
 * @deprecated Use getRuntimeAgentToolSchema()
 */
export const RuntimeAgentToolSchema = lazySchema(getRuntimeAgentToolSchema);

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

/** Schema for runtime agent context item.
 * @deprecated Use getRuntimeAgentContextItemSchema()
 */
export const RuntimeAgentContextItemSchema = lazySchema(getRuntimeAgentContextItemSchema);

export const getRuntimeAgentSourceContextSchema = defineSchema((v) =>
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
export const RuntimeAgentSourceContextSchema = lazySchema(getRuntimeAgentSourceContextSchema);

export const getRuntimeAgentTargetKindSchema = defineSchema((v) =>
  v.enum(["main_branch", "environment", "preview_branch"])
);

/** Schema for runtime agent target kind.
 * @deprecated Use getRuntimeAgentTargetKindSchema()
 */
export const RuntimeAgentTargetKindSchema = lazySchema(getRuntimeAgentTargetKindSchema);

export type RuntimeAgentTargetSelectionInput = {
  runtimeTargetKind?: InferSchema<ReturnType<typeof getRuntimeAgentTargetKindSchema>> | null;
  runtimeTargetEnvironmentId?: string | null;
  executionEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
};

/** Validates runtime agent target selection. */
export function validateRuntimeAgentTargetSelection(
  input: RuntimeAgentTargetSelectionInput,
  ctx: RefinementCtx,
) {
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

/**
 * Binds the selected source snapshot to the runtime target whose identifiers
 * will be signed into the control-plane request.
 */
export function validateRuntimeAgentSourceTargetBinding(
  input: RuntimeAgentTargetSelectionInput & { agentSource: RuntimeAgentSourceContext },
  ctx: RefinementCtx,
) {
  const kind = input.runtimeTargetKind ?? "main_branch";
  const sourceType = input.agentSource.type;

  if (sourceType === "environment" && kind !== "environment") {
    ctx.addIssue({
      code: "custom",
      message: "environment agent source requires an environment runtime target",
      path: ["agentSource", "type"],
    });
  } else if (sourceType !== "environment" && kind === "environment") {
    ctx.addIssue({
      code: "custom",
      message: "environment runtime target requires an environment agent source",
      path: ["agentSource", "type"],
    });
  }

  if (sourceType === "release" && kind !== "main_branch") {
    ctx.addIssue({
      code: "custom",
      message: "release agent source requires a main-branch runtime target",
      path: ["agentSource", "type"],
    });
  }

  // A project's default branch is platform metadata, not a framework literal.
  // Hosted runtimes compare branch sources with the trusted default branch
  // supplied by the proxy after body-bound control-plane verification.
}

export const getRuntimeAgentProjectContextSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().uuid(),
    projectSlug: v.string().min(1).max(255),
    runtimeTargetKind: getRuntimeAgentTargetKindSchema().nullable().optional(),
    runtimeTargetEnvironmentId: v.string().uuid().nullable().optional(),
    executionEnvironmentId: v.string().uuid().optional(),
    runtimeTargetBranchId: v.string().uuid().nullable().optional(),
    runtimeTargetBranchName: v.string().min(1).max(255).optional(),
    runtimeTargetEnvironmentName: v.string().min(1).max(255).optional(),
  }).superRefine(validateRuntimeAgentTargetSelection)
);

/** Schema for runtime agent project context.
 * @deprecated Use getRuntimeAgentProjectContextSchema()
 */
export const RuntimeAgentProjectContextSchema = lazySchema(getRuntimeAgentProjectContextSchema);

export const getRuntimeAgentValidatedClaimsSchema = defineSchema((v) =>
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
export const RuntimeAgentValidatedClaimsSchema = lazySchema(getRuntimeAgentValidatedClaimsSchema);

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

/** Schema for runtime agent run context.
 * @deprecated Use getRuntimeAgentRunContextSchema()
 */
export const RuntimeAgentRunContextSchema = lazySchema(getRuntimeAgentRunContextSchema);

export const getRuntimeAgentCredentialsSchema = defineSchema((v) => {
  const credential = () => v.string().min(1).max(MAX_CREDENTIAL_BYTES);
  const inferenceCredential = () =>
    credential().refine(
      (value) =>
        IntrinsicReflectApply(RegExpPrototypeTest, INFERENCE_CREDENTIAL_PATTERN, [
          value,
        ]) as boolean,
      { message: "Credential must be a non-empty visible ASCII string" },
    ).refine(
      (value) => isWithinUtf8SizeLimit(value, MAX_CREDENTIAL_BYTES),
      { message: "Credential must not exceed 16 KB" },
    );

  return v.object({
    // Preserve the legacy character-count contract for authToken; the byte
    // refinement and transport-safe character set are intentionally limited to
    // the new inference credential.
    authToken: credential(),
    sourceAuthToken: inferenceCredential().optional(),
    inferenceAuthToken: inferenceCredential().optional(),
  }).strict();
});

/**
 * Runtime overrides forwarded in `forwardedProps.runtimeOverrides`. Hosted
 * preparation re-exports this as `getHostedChatRuntimeOverridesSchema`.
 */
export const getRuntimeAgentRuntimeOverridesSchema = defineSchema((v) =>
  v.object({
    allowedTools: v.array(v.string().min(1)).max(100).optional(),
    thinking: v.union([v.literal(false), v.number().int().positive()]).optional(),
    maxSteps: v.number().int().positive().optional(),
    maxOutputTokens: v.number().int().positive().optional(),
  }).strip()
);

export const getRuntimeAgentRunInvocationSchema = defineSchema((v) =>
  v.object({
    run: getRuntimeAgentRunContextSchema(),
    sourceProject: getRuntimeAgentProjectContextSchema().optional(),
    taskId: getRuntimeAgentTaskIdSchema().optional(),
    messages: v.array(v.unknown()).default([]),
    tools: v.array(getRuntimeAgentToolSchema()).max(50).default([]),
    context: v.array(getRuntimeAgentContextItemSchema()).max(10).default([]).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
      { message: "context must be less than 64 KB total" },
    ),
    allowDelegation: v.boolean().optional(),
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
    serverResolvedProviderReplayCheckpoints: v.unknown().optional(),
    serverResolvedTrustedHostedHistoryMessageIds: v.array(v.string()).optional(),
    resumeToolCall: getRuntimeAgentResumeToolCallSchema().optional(),
  }).superRefine((input, ctx) => {
    if (input.sourceProject) {
      const executionTarget = input.run.project;
      if (
        (executionTarget.runtimeTargetKind === "environment" &&
          !executionTarget.runtimeTargetEnvironmentName) ||
        (executionTarget.runtimeTargetKind !== "environment" &&
          !executionTarget.runtimeTargetBranchName)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Shared execution requires the consuming project's runtime target name",
          path: ["run", "project"],
        });
      }
      if (input.agentSource.type === "branch") {
        ctx.addIssue({
          code: "custom",
          message: "Shared agent source requires an immutable release",
          path: ["agentSource"],
        });
      }
      if (!input.credentials?.sourceAuthToken) {
        ctx.addIssue({
          code: "custom",
          message: "Shared agent source requires a source credential",
          path: ["credentials", "sourceAuthToken"],
        });
      }
    }
    if (input.agentConfig && input.agentConfig.id !== input.run.agentId) {
      ctx.addIssue({
        code: "custom",
        message: "agentConfig.id must match run.agentId",
        path: ["agentConfig", "id"],
      });
    }

    validateRuntimeAgentSourceTargetBinding(
      {
        ...(input.sourceProject ?? input.run.project),
        agentSource: input.agentSource,
      },
      ctx,
    );
  })
);

// Capture the trusted ingress methods before project code can mutate the public
// compatibility facade or the materialized schema instance.
const trustedRuntimeAgentRunInvocationSchema = getRuntimeAgentRunInvocationSchema();
const TrustedRuntimeAgentRunInvocationParse = trustedRuntimeAgentRunInvocationSchema.parse;
const TrustedRuntimeAgentRunInvocationSafeParse = trustedRuntimeAgentRunInvocationSchema.safeParse;

const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectDefineProperty = Object.defineProperty;
const ObjectCreate = Object.create;
const ArrayIsArray = Array.isArray;
const StringPrototypeStartsWith = String.prototype.startsWith;
const IntrinsicSet = Set;
const SetPrototypeHas = Set.prototype.has;
const SetPrototypeAdd = Set.prototype.add;
const MALFORMED = Symbol("malformed");

/**
 * Host and platform tool names a provider-native tool may never claim under
 * deny-all. Hosted preparation shares one `allowedTools` list between host and
 * provider tools, so a provider name that matches one of these would re-grant
 * the host capability (`invoke_agent` through legacy delegation, knowledge
 * search, a configured delegate, the skill loader, ...).
 */
const DENY_ALL_RESERVED_HOST_TOOL_NAMES: ReadonlySet<string> = new Set([
  "invoke_agent",
  "load_skill",
  "form_input",
  "tool_search",
  "search_knowledge",
]);
const DENY_ALL_RESERVED_HOST_TOOL_PREFIXES: readonly string[] = [
  "veryfront__",
  AGENT_DELEGATE_TOOL_PREFIX,
];

/** Runtime override keys that supply remote tool sources; deny-all drops them. */
const DENY_ALL_DISCARDED_RUNTIME_OVERRIDE_KEYS: readonly string[] = [
  "integrationToolDefinitions",
  "serverResolvedIntegrationTools",
];

// Validators for values the deny-all mapping replaces or discards, captured
// before project code can mutate the materialized schema instances.
const trustedDenyAllAgentConfigSchema = getRuntimeAgentMarkdownDefinitionSchema();
const TrustedDenyAllAgentConfigSafeParse = trustedDenyAllAgentConfigSchema.safeParse;
const trustedDenyAllInjectedToolsSchema = defineSchema((v) =>
  v.array(getRuntimeAgentToolSchema()).max(50)
)();
const TrustedDenyAllInjectedToolsSafeParse = trustedDenyAllInjectedToolsSchema.safeParse;
const trustedDenyAllRuntimeOverridesSchema = getRuntimeAgentRuntimeOverridesSchema();
const TrustedDenyAllRuntimeOverridesSafeParse = trustedDenyAllRuntimeOverridesSchema.safeParse;

function trustedSafeParseSucceeds(
  parse: (value: unknown) => { success: boolean },
  schema: unknown,
  value: unknown,
): boolean {
  return IntrinsicReflectApply(parse, schema, [value]).success === true;
}

/** Records and arrays the deny-all mapping reads from or writes to. */
type OwnDataContainer = Record<string, unknown> | readonly unknown[];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !ArrayIsArray(value);
}

function readOwn(source: OwnDataContainer, key: string | number): unknown {
  if (!ObjectHasOwn(source, key)) return undefined;
  const descriptor = ObjectGetOwnPropertyDescriptor(source, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/**
 * Define an own data property without invoking inherited setters. Used for
 * both record keys and generated array elements: plain `[]`/`{}` assignment
 * would run an `Object.prototype`/`Array.prototype` setter instead.
 */
function defineOwnData(target: OwnDataContainer, key: string | number, value: unknown): void {
  // A null-prototype descriptor: inherited `get`/`set` cannot leak into it.
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.writable = true;
  descriptor.enumerable = true;
  descriptor.configurable = true;
  ObjectDefineProperty(target, key, descriptor);
}

function appendOwn<T>(target: T[], value: T): void {
  defineOwnData(target, target.length, value);
}

/** A record with no prototype: inherited properties can never be read from it. */
function createNullPrototypeRecord(): Record<string, unknown> {
  return ObjectCreate(null) as Record<string, unknown>;
}

/**
 * Copy own data properties without re-reading accessors (they are dropped).
 * The copy has a null prototype, so an omitted key cannot reappear through an
 * inherited `Object.prototype` getter when the schema reads known fields.
 */
function copyOwnDataRecord(
  source: Record<string, unknown>,
  omit: readonly string[] = [],
): Record<string, unknown> {
  const copy = createNullPrototypeRecord();
  const keys = ObjectKeys(source);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    let omitted = false;
    for (let omitIndex = 0; omitIndex < omit.length; omitIndex++) {
      if (omit[omitIndex] === key) omitted = true;
    }
    if (omitted) continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(source, key);
    if (descriptor && "value" in descriptor) defineOwnData(copy, key, descriptor.value);
  }
  return copy;
}

function copyStringArray(entries: readonly string[]): string[] {
  const copy: string[] = [];
  for (let index = 0; index < entries.length; index++) appendOwn(copy, entries[index]!);
  return copy;
}

/** Read an own string array; a present value that is not one is MALFORMED. */
function readOwnStrictStringArray(
  source: Record<string, unknown>,
  key: string,
): string[] | undefined | typeof MALFORMED {
  if (!ObjectHasOwn(source, key)) return undefined;
  const value = readOwn(source, key);
  if (!ArrayIsArray(value)) return MALFORMED;
  const entries: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = readOwn(value, index);
    if (typeof entry !== "string") return MALFORMED;
    appendOwn(entries, entry);
  }
  return entries;
}

function readOwnStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = readOwn(source, key);
  if (!ArrayIsArray(value)) return undefined;
  const entries: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = readOwn(value, index);
    if (typeof entry === "string") appendOwn(entries, entry);
  }
  return entries;
}

/** Build a membership set with captured intrinsics (constant-time lookups). */
function createStringSet(entries: readonly string[]): Set<string> {
  const set = new IntrinsicSet<string>();
  for (let index = 0; index < entries.length; index++) {
    IntrinsicReflectApply(SetPrototypeAdd, set, [entries[index]]);
  }
  return set;
}

function setHas(set: ReadonlySet<string>, candidate: string): boolean {
  return IntrinsicReflectApply(SetPrototypeHas, set, [candidate]) === true;
}

function setAdd(set: Set<string>, candidate: string): void {
  IntrinsicReflectApply(SetPrototypeAdd, set, [candidate]);
}

function isReservedHostToolName(toolName: string): boolean {
  if (setHas(DENY_ALL_RESERVED_HOST_TOOL_NAMES, toolName)) return true;
  for (let index = 0; index < DENY_ALL_RESERVED_HOST_TOOL_PREFIXES.length; index++) {
    if (
      IntrinsicReflectApply(StringPrototypeStartsWith, toolName, [
        DENY_ALL_RESERVED_HOST_TOOL_PREFIXES[index],
      ])
    ) {
      return true;
    }
  }
  return false;
}

type DenyAllNormalization = { value: unknown; denyAll: boolean };

/**
 * Map an authored deny-all (`agentConfig.tools: false`) to the runtime wire
 * shape: `tools: []` plus an explicit `runtimeOverrides.allowedTools` that
 * admits only the agent's own provider-native tools, narrowed by any caller
 * allowlist. This is the same mapping the control plane applies before
 * dispatch. The explicit allowlist stops hosted preparation from adding
 * runtime-essential tools (`load_skill`, `tool_search`, `invoke_agent`,
 * `form_input`), so a deny-all agent exposes no callable host tools.
 *
 * Caller-injected top-level `tools`, the agent's `mcpServers`, and forwarded
 * integration tool definitions are cleared: the agent-stream path keeps any
 * merged or remote tool whose name is in `toolAllowlist`, so such a tool named
 * like a provider tool would otherwise stay callable under deny-all.
 *
 * Fails closed: every value the mapping replaces or discards (the agent
 * config's `bootstrapTools`, `bootstrapSkill`, `skills`, the injected `tools`,
 * and the caller's runtime overrides) is validated first with the same schema
 * the invocation contract applies; an invalid value is left in place so the
 * invocation schema rejects it. The result is parsed with a deny-all schema
 * that also requires the generated `runtimeOverrides` to validate (at most 100
 * deduplicated names). Provider tool names that collide with host or platform
 * tool names are dropped from the allowlist with a warning, so they can never
 * re-grant the host tool.
 *
 * `bootstrapTools` and `bootstrapSkill` are dropped: both run through callable
 * tools (a startup skill is a synthetic `load_skill` call), which deny-all
 * forbids. Every other value passes through unchanged.
 */
function normalizeDenyAllRuntimeAgentInvocationValue(value: unknown): DenyAllNormalization {
  if (!isPlainRecord(value)) return { value, denyAll: false };
  const agentConfig = readOwn(value, "agentConfig");
  if (!isPlainRecord(agentConfig) || readOwn(agentConfig, "tools") !== false) {
    return { value, denyAll: false };
  }

  const normalized = copyOwnDataRecord(value);
  // Validate the authored config (with the deny-all selector expressed as the
  // equivalent empty selector) before any field is discarded. A config that
  // fails keeps `tools: false`, which the invocation schema always rejects:
  // the schema strips unknown fields before its size refinement, so leaving
  // only the invalid fields in place would not reliably fail closed.
  const validationAgentConfig = copyOwnDataRecord(agentConfig);
  defineOwnData(validationAgentConfig, "tools", []);
  if (
    !trustedSafeParseSucceeds(
      TrustedDenyAllAgentConfigSafeParse,
      trustedDenyAllAgentConfigSchema,
      validationAgentConfig,
    ) || !isWithinJsonSizeLimit(validationAgentConfig, MAX_AGENT_CONFIG_BYTES)
  ) {
    defineOwnData(normalized, "agentConfig", copyOwnDataRecord(agentConfig));
    return { value: normalized, denyAll: true };
  }
  // Deny-all forbids the skill loader, so no skill is selectable either; an
  // empty selection keeps ingress paths that preserve skill runtime tools
  // under a non-empty allowlist from re-adding them.
  const normalizedAgentConfig = copyOwnDataRecord(agentConfig, [
    "bootstrapTools",
    "bootstrapSkill",
  ]);
  defineOwnData(normalizedAgentConfig, "tools", []);
  defineOwnData(normalizedAgentConfig, "skills", []);
  // Remote tool sources are callable tools too. An explicit empty server list
  // stops MCP and inherited first-party sources from materializing a tool
  // whose name collides with an allowlisted provider-native tool.
  defineOwnData(normalizedAgentConfig, "mcpServers", []);
  // The tool-result context appends the framework `get_tool_result` reader
  // after the allowlists apply, which would re-grant a callable host tool.
  defineOwnData(normalizedAgentConfig, "toolResultContext", false);
  defineOwnData(normalized, "agentConfig", normalizedAgentConfig);

  // Deny-all exposes no caller-injected tools either. A malformed value is
  // left in place for the invocation schema to reject.
  if (ObjectHasOwn(value, "tools")) {
    const injectedTools = readOwn(value, "tools");
    if (
      injectedTools !== undefined &&
      !trustedSafeParseSucceeds(
        TrustedDenyAllInjectedToolsSafeParse,
        trustedDenyAllInjectedToolsSchema,
        injectedTools,
      )
    ) {
      return { value: normalized, denyAll: true };
    }
  }
  defineOwnData(normalized, "tools", []);

  const forwardedProps = readOwn(value, "forwardedProps");
  if (
    forwardedProps !== undefined &&
    (!isPlainRecord(forwardedProps) ||
      !isWithinJsonSizeLimit(forwardedProps, MAX_FORWARDED_PROPS_BYTES))
  ) {
    // Leave malformed or oversized caller data for the invocation schema to
    // reject; the size cap applies before any field is discarded or replaced.
    return { value: normalized, denyAll: true };
  }
  const forwardedRecord = forwardedProps === undefined
    ? createNullPrototypeRecord()
    : copyOwnDataRecord(forwardedProps);
  defineOwnData(normalized, "forwardedProps", forwardedRecord);
  const runtimeOverrides = readOwn(forwardedRecord, "runtimeOverrides");
  if (runtimeOverrides !== undefined && !isPlainRecord(runtimeOverrides)) {
    // A non-record override fails the deny-all override validation below.
    return { value: normalized, denyAll: true };
  }
  // Forwarded integration tools are remote tool sources as well; deny-all
  // drops them so none can claim an allowlisted provider-native name.
  const runtimeOverridesRecord = runtimeOverrides === undefined
    ? createNullPrototypeRecord()
    : copyOwnDataRecord(runtimeOverrides, DENY_ALL_DISCARDED_RUNTIME_OVERRIDE_KEYS);
  defineOwnData(forwardedRecord, "runtimeOverrides", runtimeOverridesRecord);
  // A present but malformed caller restriction is left in place so the
  // deny-all schema rejects it; it never reads as "no restriction". The
  // caller's `allowedTools` must satisfy the shared override contract (at
  // most 100 non-empty names) before it is intersected and overwritten.
  if (
    !trustedSafeParseSucceeds(
      TrustedDenyAllRuntimeOverridesSafeParse,
      trustedDenyAllRuntimeOverridesSchema,
      runtimeOverridesRecord,
    )
  ) {
    return { value: normalized, denyAll: true };
  }
  const callerAllowedTools = readOwnStrictStringArray(runtimeOverridesRecord, "allowedTools");
  const callerToolAllowlist = readOwnStrictStringArray(runtimeOverridesRecord, "toolAllowlist");
  if (callerAllowedTools === MALFORMED || callerToolAllowlist === MALFORMED) {
    return { value: normalized, denyAll: true };
  }

  // Constant-time membership keeps the intersection linear in its inputs.
  const callerAllowedToolSet = callerAllowedTools === undefined
    ? undefined
    : createStringSet(callerAllowedTools);
  const callerToolAllowlistSet = callerToolAllowlist === undefined
    ? undefined
    : createStringSet(callerToolAllowlist);
  const providerTools = readOwnStringArray(agentConfig, "providerTools") ?? [];
  const allowedTools: string[] = [];
  const seenToolNames = new IntrinsicSet<string>();
  const droppedReservedNames: string[] = [];
  for (let index = 0; index < providerTools.length; index++) {
    const toolName = providerTools[index]!;
    if (setHas(seenToolNames, toolName)) continue;
    setAdd(seenToolNames, toolName);
    if (isReservedHostToolName(toolName)) {
      appendOwn(droppedReservedNames, toolName);
      continue;
    }
    if (callerAllowedToolSet !== undefined && !setHas(callerAllowedToolSet, toolName)) continue;
    if (callerToolAllowlistSet !== undefined && !setHas(callerToolAllowlistSet, toolName)) {
      continue;
    }
    appendOwn(allowedTools, toolName);
  }
  if (droppedReservedNames.length > 0) {
    agentLogger.warn(
      "Deny-all agent provider tools collide with host tool names; dropping them",
      { agentId: readOwn(agentConfig, "id"), droppedToolNames: droppedReservedNames },
    );
  }

  // Hosted preparation restricts through `allowedTools`; the agent-stream path
  // treats `allowedTools` as additive and restricts through `toolAllowlist`
  // (which also caps provider-native and caller-supplied tools). Set both.
  defineOwnData(runtimeOverridesRecord, "allowedTools", allowedTools);
  defineOwnData(runtimeOverridesRecord, "toolAllowlist", copyStringArray(allowedTools));
  return { value: normalized, denyAll: true };
}

/**
 * Deny-all depends on the generated `runtimeOverrides.allowedTools` surviving
 * hosted override parsing; an override that fails it would be ignored and the
 * runtime-essential tools restored. Reject such invocations here instead.
 */
const getDenyAllRuntimeAgentRunInvocationSchema = defineSchema(() =>
  getRuntimeAgentRunInvocationSchema().superRefine((input, ctx) => {
    const runtimeOverrides = input.forwardedProps?.runtimeOverrides;
    // Captured parser: replacing the live schema method after module load
    // cannot approve an invalid generated override.
    const parsed = IntrinsicReflectApply(
      TrustedDenyAllRuntimeOverridesSafeParse,
      trustedDenyAllRuntimeOverridesSchema,
      [runtimeOverrides],
    );
    const toolAllowlist = isPlainRecord(runtimeOverrides)
      ? readOwnStrictStringArray(runtimeOverrides, "toolAllowlist")
      : MALFORMED;
    if (
      !parsed.success || parsed.data.allowedTools === undefined ||
      toolAllowlist === undefined || toolAllowlist === MALFORMED
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "tools: false requires valid forwardedProps.runtimeOverrides (at most 100 provider tools, valid overrides); refusing to run without the deny-all allowlist",
        path: ["forwardedProps", "runtimeOverrides"],
      });
    }
  })
);
const trustedDenyAllRuntimeAgentRunInvocationSchema = getDenyAllRuntimeAgentRunInvocationSchema();
const TrustedDenyAllRuntimeAgentRunInvocationParse =
  trustedDenyAllRuntimeAgentRunInvocationSchema.parse;
const TrustedDenyAllRuntimeAgentRunInvocationSafeParse =
  trustedDenyAllRuntimeAgentRunInvocationSchema.safeParse;

/**
 * Trusted ingress parse. Unlike `getRuntimeAgentRunInvocationSchema()`, which
 * rejects `agentConfig.tools: false`, this accepts an authored deny-all and
 * maps it to the runtime wire shape (see the deny-all normalizer above).
 */
export function parseRuntimeAgentRunInvocationValue(
  value: unknown,
): InferSchema<ReturnType<typeof getRuntimeAgentRunInvocationSchema>> {
  const normalized = normalizeDenyAllRuntimeAgentInvocationValue(value);
  return normalized.denyAll
    ? IntrinsicReflectApply(
      TrustedDenyAllRuntimeAgentRunInvocationParse,
      trustedDenyAllRuntimeAgentRunInvocationSchema,
      [normalized.value],
    )
    : IntrinsicReflectApply(
      TrustedRuntimeAgentRunInvocationParse,
      trustedRuntimeAgentRunInvocationSchema,
      [normalized.value],
    );
}

export function safeParseRuntimeAgentRunInvocationValue(
  value: unknown,
): ReturnType<typeof trustedRuntimeAgentRunInvocationSchema.safeParse> {
  const normalized = normalizeDenyAllRuntimeAgentInvocationValue(value);
  return normalized.denyAll
    ? IntrinsicReflectApply(
      TrustedDenyAllRuntimeAgentRunInvocationSafeParse,
      trustedDenyAllRuntimeAgentRunInvocationSchema,
      [normalized.value],
    )
    : IntrinsicReflectApply(
      TrustedRuntimeAgentRunInvocationSafeParse,
      trustedRuntimeAgentRunInvocationSchema,
      [normalized.value],
    );
}

/** Schema for runtime agent run invocation.
 * @deprecated Use getRuntimeAgentRunInvocationSchema()
 */
export const RuntimeAgentRunInvocationSchema = lazySchema(getRuntimeAgentRunInvocationSchema);

/** Public API contract for runtime agent tool. */
export type RuntimeAgentTool = InferSchema<ReturnType<typeof getRuntimeAgentToolSchema>>;
/** Public API contract for runtime agent context item. */
export type RuntimeAgentContextItem = InferSchema<
  ReturnType<typeof getRuntimeAgentContextItemSchema>
>;
/** Context for runtime agent source. */
export type RuntimeAgentSourceContext = InferSchema<
  ReturnType<typeof getRuntimeAgentSourceContextSchema>
>;
/** Public API contract for runtime agent target kind. */
export type RuntimeAgentTargetKind = InferSchema<
  ReturnType<typeof getRuntimeAgentTargetKindSchema>
>;
/** Context for runtime agent project. */
export type RuntimeAgentProjectContext = InferSchema<
  ReturnType<typeof getRuntimeAgentProjectContextSchema>
>;
/** Public API contract for runtime agent validated claims. */
export type RuntimeAgentValidatedClaims = InferSchema<
  ReturnType<typeof getRuntimeAgentValidatedClaimsSchema>
>;
/** Context for runtime agent run. */
export type RuntimeAgentRunContext = InferSchema<
  ReturnType<typeof getRuntimeAgentRunContextSchema>
>;
/**
 * Public API contract for a signed runtime agent invocation.
 *
 * `credentials.authToken` authorizes control-plane and project operations.
 * `credentials.inferenceAuthToken`, when present, is separate run-scoped
 * authority for attributed Veryfront Cloud inference. Trusted runtime ingress
 * must keep that credential out of project callbacks, tools, logs, and durable
 * request payloads.
 */
export type RuntimeAgentRunInvocation = InferSchema<
  ReturnType<typeof getRuntimeAgentRunInvocationSchema>
>;

/** Request payload for runtime agent control plane stream. */
export type RuntimeAgentControlPlaneStreamRequest = {
  agentId: RuntimeAgentRunContext["agentId"];
  threadId: RuntimeAgentRunContext["conversationId"];
  runId: RuntimeAgentRunContext["runId"];
  messageId?: RuntimeAgentRunContext["messageId"];
  taskId?: string;
  parentRunId?: Exclude<RuntimeAgentRunContext["parentRunId"], null | undefined>;
  messages: RuntimeAgentRunInvocation["messages"];
  tools: RuntimeAgentRunInvocation["tools"];
  context: RuntimeAgentRunInvocation["context"];
  allowDelegation?: RuntimeAgentRunInvocation["allowDelegation"];
  runtimeTargetKind: NonNullable<RuntimeAgentProjectContext["runtimeTargetKind"]>;
  runtimeTargetEnvironmentId?: RuntimeAgentProjectContext["runtimeTargetEnvironmentId"];
  executionEnvironmentId?: RuntimeAgentProjectContext["executionEnvironmentId"];
  runtimeTargetBranchId?: RuntimeAgentProjectContext["runtimeTargetBranchId"];
  credentials?: RuntimeAgentRunInvocation["credentials"];
  agentSource: RuntimeAgentRunInvocation["agentSource"];
  sourceProject?: RuntimeAgentRunInvocation["sourceProject"];
  executionProject?: RuntimeAgentProjectContext;
  agentConfig?: RuntimeAgentRunInvocation["agentConfig"];
  forwardedProps?: RuntimeAgentRunInvocation["forwardedProps"];
  serverResolvedProviderReplayCheckpoints?: RuntimeAgentRunInvocation[
    "serverResolvedProviderReplayCheckpoints"
  ];
  serverResolvedTrustedHostedHistoryMessageIds?: RuntimeAgentRunInvocation[
    "serverResolvedTrustedHostedHistoryMessageIds"
  ];
  resumeToolCall?: RuntimeAgentRunInvocation["resumeToolCall"];
};

/** Builds runtime agent control plane stream request from invocation. */
export function buildRuntimeAgentControlPlaneStreamRequestFromInvocation(
  input: RuntimeAgentRunInvocation,
): RuntimeAgentControlPlaneStreamRequest {
  const sourceProject = input.sourceProject ?? input.run.project;
  return {
    agentId: input.run.agentId,
    threadId: input.run.conversationId,
    runId: input.run.runId,
    messageId: input.run.messageId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.run.parentRunId ? { parentRunId: input.run.parentRunId } : {}),
    messages: input.messages,
    tools: input.tools,
    context: input.context,
    ...(input.allowDelegation !== undefined ? { allowDelegation: input.allowDelegation } : {}),
    ...(input.sourceProject
      ? { sourceProject: input.sourceProject, executionProject: input.run.project }
      : {}),
    runtimeTargetKind: sourceProject.runtimeTargetKind ?? "main_branch",
    runtimeTargetEnvironmentId: sourceProject.runtimeTargetEnvironmentId ?? null,
    runtimeTargetBranchId: sourceProject.runtimeTargetBranchId ?? null,
    ...(sourceProject.executionEnvironmentId
      ? { executionEnvironmentId: sourceProject.executionEnvironmentId }
      : {}),
    ...(input.credentials ? { credentials: input.credentials } : {}),
    agentSource: input.agentSource,
    ...(input.agentConfig ? { agentConfig: input.agentConfig } : {}),
    ...(input.forwardedProps ? { forwardedProps: input.forwardedProps } : {}),
    ...(input.serverResolvedProviderReplayCheckpoints !== undefined
      ? { serverResolvedProviderReplayCheckpoints: input.serverResolvedProviderReplayCheckpoints }
      : {}),
    ...(input.serverResolvedTrustedHostedHistoryMessageIds !== undefined
      ? {
        serverResolvedTrustedHostedHistoryMessageIds:
          input.serverResolvedTrustedHostedHistoryMessageIds,
      }
      : {}),
    ...(input.resumeToolCall ? { resumeToolCall: input.resumeToolCall } : {}),
  };
}

/** Parses runtime agent run invocation. */
export async function parseRuntimeAgentRunInvocation(
  request: Request,
): Promise<RuntimeAgentRunInvocation> {
  return parseRuntimeAgentRunInvocationValue(await parseAgUiJsonBody(request));
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
