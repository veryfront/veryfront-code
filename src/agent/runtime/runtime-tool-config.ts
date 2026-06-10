import type { ToolDefinition } from "#veryfront/tool";
import type { AgentConfig } from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";

export type RuntimeToolFilterConfig = AgentConfig & {
  __vfForwardedIntegrationToolDefs?: Array<
    { name: string; description: string; parameters: Record<string, unknown> }
  >;
} & RuntimeRemoteToolConfig;

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
