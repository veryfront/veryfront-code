import type { ToolDefinition } from "#veryfront/tool";
import type { AgentConfig, ToolLoading } from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";
import { resolveEffectiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { type SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { ToolExposureCheckpoint, ToolSearchAuthorization } from "./tool-exposure.ts";
import { resolveToolLoading } from "./agent-definition.ts";
import { resolveProviderReplayProvider } from "./provider-replay.ts";

export const SOURCE_INTEGRATION_POLICY_CONTEXT_KEY = "__vfSourceIntegrationPolicy";

export type RuntimeToolFilterConfig = AgentConfig & {
  __vfForwardedIntegrationToolDefs?: Array<
    { name: string; description: string; parameters: Record<string, unknown> }
  >;
  __vfToolSearchAuthorization?: ToolSearchAuthorization;
  __vfToolExposureCheckpoint?: ToolExposureCheckpoint;
  __vfPersistToolExposureCheckpoint?: (
    checkpoint: ToolExposureCheckpoint,
  ) => void | Promise<void>;
  __vfOperationalToolLoadingOverride?: ToolLoading;
  __vfNativeProviderToolSearchEnabled?: boolean;
} & RuntimeRemoteToolConfig;

/** Effective runtime loading mode and the trusted source that selected it. */
export type RuntimeToolLoadingResolution = {
  mode: ToolLoading;
  provenance: "host-operational-override" | "eval-override" | "agent-config";
};

/** Resolve tool loading without accepting request context as configuration. */
export function resolveRuntimeToolLoading(
  config: AgentConfig,
  evalOverride?: ToolLoading,
): RuntimeToolLoadingResolution {
  const operationalOverride =
    (config as RuntimeToolFilterConfig).__vfOperationalToolLoadingOverride;
  if (operationalOverride === "eager" || operationalOverride === "deferred") {
    return {
      mode: operationalOverride,
      provenance: "host-operational-override",
    };
  }
  if (evalOverride === "eager" || evalOverride === "deferred") {
    return { mode: evalOverride, provenance: "eval-override" };
  }
  return {
    mode: resolveToolLoading(config.toolLoading),
    provenance: "agent-config",
  };
}

/** Select provider-native tool search only when the trusted host rollout explicitly enables it. */
export function resolveRuntimeNativeToolSearch(
  config: AgentConfig,
  model: string,
  authorization: ToolSearchAuthorization,
): { mode: "hosted"; variant?: "regex" } | undefined {
  if (
    (config as RuntimeToolFilterConfig).__vfNativeProviderToolSearchEnabled !== true ||
    authorization.canConfigureAgentTools
  ) {
    return undefined;
  }
  const provider = resolveProviderReplayProvider(model);
  if (provider === "anthropic") {
    return { mode: "hosted", variant: "regex" };
  }
  if (provider === "openai-responses") {
    return { mode: "hosted" };
  }
  return undefined;
}

export function getRuntimeAllowedRemoteTools(config: AgentConfig): string[] | undefined {
  const configWithRuntimeFilters = config as RuntimeToolFilterConfig;
  if (!Object.hasOwn(configWithRuntimeFilters, "__vfAllowedRemoteTools")) {
    return undefined;
  }
  const raw = configWithRuntimeFilters.__vfAllowedRemoteTools;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.every((toolName) => typeof toolName === "string") ? raw : [];
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
  const raw = config.providerTools;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.every((toolName) => typeof toolName === "string") ? raw : [];
}

/** Return trusted host-derived metadata discovery authorization. */
export function getRuntimeToolSearchAuthorization(
  config: AgentConfig,
): ToolSearchAuthorization {
  const value = (config as RuntimeToolFilterConfig).__vfToolSearchAuthorization;
  if (
    value?.canConfigureAgentTools !== true ||
    !Array.isArray(value.attachableCatalog) ||
    !value.attachableCatalog.every((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.name === "string" &&
      typeof entry.description === "string" &&
      entry.attachVia === "tool_ids"
    )
  ) {
    return { canConfigureAgentTools: false, attachableCatalog: [] };
  }
  return value;
}

/** Return a supported trusted private exposure checkpoint. */
export function getRuntimeToolExposureCheckpoint(
  config: AgentConfig,
): ToolExposureCheckpoint | undefined {
  const value = (config as RuntimeToolFilterConfig).__vfToolExposureCheckpoint;
  if (
    value?.version !== 1 ||
    typeof value.authorizedCatalogFingerprint !== "string" ||
    !Array.isArray(value.loadedToolNames) ||
    !value.loadedToolNames.every((name) => typeof name === "string")
  ) {
    return undefined;
  }
  return value;
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
