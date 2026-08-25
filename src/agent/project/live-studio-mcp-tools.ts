import { RESOURCE_NOT_FOUND } from "#veryfront/errors";
import {
  createRemoteMCPToolSource,
  type HostToolSet,
  loadRemoteToolsFromSource,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "../runtime/client-profile.ts";
import {
  bindToolExecutionIdentityContext,
  type ConfirmedToolExecutionIdentity,
  resolveToolExecutionIdentity,
} from "../runtime/tool-execution-identity.ts";

/** Options accepted by live studio MCP tools. */
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

type StudioMcpIdentity = ConfirmedToolExecutionIdentity;

type StudioMcpState = StudioMcpIdentity & {
  tools: HostToolSet;
};

type PendingStudioMcpState = StudioMcpIdentity & {
  generation: number;
  promise: Promise<StudioMcpState>;
};

function studioMcpIdentitiesEqual(
  left: StudioMcpIdentity,
  right: StudioMcpIdentity,
): boolean {
  return left.authToken === right.authToken && left.projectId === right.projectId;
}

function createStudioMcpIdentityContext(
  identity: StudioMcpIdentity,
): ToolExecutionContext {
  return {
    authToken: identity.authToken,
    ...(identity.projectId === null ? {} : { projectId: identity.projectId }),
  };
}

/** Builds studio MCP headers. */
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
  const boundIdentity = {
    authToken: input.authToken,
    projectId: input.projectId,
  };
  const source = input.createRemoteToolSource({
    id: input.sourceId,
    endpoint: input.url,
    headers: (context) => {
      const identity = resolveToolExecutionIdentity(
        context,
        boundIdentity.authToken,
        () => boundIdentity.projectId,
        "Studio execution context",
      );
      return buildStudioMcpHeaders(
        identity.authToken,
        identity.projectId,
        input.conversationId,
      );
    },
  });

  return {
    authToken: input.authToken,
    projectId: input.projectId,
    tools: await input.loadRemoteTools(source, {
      context: createStudioMcpIdentityContext(boundIdentity),
    }),
  };
}

/** Create live studio MCP tools. */
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
  let pendingStates: PendingStudioMcpState[] = [];
  let latestRequestedIdentity: StudioMcpIdentity | null = null;
  let generation = 0;

  const getFallbackIdentity = (): StudioMcpIdentity =>
    resolveToolExecutionIdentity(
      undefined,
      input.authToken,
      input.getProjectId,
      "Studio execution context",
    );

  const loadState = async (identity: StudioMcpIdentity): Promise<StudioMcpState> => {
    const requestGeneration = generation;
    latestRequestedIdentity = identity;

    if (studioState && studioMcpIdentitiesEqual(studioState, identity)) {
      return studioState;
    }

    let pendingState = pendingStates.find((candidate) =>
      candidate.generation === requestGeneration &&
      studioMcpIdentitiesEqual(candidate, identity)
    );
    let createdPendingState = false;

    if (!pendingState) {
      pendingState = {
        ...identity,
        generation: requestGeneration,
        promise: loadStudioMcpState({
          ...identity,
          conversationId: input.conversationId,
          url: studioMcpUrl,
          sourceId,
          createRemoteToolSource,
          loadRemoteTools,
        }),
      };
      pendingStates.push(pendingState);
      createdPendingState = true;
    }

    try {
      const loadedState = await pendingState.promise;
      if (
        generation === requestGeneration &&
        latestRequestedIdentity &&
        studioMcpIdentitiesEqual(latestRequestedIdentity, loadedState)
      ) {
        studioState = loadedState;
      }
      return loadedState;
    } finally {
      if (createdPendingState) {
        pendingStates = pendingStates.filter((candidate) => candidate !== pendingState);
      }
    }
  };

  const initialState = await loadState(getFallbackIdentity());
  const wrappedTools: HostToolSet = {};

  for (const [toolName, toolDefinition] of Object.entries(initialState.tools)) {
    if (typeof toolDefinition.execute !== "function") {
      wrappedTools[toolName] = toolDefinition;
      continue;
    }

    wrappedTools[toolName] = {
      ...toolDefinition,
      execute: async (toolInput: unknown, execOptions?: ToolExecutionContext) => {
        const identity = resolveToolExecutionIdentity(
          execOptions,
          input.authToken,
          input.getProjectId,
          "Studio execution context",
        );
        const liveState = await loadState(identity);
        const liveTool = liveState.tools[toolName];

        if (!liveTool || typeof liveTool.execute !== "function") {
          throw RESOURCE_NOT_FOUND.create({
            detail: `Studio MCP tool unavailable for current project: ${toolName}`,
          });
        }

        return liveTool.execute(
          toolInput,
          bindToolExecutionIdentityContext(
            execOptions,
            identity,
            "Studio execution context",
          ),
        );
      },
    };
  }

  return {
    tools: wrappedTools,
    close: async () => {
      generation += 1;
      latestRequestedIdentity = null;
      studioState = null;
      pendingStates = [];
    },
  };
}
