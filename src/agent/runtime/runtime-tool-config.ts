import { appendPrivateArray } from "#veryfront/security/private-array.ts";
import type { ToolDefinition } from "#veryfront/tool";
import type { AgentConfig } from "../types.ts";
import { defineSchema } from "#veryfront/schemas";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";
import { resolveEffectiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { type SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  isSupportedToolExposureCheckpointVersion,
  isValidToolExposureCheckpointName,
  TOOL_SEARCH_TOOL_NAME,
  type ToolExposureCheckpoint,
} from "./tool-exposure.ts";
import { type ProviderReplayCheckpoint } from "./provider-replay.ts";

const ArrayIsArray = Array.isArray;
const NativeSet = Set;
const SetAdd = Set.prototype.add;
const SetHas = Set.prototype.has;
const reflectApply = Reflect.apply;

function snapshotStringArray(value: unknown): string[] | undefined {
  if (!ArrayIsArray(value)) return undefined;
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (typeof entry !== "string") return undefined;
    snapshot[snapshot.length] = entry;
  }
  return snapshot;
}

/** Internal schema-loading mode derived from the authored tools selector. */
export type RuntimeToolLoadingMode = "eager" | "deferred";

export const SOURCE_INTEGRATION_POLICY_CONTEXT_KEY = "__vfSourceIntegrationPolicy";

/**
 * Sanitized cause handed to the replay turn failure hook.
 *
 * Only the already-sanitized `{message, code}` pair that the runtime sends on
 * the stream crosses this boundary. The raw provider error never does.
 */
export type ProviderReplayTurnFailure = {
  message: string;
  code?: string;
};

export const MAX_PROVIDER_REPLAY_INVOKE_AGENT_TOOL_CALLS = 100;
export const MAX_PROVIDER_REPLAY_TOOL_CALL_ID_LENGTH = 128;
export const MAX_PROVIDER_REPLAY_TOOL_ARGS_JSON_LENGTH = 512 * 1_024;

function hasUniqueProviderReplayToolCallIds(
  calls: readonly { toolCallId: string }[],
): boolean {
  const ids = new NativeSet<string>();
  for (let index = 0; index < calls.length; index++) {
    const toolCallId = calls[index]?.toolCallId;
    if (!toolCallId || reflectApply(SetHas, ids, [toolCallId]) as boolean) return false;
    reflectApply(SetAdd, ids, [toolCallId]);
  }
  return true;
}

/** Private all-of dispatch snapshot for one completed provider turn. */
export const getProviderReplayInvokeAgentToolCallsSchema = defineSchema((v) =>
  v.array(
    v.object({
      toolCallId: v.string().min(1).max(MAX_PROVIDER_REPLAY_TOOL_CALL_ID_LENGTH),
      toolName: v.union([
        v.literal("invoke_agent"),
        v.literal("veryfront__invoke_agent"),
      ]),
      toolArgsJson: v.string().min(1).max(MAX_PROVIDER_REPLAY_TOOL_ARGS_JSON_LENGTH),
    }),
  ).min(2).max(MAX_PROVIDER_REPLAY_INVOKE_AGENT_TOOL_CALLS).refine(
    hasUniqueProviderReplayToolCallIds,
    { message: "invoke_agent tool call ids must be unique within one provider turn" },
  )
);

export type ProviderReplayInvokeAgentToolCall = InferSchema<
  ReturnType<typeof getProviderReplayInvokeAgentToolCallsSchema>
>[number];
export type ProviderReplayInvokeAgentToolName = ProviderReplayInvokeAgentToolCall["toolName"];

export type RuntimeToolFilterConfig = AgentConfig & {
  __vfForwardedIntegrationToolDefs?: Array<
    { name: string; description: string; parameters: Record<string, unknown> }
  >;
  __vfToolExposureCheckpoint?: ToolExposureCheckpoint;
  __vfProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
  __vfProviderReplayCheckpointMessageId?: string;
  __vfProviderReplayInvokeAgentToolNames?: ProviderReplayInvokeAgentToolName[];
  __vfPersistProviderReplayCheckpoint?: (
    checkpoint: ProviderReplayCheckpoint,
  ) => void | Promise<void>;
  __vfProviderReplayCheckpointTurnComplete?: (
    invokeAgentToolCalls?: ProviderReplayInvokeAgentToolCall[],
  ) => void | Promise<void>;
  __vfProviderReplayCheckpointTurnFailed?: (
    failure?: ProviderReplayTurnFailure,
  ) => void | Promise<void>;
  __vfProviderReplayCheckpointPersistenceRequired?: boolean;
  __vfPersistToolExposureCheckpoint?: (
    checkpoint: ToolExposureCheckpoint,
  ) => void | Promise<void>;
  __vfToolExposureCheckpointPersistenceRequired?: boolean;
  __vfToolLoadingMode?: RuntimeToolLoadingMode;
  __vfOperationalToolLoadingOverride?: "eager";
  __vfPreassembledSkillContext?: boolean;
} & RuntimeRemoteToolConfig;

/** Effective runtime loading mode and the trusted source that selected it. */
export type RuntimeToolLoadingResolution = {
  mode: RuntimeToolLoadingMode;
  provenance:
    | "host-operational-override"
    | "host-runtime-binding"
    | "authored-tool-loading"
    | "tools-selector";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolSearchDenied(config: AgentConfig): boolean {
  const deniedTools = (config as { deniedTools?: unknown }).deniedTools;
  if (ArrayIsArray(deniedTools) && deniedTools.includes(TOOL_SEARCH_TOOL_NAME)) {
    return true;
  }
  return isRecord(config.tools) && config.tools[TOOL_SEARCH_TOOL_NAME] === false;
}

function resolveToolLoadingWithDenials(
  config: AgentConfig,
  mode: RuntimeToolLoadingMode,
  provenance: RuntimeToolLoadingResolution["provenance"],
): RuntimeToolLoadingResolution {
  return {
    mode: mode === "deferred" && isToolSearchDenied(config) ? "eager" : mode,
    provenance,
  };
}

/** Resolve tool loading without accepting request context as configuration. */
export function resolveRuntimeToolLoading(
  config: AgentConfig,
): RuntimeToolLoadingResolution {
  const operationalOverride =
    (config as RuntimeToolFilterConfig).__vfOperationalToolLoadingOverride;
  if (operationalOverride === "eager") {
    return {
      mode: operationalOverride,
      provenance: "host-operational-override",
    };
  }
  const hostRuntimeMode = (config as RuntimeToolFilterConfig).__vfToolLoadingMode;
  if (hostRuntimeMode === "eager" || hostRuntimeMode === "deferred") {
    return resolveToolLoadingWithDenials(config, hostRuntimeMode, "host-runtime-binding");
  }
  const authoredToolLoading = config.toolLoading;
  if (authoredToolLoading === "eager" || authoredToolLoading === "deferred") {
    return resolveToolLoadingWithDenials(config, authoredToolLoading, "authored-tool-loading");
  }
  return resolveToolLoadingWithDenials(
    config,
    config.tools === true ? "deferred" : "eager",
    "tools-selector",
  );
}

export function getRuntimeAllowedRemoteTools(config: AgentConfig): string[] | undefined {
  const configWithRuntimeFilters = config as RuntimeToolFilterConfig;
  if (!Object.hasOwn(configWithRuntimeFilters, "__vfAllowedRemoteTools")) {
    return undefined;
  }
  const raw = configWithRuntimeFilters.__vfAllowedRemoteTools;
  return snapshotStringArray(raw) ?? [];
}

/** Return trusted run-scoped source policy; malformed internal state fails closed. */
export function getRuntimeSourceIntegrationPolicy(
  config: AgentConfig,
): SourceIntegrationPolicyManifest | undefined {
  return resolveEffectiveSourceIntegrationPolicy(
    (config as RuntimeToolFilterConfig).__vfSourceIntegrationPolicy,
  );
}

/** Read source policy stamped by the parent runtime into a tool execution context. */
export function getRuntimeSourceIntegrationPolicyFromContext(
  context: Record<string, unknown> | undefined,
): SourceIntegrationPolicyManifest | undefined {
  return resolveEffectiveSourceIntegrationPolicy(
    context?.[SOURCE_INTEGRATION_POLICY_CONTEXT_KEY],
  );
}

export function getRuntimeProviderTools(config: AgentConfig): string[] {
  return snapshotStringArray(config.providerTools) ?? [];
}

/** Return a supported trusted private exposure checkpoint. */
export function getRuntimeToolExposureCheckpoint(
  config: AgentConfig,
): ToolExposureCheckpoint | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfToolExposureCheckpoint;
  if (
    !isSupportedToolExposureCheckpointVersion(value?.version) ||
    !Array.isArray(value.loadedToolNames) ||
    !value.loadedToolNames.every(isValidToolExposureCheckpointName)
  ) {
    return undefined;
  }
  return value;
}

/**
 * Return the provider replay checkpoints the trusted host resolved for this run.
 *
 * The delivery is parsed and asserted reconstructible at request preparation;
 * `applyProviderReplayCheckpointsToMessages` re-asserts before use.
 */
export function getRuntimeProviderReplayCheckpoints(
  config: AgentConfig,
): readonly ProviderReplayCheckpoint[] | undefined {
  return (config as RuntimeToolFilterConfig).__vfProviderReplayCheckpoints;
}

/** Return the trusted durable assistant message id used for emitted replay state. */
export function getRuntimeProviderReplayCheckpointMessageId(
  config: AgentConfig,
): string | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfProviderReplayCheckpointMessageId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Return the trusted control-plane delegation names active for this run. */
export function getRuntimeProviderReplayInvokeAgentToolNames(
  config: AgentConfig,
): ProviderReplayInvokeAgentToolName[] {
  const value = (config as RuntimeToolFilterConfig).__vfProviderReplayInvokeAgentToolNames;
  if (!ArrayIsArray(value)) return [];
  const names: ProviderReplayInvokeAgentToolName[] = [];
  for (let index = 0; index < value.length; index++) {
    const name = value[index];
    let alreadyIncluded = false;
    for (let nameIndex = 0; nameIndex < names.length; nameIndex++) {
      if (names[nameIndex] === name) {
        alreadyIncluded = true;
        break;
      }
    }
    if (
      (name === "invoke_agent" || name === "veryfront__invoke_agent") &&
      !alreadyIncluded
    ) {
      appendPrivateArray(names, [name]);
    }
  }
  return names;
}

/** Return the trusted private provider replay checkpoint persistence hook. */
export function getRuntimeProviderReplayCheckpointPersister(
  config: AgentConfig,
): ((checkpoint: ProviderReplayCheckpoint) => void | Promise<void>) | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfPersistProviderReplayCheckpoint;
  return typeof value === "function" ? value : undefined;
}

/** Return the trusted hook that closes one provider response boundary. */
export function getRuntimeProviderReplayCheckpointTurnComplete(
  config: AgentConfig,
):
  | (
    (invokeAgentToolCalls?: ProviderReplayInvokeAgentToolCall[]) => void | Promise<void>
  )
  | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfProviderReplayCheckpointTurnComplete;
  return typeof value === "function" ? value : undefined;
}

/** Return the trusted hook that aborts one provider response boundary. */
export function getRuntimeProviderReplayCheckpointTurnFailed(
  config: AgentConfig,
): ((failure?: ProviderReplayTurnFailure) => void | Promise<void>) | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfProviderReplayCheckpointTurnFailed;
  return typeof value === "function" ? value : undefined;
}

/** Return whether provider replay state must be durable before continuation. */
export function isRuntimeProviderReplayCheckpointPersistenceRequired(
  config: AgentConfig,
): boolean {
  return (config as RuntimeToolFilterConfig).__vfProviderReplayCheckpointPersistenceRequired ===
    true;
}

/** Return whether the trusted host requires checkpoint durability before continuation. */
export function isRuntimeToolExposureCheckpointPersistenceRequired(
  config: AgentConfig,
): boolean {
  return (config as RuntimeToolFilterConfig).__vfToolExposureCheckpointPersistenceRequired === true;
}

/** Return the trusted private checkpoint persistence hook. */
export function getRuntimeToolExposureCheckpointPersister(
  config: AgentConfig,
): ((checkpoint: ToolExposureCheckpoint) => void | Promise<void>) | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfPersistToolExposureCheckpoint;
  return typeof value === "function" ? value : undefined;
}

export function getRuntimeForwardedIntegrationToolDefs(
  config: AgentConfig,
): ToolDefinition[] | undefined {
  const configWithFilters = config as RuntimeToolFilterConfig;
  const raw = configWithFilters.__vfForwardedIntegrationToolDefs;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter(
      (def): def is { name: string; description: string; parameters: Record<string, unknown> } =>
        typeof def === "object" &&
        def !== null &&
        typeof def.name === "string" &&
        typeof def.description === "string",
    )
    .map((def) => ({
      name: def.name,
      description: def.description,
      parameters: typeof def.parameters === "object" && def.parameters !== null &&
          !Array.isArray(def.parameters)
        ? def.parameters
        : { type: "object", properties: {} },
    }));
}
