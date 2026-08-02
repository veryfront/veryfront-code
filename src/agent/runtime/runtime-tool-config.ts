import type { ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig } from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";
import { resolveEffectiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { type SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  isSupportedToolExposureCheckpointVersion,
  isValidToolExposureCheckpointName,
  type ToolExposureCheckpoint,
} from "./tool-exposure.ts";

/** Internal schema-loading mode derived from the authored tools selector. */
export type RuntimeToolLoadingMode = "eager" | "deferred";

export const SOURCE_INTEGRATION_POLICY_CONTEXT_KEY = "__vfSourceIntegrationPolicy";

/** Host-owned credential identity resolved at one tool-execution boundary. */
export type RuntimeToolExecutionIdentity = Pick<
  ToolExecutionContext,
  "authToken" | "projectId" | "projectSlug"
>;

export type RuntimeToolFilterConfig = AgentConfig & {
  __vfForwardedIntegrationToolDefs?: Array<
    { name: string; description: string; parameters: Record<string, unknown> }
  >;
  /**
   * Internal host boundary for context that can change between sibling tool
   * calls in one model response. Kept out of AgentConfig so application-facing
   * runtime-state semantics remain step-based. The resolver receives no base
   * context and can therefore only contribute the narrow identity it returns.
   */
  __vfResolveToolExecutionContext?: () =>
    | RuntimeToolExecutionIdentity
    | Promise<RuntimeToolExecutionIdentity>;
  __vfToolExposureCheckpoint?: ToolExposureCheckpoint;
  __vfPersistToolExposureCheckpoint?: (
    checkpoint: ToolExposureCheckpoint,
  ) => void | Promise<void>;
  __vfToolExposureCheckpointPersistenceRequired?: boolean;
  __vfToolLoadingMode?: RuntimeToolLoadingMode;
  __vfOperationalToolLoadingOverride?: "eager";
} & RuntimeRemoteToolConfig;

/**
 * Atomically replace the credential identity without allowing a resolver to
 * alter unrelated execution capabilities such as abort or source policy.
 */
export function applyRuntimeToolExecutionIdentity(
  context: ToolExecutionContext,
  identity: RuntimeToolExecutionIdentity,
): ToolExecutionContext {
  const nextContext = { ...context };
  for (const key of ["authToken", "projectId", "projectSlug"] as const) {
    if (Object.hasOwn(identity, key)) {
      nextContext[key] = identity[key];
    } else {
      delete nextContext[key];
    }
  }
  return nextContext;
}

/**
 * Resolve host-owned context immediately before executing one tool.
 *
 * Hosts that do not opt into the internal boundary retain the exact context
 * object and behavior used before this hook was introduced.
 */
export async function resolveRuntimeToolExecutionContext(
  config: AgentConfig,
  context: ToolExecutionContext,
): Promise<ToolExecutionContext> {
  const resolver = (config as RuntimeToolFilterConfig).__vfResolveToolExecutionContext;
  if (!resolver) {
    return context;
  }

  const identity = await resolver();
  return applyRuntimeToolExecutionIdentity(context, identity);
}

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
