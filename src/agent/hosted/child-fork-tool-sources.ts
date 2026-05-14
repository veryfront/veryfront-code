import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
} from "#veryfront/tool";
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
} from "../live-studio-mcp-tools.ts";
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

export type HostedChildForkToolSourcesLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

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

export type PrepareDefaultHostedChildForkSandboxToolSourcesInput =
  & PrepareDefaultHostedChildForkToolSourcesInput
  & {
    apiUrl: string;
    createBashTool: AgentServiceSandboxToolsOptions["createBashTool"];
    createAgentServiceSandboxTools?: (
      input: AgentServiceSandboxToolsOptions,
    ) => Promise<AgentServiceSandboxToolsResult>;
  };

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
        studioMcpTools = {
          ...studioMcpTools,
          ...studioTools.tools,
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
      const remoteSource = createRemoteToolSource(remoteConfig);
      const rawDefinitions = await remoteSource.listTools();
      const definitions = server.kind === "veryfront-api"
        ? await filterVeryfrontApiToolDefinitionsWithAccessProfile({
          source: remoteSource,
          toolDefinitions: rawDefinitions,
          projectId: input.getProjectId() ?? null,
        })
        : rawDefinitions;
      remoteMcpTools = {
        ...remoteMcpTools,
        ...materializeRemoteTools(remoteSource, definitions),
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
      await sandboxResult.closeSandbox();
      return toolSources;
    }

    return {
      ok: true,
      forkTools: toolSources.forkTools,
      closeRuntime: sandboxResult.closeSandbox,
      closeTooling: toolSources.closeStudioMcpTools,
    };
  } catch (error) {
    await sandboxResult.closeSandbox();
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

  throw new Error("Child fork aborted");
}
