import {
  createRemoteMCPToolSource,
  type HostToolSet,
  loadRemoteToolsFromSource,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "../runtime/client-profile.ts";

export type LiveStudioMcpToolsOptions = {
  authToken: string;
  clientProfile?: RuntimeClientProfile | null;
  getProjectId: () => string | null | undefined;
  studioMcpUrl?: string | null;
  conversationId?: string;
  sourceId?: string;
  createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  loadRemoteTools?: typeof loadRemoteToolsFromSource;
};

type StudioMcpState = {
  projectId: string | null;
  tools: HostToolSet;
};

export function buildStudioMcpHeaders(
  authToken: string,
  projectId: string | null,
  conversationId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
  };
  if (projectId) {
    headers["x-project-id"] = projectId;
  }
  if (conversationId) {
    headers["x-conversation-id"] = conversationId;
  }
  return headers;
}

async function loadStudioMcpState(input: {
  authToken: string;
  projectId: string | null;
  conversationId?: string;
  url: string;
  sourceId: string;
  createRemoteToolSource: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  loadRemoteTools: typeof loadRemoteToolsFromSource;
}): Promise<StudioMcpState> {
  const source = input.createRemoteToolSource({
    id: input.sourceId,
    endpoint: input.url,
    headers: buildStudioMcpHeaders(input.authToken, input.projectId, input.conversationId),
  });

  return {
    projectId: input.projectId,
    tools: await input.loadRemoteTools(source, {
      context: input.projectId ? { projectId: input.projectId } : undefined,
    }),
  };
}

export async function createLiveStudioMcpTools(input: LiveStudioMcpToolsOptions): Promise<{
  tools: HostToolSet;
  close: () => Promise<void>;
}> {
  const studioMcpUrl = input.studioMcpUrl;

  if (!studioMcpUrl || !clientAllowsStudioMcp(input.clientProfile)) {
    return {
      tools: {},
      close: async () => undefined,
    };
  }

  const sourceId = input.sourceId ?? "studio-mcp-live-tools";
  const createRemoteToolSource = input.createRemoteToolSource ?? createRemoteMCPToolSource;
  const loadRemoteTools = input.loadRemoteTools ?? loadRemoteToolsFromSource;
  let studioState: StudioMcpState | null = null;
  let pendingState: { promise: Promise<StudioMcpState> } | null = null;

  const loadState = async (projectId: string | null): Promise<StudioMcpState> => {
    if (studioState && studioState.projectId === projectId) {
      return studioState;
    }

    if (pendingState) {
      const loadedState = await pendingState.promise;
      if (loadedState.projectId === projectId) {
        return loadedState;
      }
    }

    const nextState = {
      promise: loadStudioMcpState({
        authToken: input.authToken,
        projectId,
        conversationId: input.conversationId,
        url: studioMcpUrl,
        sourceId,
        createRemoteToolSource,
        loadRemoteTools,
      }),
    };

    pendingState = nextState;

    try {
      const loadedState = await nextState.promise;
      studioState = loadedState;
      return loadedState;
    } finally {
      if (pendingState === nextState) {
        pendingState = null;
      }
    }
  };

  const initialState = await loadState(input.getProjectId() ?? null);
  const wrappedTools: HostToolSet = {};

  for (const [toolName, toolDefinition] of Object.entries(initialState.tools)) {
    if (typeof toolDefinition.execute !== "function") {
      wrappedTools[toolName] = toolDefinition;
      continue;
    }

    wrappedTools[toolName] = {
      ...toolDefinition,
      execute: async (toolInput: unknown, execOptions?: ToolExecutionContext) => {
        const liveState = await loadState(input.getProjectId() ?? null);
        const liveTool = liveState.tools[toolName];

        if (!liveTool || typeof liveTool.execute !== "function") {
          throw new Error(`Studio MCP tool unavailable for current project: ${toolName}`);
        }

        return liveTool.execute(toolInput, execOptions);
      },
    };
  }

  return {
    tools: wrappedTools,
    close: async () => {
      studioState = null;
    },
  };
}
