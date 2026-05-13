import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
} from "#veryfront/tool";
import {
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxTools,
} from "#veryfront/sandbox";
import {
  createLiveStudioMcpTools,
  type LiveStudioMcpToolsOptions,
} from "./live-studio-mcp-tools.ts";
import type { RuntimeClientProfile } from "./runtime-client-profile.ts";
import {
  type HostedChildProjectSwitchHandler,
  wrapHostedChildProjectSwitchTool,
} from "./hosted-child-steering-tools.ts";
import {
  buildDefaultHostedChildForkToolSet,
  type DefaultHostedChildForkToolAssemblySourceResult,
} from "./hosted-child-requested-tools.ts";

export type HostedChildForkToolSourcesLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export type PrepareDefaultHostedChildForkToolSourcesInput = {
  authToken: string;
  apiMcpUrl: string;
  getProjectId: () => string | null | undefined;
  studioMcpUrl?: string | null;
  clientProfile?: RuntimeClientProfile | null;
  conversationId?: string;
  globalTools?: HostToolSet;
  abortSignal?: AbortSignal;
  apiSourceId?: string;
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
  let closeStudioMcpTools: (() => Promise<void>) | undefined;
  let studioMcpTools: HostToolSet = {};
  const createLiveStudioTools = input.createLiveStudioTools ?? createLiveStudioMcpTools;

  try {
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
    studioMcpTools = studioTools.tools;
    closeStudioMcpTools = studioTools.close;
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

  const createRemoteToolSource = input.createRemoteToolSource ?? createRemoteMCPToolSource;
  const materializeRemoteTools = input.createToolsFromRemoteDefinitions ??
    createToolsFromRemoteDefinitions;
  const apiMcpSource = createRemoteToolSource({
    id: input.apiSourceId ?? "veryfront-mcp-fork",
    endpoint: input.apiMcpUrl,
    headers: {
      Authorization: `Bearer ${input.authToken}`,
    },
  });
  const apiMcpDefinitions = await apiMcpSource.listTools();
  const apiMcpTools = materializeRemoteTools(apiMcpSource, apiMcpDefinitions);

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
      apiMcpTools,
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
