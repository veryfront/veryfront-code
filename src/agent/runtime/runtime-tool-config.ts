import type { ToolDefinition } from "#veryfront/tool";
import type { AgentConfig } from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";
import { resolveEffectiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { type SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  isSupportedToolExposureCheckpointVersion,
  isValidToolExposureCheckpointName,
  type ToolExposureCheckpoint,
} from "./tool-exposure.ts";
import { type ProviderReplayCheckpoint } from "./provider-replay.ts";

const ArrayIsArray = Array.isArray;

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

export type RuntimeToolFilterConfig = AgentConfig & {
  __vfForwardedIntegrationToolDefs?: Array<
    { name: string; description: string; parameters: Record<string, unknown> }
  >;
  __vfToolExposureCheckpoint?: ToolExposureCheckpoint;
  __vfProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
  __vfProviderReplayCheckpointMessageId?: string;
  __vfPersistProviderReplayCheckpoint?: (
    checkpoint: ProviderReplayCheckpoint,
  ) => void | Promise<void>;
  __vfProviderReplayCheckpointTurnComplete?: () => void | Promise<void>;
  __vfProviderReplayCheckpointTurnFailed?: () => void | Promise<void>;
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
  provenance: "host-operational-override" | "host-runtime-binding" | "tools-selector";
};

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
    return {
      mode: hostRuntimeMode,
      provenance: "host-runtime-binding",
    };
  }
  return {
    mode: config.tools === true ? "deferred" : "eager",
    provenance: "tools-selector",
  };
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
): (() => void | Promise<void>) | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfProviderReplayCheckpointTurnComplete;
  return typeof value === "function" ? value : undefined;
}

/** Return the trusted hook that aborts one provider response boundary. */
export function getRuntimeProviderReplayCheckpointTurnFailed(
  config: AgentConfig,
): (() => void | Promise<void>) | undefined {
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
