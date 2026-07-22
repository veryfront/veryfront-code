import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolDefinition,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { AGENT_ERROR, PERMISSION_DENIED } from "#veryfront/errors";
import {
  type AgentServiceMcpServerConfig,
  createAgentServiceRemoteMcpConfig,
  defaultAgentServiceMcpServers,
} from "../service/mcp-server-config.ts";
import {
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxTools,
} from "#veryfront/sandbox";
import {
  createLiveStudioMcpTools,
  type LiveStudioMcpToolsOptions,
} from "../project/live-studio-mcp-tools.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import {
  type HostedChildProjectSwitchHandler,
  wrapHostedChildProjectSwitchTool,
} from "./child-steering-tools.ts";
import {
  buildDefaultHostedChildForkToolSet,
  type DefaultHostedChildForkToolAssemblySourceResult,
} from "./child-requested-tools.ts";
import { filterVeryfrontApiToolDefinitionsWithAccessProfile } from "./veryfront-api-tool-access.ts";
import { createHostedMcpToolPolicySource } from "./project-remote-tool-source.ts";
import type { AgentMcpToolPolicy } from "../types.ts";

/** Public API contract for hosted child fork tool sources logger. */
export type HostedChildForkToolSourcesLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Input payload for prepare default hosted child fork tool sources. */
export type PrepareDefaultHostedChildForkToolSourcesInput = {
  authToken: string;
  apiMcpUrl: string;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  getProjectId: () => string | null | undefined;
  studioMcpUrl?: string | null;
  clientProfile?: RuntimeClientProfile | null;
  conversationId?: string;
  globalTools?: HostToolSet;
  abortSignal?: AbortSignal;
  onConfirmedStudioProjectSwitch?: HostedChildProjectSwitchHandler;
  createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  createToolsFromRemoteDefinitions?: typeof createToolsFromRemoteDefinitions;
  createLiveStudioTools?: (input: LiveStudioMcpToolsOptions) => Promise<{
    tools: HostToolSet;
    close: () => Promise<void>;
  }>;
  isAbortError?: (error: unknown) => boolean;
  logger?: HostedChildForkToolSourcesLogger;
};

/** Result returned from default hosted child fork tool sources. */
export type DefaultHostedChildForkToolSourcesResult =
  | {
    ok: true;
    forkTools: HostToolSet;
    closeStudioMcpTools?: () => Promise<void>;
  }
  | {
    ok: false;
    errorMessage: string;
  };

/** Input payload for prepare default hosted child fork sandbox tool sources. */
export type PrepareDefaultHostedChildForkSandboxToolSourcesInput =
  & PrepareDefaultHostedChildForkToolSourcesInput
  & {
    apiUrl: string;
    createBashTool: AgentServiceSandboxToolsOptions["createBashTool"];
    createAgentServiceSandboxTools?: (
      input: AgentServiceSandboxToolsOptions,
    ) => Promise<AgentServiceSandboxToolsResult>;
  };

function isMcpToolAllowed(toolName: string, policy: AgentMcpToolPolicy | undefined): boolean {
  if (policy?.deny?.includes(toolName)) {
    return false;
  }

  return policy?.allow ? policy.allow.includes(toolName) : true;
}

function filterHostToolsByMcpPolicy(
  tools: HostToolSet,
  policy: AgentMcpToolPolicy | undefined,
): HostToolSet {
  if (!policy?.allow && !policy?.deny) {
    return tools;
  }

  return Object.fromEntries(
    Object.entries(tools)
      .filter(([toolName]) => isMcpToolAllowed(toolName, policy))
      .map(([toolName, toolDefinition]) => [
        toolName,
        {
          ...toolDefinition,
          execute: toolDefinition.execute
            ? (toolInput: unknown, execOptions?: ToolExecutionContext) => {
              if (!isMcpToolAllowed(toolName, policy)) {
                throw PERMISSION_DENIED.create({
                  detail: `Tool "${toolName}" is not allowed for this MCP server`,
                });
              }

              return toolDefinition.execute?.(toolInput, execOptions);
            }
            : toolDefinition.execute,
        },
      ]),
  );
}

function filterToolDefinitionsByMcpPolicy(
  definitions: readonly ToolDefinition[],
  policy: AgentMcpToolPolicy | undefined,
): ToolDefinition[] {
  if (!policy?.allow && !policy?.deny) {
    return [...definitions];
  }

  return definitions.filter((definition) => isMcpToolAllowed(definition.name, policy));
}

/** Prepare default hosted child fork tool sources. */
export async function prepareDefaultHostedChildForkToolSources(
  input: PrepareDefaultHostedChildForkToolSourcesInput,
): Promise<DefaultHostedChildForkToolSourcesResult> {
  throwIfAborted(input.abortSignal);

  let closeStudioMcpTools: (() => Promise<void>) | undefined;
  let studioMcpTools: HostToolSet = {};
  let remoteMcpTools: HostToolSet = {};
  const createLiveStudioTools = input.createLiveStudioTools ?? createLiveStudioMcpTools;
  const createRemoteToolSource = input.createRemoteToolSource ?? createRemoteMCPToolSource;
  const materializeRemoteTools = input.createToolsFromRemoteDefinitions ??
    createToolsFromRemoteDefinitions;

  try {
    const mcpServers = input.mcpServers ?? defaultAgentServiceMcpServers();
    for (const server of mcpServers) {
      if (server.kind === "veryfront-studio") {
        const studioTools = await createLiveStudioTools({
          authToken: input.authToken,
          clientProfile: input.clientProfile,
          getProjectId: input.getProjectId,
          studioMcpUrl: input.studioMcpUrl,
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          ...(input.createRemoteToolSource
            ? { createRemoteToolSource: input.createRemoteToolSource }
            : {}),
        });
        const policyTools = filterHostToolsByMcpPolicy(studioTools.tools, server.toolPolicy);
        studioMcpTools = {
          ...studioMcpTools,
          ...policyTools,
        };
        closeStudioMcpTools = studioTools.close;
        continue;
      }

      const remoteConfig = createAgentServiceRemoteMcpConfig({
        server,
        authToken: input.authToken,
        apiMcpUrl: input.apiMcpUrl,
        defaultSourceId: "veryfront-mcp-fork",
      });
      if (!remoteConfig) {
        continue;
      }
      const rawSource = createRemoteToolSource(remoteConfig);
      const policySource = createHostedMcpToolPolicySource(rawSource, server.toolPolicy);
      const rawDefinitions = await rawSource.listTools();
      const accessFilteredDefinitions = server.kind === "veryfront-api"
        ? await filterVeryfrontApiToolDefinitionsWithAccessProfile({
          source: rawSource,
          toolDefinitions: rawDefinitions,
          projectId: input.getProjectId() ?? null,
        })
        : rawDefinitions;
      const definitions = filterToolDefinitionsByMcpPolicy(
        accessFilteredDefinitions,
        server.toolPolicy,
      );
      remoteMcpTools = {
        ...remoteMcpTools,
        ...materializeRemoteTools(policySource, definitions),
      };
    }
  } catch (error) {
    if (input.abortSignal?.aborted || input.isAbortError?.(error)) {
      throw error;
    }

    input.logger?.error("Failed to initialize MCP tool sources for child fork", {
      mcpError: error,
    });
    return {
      ok: false,
      errorMessage: `MCP tool setup failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }

  throwIfAborted(input.abortSignal);

  if (input.onConfirmedStudioProjectSwitch) {
    wrapHostedChildProjectSwitchTool({
      tools: studioMcpTools,
      onConfirmedProjectSwitch: input.onConfirmedStudioProjectSwitch,
    });
  }

  throwIfAborted(input.abortSignal);

  return {
    ok: true,
    forkTools: buildDefaultHostedChildForkToolSet(
      remoteMcpTools,
      studioMcpTools,
      input.globalTools ?? {},
    ),
    closeStudioMcpTools,
  };
}

/** Prepare default hosted child fork sandbox tool sources. */
export async function prepareDefaultHostedChildForkSandboxToolSources(
  input: PrepareDefaultHostedChildForkSandboxToolSourcesInput,
): Promise<DefaultHostedChildForkToolAssemblySourceResult> {
  const {
    apiUrl,
    createBashTool,
    createAgentServiceSandboxTools: createAgentServiceSandboxToolsOverride,
    globalTools,
    ...toolSourceInput
  } = input;
  const createSandboxTools = createAgentServiceSandboxToolsOverride ??
    createAgentServiceSandboxTools;
  const sandboxResult = await createSandboxTools({
    authToken: input.authToken,
    apiUrl,
    getProjectId: input.getProjectId,
    createBashTool,
  });
  const mergedGlobalTools = {
    ...(globalTools ?? {}),
    ...sandboxResult.tools,
  };

  try {
    const toolSources = await prepareDefaultHostedChildForkToolSources({
      ...toolSourceInput,
      globalTools: mergedGlobalTools,
    });
    if (!toolSources.ok) {
      try {
        await sandboxResult.closeSandbox();
      } catch (closeError) {
        input.logger?.error("Failed to close sandbox during child fork tool source cleanup", {
          errorName: closeError instanceof Error ? closeError.name : typeof closeError,
        });
      }
      return toolSources;
    }

    return {
      ok: true,
      forkTools: toolSources.forkTools,
      closeRuntime: sandboxResult.closeSandbox,
      closeTooling: toolSources.closeStudioMcpTools,
    };
  } catch (error) {
    // Never let a close failure mask the original error that triggered cleanup.
    try {
      await sandboxResult.closeSandbox();
    } catch (closeError) {
      input.logger?.error("Failed to close sandbox during child fork tool source cleanup", {
        errorName: closeError instanceof Error ? closeError.name : typeof closeError,
      });
    }
    throw error;
  }
}

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
  if (!abortSignal?.aborted) {
    return;
  }

  const reason = abortSignal.reason;
  if (reason instanceof Error) {
    throw reason;
  }

  throw AGENT_ERROR.create({ detail: "Child fork aborted" });
}
