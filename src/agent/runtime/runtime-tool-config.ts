import type { ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig } from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";
import { resolveEffectiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { type SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";

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
