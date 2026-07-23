import type { Agent } from "#veryfront/agent";
import {
  createRemoteMCPToolSource,
  type RemoteToolSource,
  type ToolDefinition,
  toolRegistry,
} from "#veryfront/tool";
import type { RuntimeRemoteToolConfig } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { buildStudioMcpHeaders } from "#veryfront/agent/project/live-studio-mcp-tools.ts";
import {
  clientAllowsStudioMcp,
  resolveRuntimeClientProfile,
} from "#veryfront/agent/runtime/client-profile.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("runtime-agent-request-preparation");
const VERYFRONT_PLATFORM_REMOTE_TOOL_SOURCE_ID = "veryfront-platform-mcp";
const VERYFRONT_STUDIO_REMOTE_TOOL_SOURCE_ID = "veryfront-studio-mcp";
const STUDIO_RUNTIME_REMOTE_TOOL_NAMES = new Set<string>([
  "studio_suggestions",
  "studio_todo_write",
  "studio_panel_control",
  "studio_open_project",
  "studio_display_media",
  "studio_capture_screenshot",
]);
const LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES = new Set(["bash"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getForwardedAllowedRemoteToolNames(
  forwardedProps: Record<string, unknown> | undefined,
): string[] {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  const allowedTools = runtimeOverrides?.allowedTools;
  return Array.isArray(allowedTools) &&
      allowedTools.every((toolName) => typeof toolName === "string")
    ? allowedTools
    : [];
}

function getForwardedIntegrationToolNames(
  runtimeOverrides: Record<string, unknown>,
): Set<string> {
  const toolNames = new Set<string>();
  const serverResolvedTools = runtimeOverrides.serverResolvedIntegrationTools;
  if (Array.isArray(serverResolvedTools)) {
    for (const toolName of serverResolvedTools) {
      if (typeof toolName === "string" && toolName.length > 0) toolNames.add(toolName);
    }
  }
  const definitions = runtimeOverrides.integrationToolDefinitions;
  if (Array.isArray(definitions)) {
    for (const definition of definitions) {
      if (
        isRecord(definition) && typeof definition.name === "string" &&
        definition.name.length > 0
      ) {
        toolNames.add(definition.name);
      }
    }
  }
  return toolNames;
}

function sanitizeForwardedRuntimeAllowedTools(input: {
  forwardedProps?: Record<string, unknown>;
  availableToolNames: string[];
  allowStudioRuntimeTools: boolean;
}): Record<string, unknown> | undefined {
  if (!isRecord(input.forwardedProps)) return input.forwardedProps;
  const runtimeOverrides = isRecord(input.forwardedProps.runtimeOverrides)
    ? input.forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides || !Object.hasOwn(runtimeOverrides, "allowedTools")) {
    return input.forwardedProps;
  }
  const allowedTools = runtimeOverrides.allowedTools;
  if (
    !Array.isArray(allowedTools) ||
    !allowedTools.every((toolName) => typeof toolName === "string")
  ) {
    return input.forwardedProps;
  }

  const availableToolNames = new Set(input.availableToolNames);
  const integrationToolNames = getForwardedIntegrationToolNames(runtimeOverrides);
  const sanitizedAllowedTools = allowedTools.filter((toolName) =>
    availableToolNames.has(toolName) || integrationToolNames.has(toolName) ||
    (input.allowStudioRuntimeTools && STUDIO_RUNTIME_REMOTE_TOOL_NAMES.has(toolName))
  );
  if (sanitizedAllowedTools.length === allowedTools.length) return input.forwardedProps;

  const nextRuntimeOverrides: Record<string, unknown> = {
    ...runtimeOverrides,
    allowedTools: sanitizedAllowedTools,
  };
  if (sanitizedAllowedTools.length === 0) delete nextRuntimeOverrides.allowedTools;
  const nextForwardedProps: Record<string, unknown> = {
    ...input.forwardedProps,
    runtimeOverrides: nextRuntimeOverrides,
  };
  if (Object.keys(nextRuntimeOverrides).length === 0) {
    delete nextForwardedProps.runtimeOverrides;
  }
  return Object.keys(nextForwardedProps).length > 0 ? nextForwardedProps : undefined;
}

/** Remove forwarded tool grants that are not backed by this exact run. */
export function sanitizeRuntimeRunAgentInput(
  input: RuntimeRunAgentInput,
): RuntimeRunAgentInput {
  const clientProfile = resolveRuntimeClientProfile(input.forwardedProps);
  return {
    ...input,
    forwardedProps: sanitizeForwardedRuntimeAllowedTools({
      forwardedProps: input.forwardedProps,
      availableToolNames: input.tools.map((tool) => tool.name),
      allowStudioRuntimeTools: clientAllowsStudioMcp(clientProfile),
    }),
  };
}

function getRequestedUnresolvedBooleanToolNames(input: {
  agent: Agent;
  availableToolNames?: string[];
}): string[] {
  const availableToolNames = new Set(input.availableToolNames ?? []);
  const tools = input.agent.config.tools;
  if (!tools || tools === true) return [];
  return Object.entries(tools)
    .filter(([toolName, entry]) =>
      entry === true && !toolRegistry.get(toolName) &&
      !availableToolNames.has(toolName) &&
      !LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES.has(toolName)
    )
    .map(([toolName]) => toolName)
    .sort();
}

function getVeryfrontApiMcpPolicy(agent: Agent): {
  allowAll: boolean;
  requestedToolNames: string[];
  deniedToolNames: Set<string>;
} {
  const requestedToolNames = new Set<string>();
  const deniedToolNames = new Set<string>();
  let allowAll = false;
  for (const server of agent.config.mcpServers ?? []) {
    if (!("kind" in server) || server.kind !== "veryfront-api") continue;
    for (const toolName of server.toolPolicy?.deny ?? []) deniedToolNames.add(toolName);
    if (server.toolPolicy?.allow) {
      for (const toolName of server.toolPolicy.allow) requestedToolNames.add(toolName);
    } else {
      allowAll = true;
    }
  }
  return { allowAll, requestedToolNames: [...requestedToolNames], deniedToolNames };
}

function mergeAllowedRemoteTools(
  current: RuntimeRemoteToolConfig["__vfAllowedRemoteTools"],
  requestedToolNames: string[],
): string[] {
  const allowed = new Set(
    Array.isArray(current) && current.every((name) => typeof name === "string") ? current : [],
  );
  for (const name of requestedToolNames) allowed.add(name);
  return [...allowed].sort();
}

function createStaticRemoteToolSource(
  source: RemoteToolSource,
  definitions: ToolDefinition[],
): RemoteToolSource {
  return {
    id: source.id,
    listTools: async () => definitions,
    executeTool: (toolName, args, context) => source.executeTool(toolName, args, context),
  };
}

/** Attach the exact platform MCP surface requested by one agent definition. */
export async function withVeryfrontPlatformRemoteTools(input: {
  agent: Agent;
  apiUrl: string;
  token?: string | null;
  projectId?: string | null;
  availableToolNames?: string[];
}): Promise<Agent> {
  const policy = getVeryfrontApiMcpPolicy(input.agent);
  const requested = getRequestedUnresolvedBooleanToolNames(input)
    .concat(policy.requestedToolNames);
  if ((!policy.allowAll && requested.length === 0) || !input.token) return input.agent;

  const source = createRemoteMCPToolSource({
    id: VERYFRONT_PLATFORM_REMOTE_TOOL_SOURCE_ID,
    endpoint: `${input.apiUrl.replace(/\/$/, "")}/mcp`,
    headers: { Authorization: `Bearer ${input.token}` },
  });
  let definitions: ToolDefinition[] | null = null;
  try {
    definitions = await source.listTools(input.projectId ? { projectId: input.projectId } : {});
  } catch {
    logger.warn("Unable to discover Veryfront platform MCP tools", {
      failureCategory: "discovery-error",
    });
  }

  const availablePlatformNames = definitions
    ? new Set(definitions.map((definition) => definition.name))
    : null;
  const requestedPlatformNames = availablePlatformNames
    ? (policy.allowAll ? [...availablePlatformNames] : requested).filter((name) =>
      availablePlatformNames.has(name) && !policy.deniedToolNames.has(name)
    )
    : requested.filter((name) => !policy.deniedToolNames.has(name));
  if (requestedPlatformNames.length === 0) return input.agent;

  const runtimeConfig = input.agent.config as Agent["config"] & RuntimeRemoteToolConfig;
  const remoteTools = runtimeConfig.__vfRemoteToolSources ?? [];
  const hasSource = remoteTools.some((entry) =>
    entry.id === VERYFRONT_PLATFORM_REMOTE_TOOL_SOURCE_ID
  );
  const config: Agent["config"] & RuntimeRemoteToolConfig = {
    ...input.agent.config,
    __vfAllowedRemoteTools: mergeAllowedRemoteTools(
      runtimeConfig.__vfAllowedRemoteTools,
      requestedPlatformNames,
    ),
    __vfRemoteToolSources: [
      ...remoteTools,
      ...(hasSource
        ? []
        : [definitions ? createStaticRemoteToolSource(source, definitions) : source]),
    ],
  };
  return {
    ...input.agent,
    config,
  };
}

function getRequestedStudioToolNames(input: {
  forwardedProps?: Record<string, unknown>;
  availableToolNames?: string[];
}): string[] {
  const requested = new Set([
    ...getForwardedAllowedRemoteToolNames(input.forwardedProps),
    ...(input.availableToolNames ?? []),
  ]);
  return [...requested].filter((name) => STUDIO_RUNTIME_REMOTE_TOOL_NAMES.has(name)).sort();
}

/** Attach the Studio MCP surface only for a trusted Studio client profile. */
export function withVeryfrontStudioRemoteTools(input: {
  agent: Agent;
  studioMcpUrl?: string | null;
  token?: string | null;
  projectId?: string | null;
  forwardedProps?: Record<string, unknown>;
  availableToolNames?: string[];
  conversationId?: string;
}): Agent {
  const clientProfile = resolveRuntimeClientProfile(input.forwardedProps);
  const requested = getRequestedStudioToolNames(input);
  if (
    !input.token || !input.studioMcpUrl || !clientAllowsStudioMcp(clientProfile) ||
    requested.length === 0
  ) return input.agent;

  const runtimeConfig = input.agent.config as Agent["config"] & RuntimeRemoteToolConfig;
  const remoteTools = runtimeConfig.__vfRemoteToolSources ?? [];
  const hasSource = remoteTools.some((entry) =>
    entry.id === VERYFRONT_STUDIO_REMOTE_TOOL_SOURCE_ID
  );
  const config: Agent["config"] & RuntimeRemoteToolConfig = {
    ...input.agent.config,
    __vfAllowedRemoteTools: mergeAllowedRemoteTools(
      runtimeConfig.__vfAllowedRemoteTools,
      requested,
    ),
    __vfRemoteToolSources: [
      ...remoteTools,
      ...(hasSource ? [] : [createRemoteMCPToolSource({
        id: VERYFRONT_STUDIO_REMOTE_TOOL_SOURCE_ID,
        endpoint: input.studioMcpUrl,
        headers: () =>
          buildStudioMcpHeaders(
            input.token ?? "",
            input.projectId ?? null,
            input.conversationId,
          ),
      })]),
    ],
  };
  return {
    ...input.agent,
    config,
  };
}
