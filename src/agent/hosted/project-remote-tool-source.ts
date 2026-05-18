import {
  createProjectScopedRemoteToolCatalog,
  createRemoteMCPToolSource,
  isProjectNavigationRemoteTool,
  type ProjectScopedRemoteToolCatalogOptions,
  type ProjectScopedRemoteToolDefaultProjectId,
  type ProjectScopedRemoteToolOptions,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
} from "#veryfront/tool";
import {
  type AgentServiceMcpServerConfig,
  createAgentServiceRemoteMcpConfig,
  defaultAgentServiceMcpServers,
} from "../service/mcp-server-config.ts";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import { getConfirmedProjectContextSwitchId } from "../project/context.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  type ProjectSteeringMutationResult,
  type ProjectSteeringPaths,
} from "../project/steering-mutation.ts";
import { filterVeryfrontApiToolDefinitionsWithAccessProfile } from "./veryfront-api-tool-access.ts";

/** Handler for hosted project remote tool source mutation. */
export type HostedProjectRemoteToolSourceMutationHandler = (
  mutation: ProjectSteeringMutationResult,
) => Promise<void> | void;

/** Handler for hosted project remote tool source project switch. */
export type HostedProjectRemoteToolSourceProjectSwitchHandler = (
  projectId: string,
) => Promise<void> | void;

/** Input payload for hosted project remote tool source prepare tool. */
export type HostedProjectRemoteToolSourcePrepareToolInput = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: ToolExecutionContext;
}) => Record<string, unknown>;

/** Public API contract for hosted project remote tool source retry policy. */
export type HostedProjectRemoteToolSourceRetryPolicy = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  activeProjectId: string | null;
  activeBranchId: string | null;
  error: unknown;
}) => boolean;

/** Input payload for create hosted project remote tool source. */
export type CreateHostedProjectRemoteToolSourceInput = {
  source: RemoteToolSource;
  defaultProjectId?: ProjectScopedRemoteToolDefaultProjectId;
  getActiveBranchId?: () => string | null | undefined;
  allowedToolNames?: ReadonlySet<string> | null;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
  filterToolDefinitions?: ProjectScopedRemoteToolCatalogOptions["filterToolDefinitions"];
  prepareToolInput?: HostedProjectRemoteToolSourcePrepareToolInput;
  retryToolName?: string;
  shouldRetryWithTool?: HostedProjectRemoteToolSourceRetryPolicy;
  steeringPaths?: ProjectSteeringPaths;
  onProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  onSteeringMutation?: HostedProjectRemoteToolSourceMutationHandler;
};

function resolveActiveBranchId(
  getActiveBranchId: (() => string | null | undefined) | undefined,
): string | null {
  return getActiveBranchId?.() ?? null;
}

/** Create hosted project remote tool source. */
export function createHostedProjectRemoteToolSource(
  input: CreateHostedProjectRemoteToolSourceInput,
): RemoteToolSource {
  const toolCatalog = createProjectScopedRemoteToolCatalog({
    source: input.source,
    defaultProjectId: input.defaultProjectId,
    allowedToolNames: input.allowedToolNames,
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
    filterToolDefinitions: input.filterToolDefinitions,
  });
  const retryToolName = input.retryToolName ?? "update_file";

  async function executeWithRetry(inputExecution: {
    toolName: string;
    toolInput: Record<string, unknown>;
    executeContext?: ToolExecutionContext;
    activeProjectId: string | null;
    activeBranchId: string | null;
  }): Promise<unknown> {
    try {
      return await input.source.executeTool(
        inputExecution.toolName,
        inputExecution.toolInput,
        inputExecution.executeContext,
      );
    } catch (error) {
      if (
        input.shouldRetryWithTool?.({
          toolName: inputExecution.toolName,
          toolInput: inputExecution.toolInput,
          activeProjectId: inputExecution.activeProjectId,
          activeBranchId: inputExecution.activeBranchId,
          error,
        })
      ) {
        return input.source.executeTool(
          retryToolName,
          inputExecution.toolInput,
          inputExecution.executeContext,
        );
      }

      throw error;
    }
  }

  return {
    id: input.source.id,
    listTools: (context) => toolCatalog.listTools(context),
    async executeTool(toolName, args, context) {
      const normalizedToolInput = input.prepareToolInput?.({
        toolName,
        toolInput: toChildRunToolInputRecord(args),
        context,
      }) ?? toChildRunToolInputRecord(args);
      const {
        activeProjectId,
        toolInput: hydratedToolInput,
        executeContext,
      } = await toolCatalog.prepareExecution({
        toolName,
        toolInput: normalizedToolInput,
        context,
      });
      const activeBranchId = resolveActiveBranchId(input.getActiveBranchId);
      let result = await executeWithRetry({
        toolName,
        toolInput: hydratedToolInput,
        executeContext,
        activeProjectId,
        activeBranchId,
      });

      if (
        input.shouldRetryWithTool?.({
          toolName,
          toolInput: hydratedToolInput,
          activeProjectId,
          activeBranchId,
          error: result,
        })
      ) {
        result = await input.source.executeTool(retryToolName, hydratedToolInput, executeContext);
      }

      if (!isSuccessfulProjectSteeringMutationResult(result)) {
        return result;
      }

      if (isProjectNavigationRemoteTool(toolName, input.projectScopedRemoteToolOptions)) {
        const requestedProjectId = normalizedToolInput.project_id;
        const confirmedProjectId = typeof requestedProjectId === "string"
          ? getConfirmedProjectContextSwitchId(result, requestedProjectId)
          : null;

        if (confirmedProjectId) {
          await input.onProjectSwitch?.(confirmedProjectId);
        }

        return result;
      }

      const mutation = getProjectSteeringMutation({
        toolName,
        toolInput: hydratedToolInput,
        activeProjectId,
        activeBranchId,
        steeringPaths: input.steeringPaths,
      });

      if (mutation.instructionsChanged || mutation.skillsChanged) {
        await input.onSteeringMutation?.(mutation);
      }

      return result;
    },
  };
}

/** Input payload for create hosted project remote tool sources. */
export type CreateHostedProjectRemoteToolSourcesInput =
  & Omit<
    CreateHostedProjectRemoteToolSourceInput,
    "source" | "onProjectSwitch"
  >
  & {
    authToken: string;
    apiMcpUrl: string;
    studioMcpUrl?: string | null;
    mcpServers?: readonly AgentServiceMcpServerConfig[];
    clientProfile?: RuntimeClientProfile | null;
    getProjectId: () => string | null | undefined;
    getEndUserId?: () => string | null | undefined;
    conversationId?: string;
    createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
    onStudioProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  };

function isVeryfrontApiIntegrationTool(toolName: string): boolean {
  return /^[a-zA-Z0-9_.-]+__[a-zA-Z0-9_.-]+$/.test(toolName);
}

function prepareVeryfrontApiToolInput(input: {
  server: AgentServiceMcpServerConfig;
  getEndUserId?: () => string | null | undefined;
  prepareToolInput?: HostedProjectRemoteToolSourcePrepareToolInput;
}): HostedProjectRemoteToolSourcePrepareToolInput | undefined {
  if (input.server.kind !== "veryfront-api" && !input.prepareToolInput) {
    return undefined;
  }

  return (toolInputContext) => {
    const prepared = input.prepareToolInput?.(toolInputContext) ?? toolInputContext.toolInput;
    if (
      input.server.kind !== "veryfront-api" ||
      !isVeryfrontApiIntegrationTool(toolInputContext.toolName)
    ) {
      return prepared;
    }

    if (typeof prepared.end_user_id === "string" && prepared.end_user_id.length > 0) {
      return prepared;
    }

    const endUserId = input.getEndUserId?.() ?? toolInputContext.context?.endUserId;
    if (typeof endUserId !== "string" || endUserId.length === 0) {
      return prepared;
    }

    return {
      ...prepared,
      end_user_id: endUserId,
    };
  };
}

function createHostedProjectRemoteToolSourceFromConfig(
  input: CreateHostedProjectRemoteToolSourcesInput,
  server: AgentServiceMcpServerConfig,
  source: RemoteToolSource,
  onProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler,
): RemoteToolSource {
  const prepareToolInput = prepareVeryfrontApiToolInput({
    server,
    getEndUserId: input.getEndUserId,
    prepareToolInput: input.prepareToolInput,
  });

  return createHostedProjectRemoteToolSource({
    source,
    ...(input.defaultProjectId !== undefined ? { defaultProjectId: input.defaultProjectId } : {}),
    ...(input.getActiveBranchId !== undefined
      ? { getActiveBranchId: input.getActiveBranchId }
      : {}),
    ...(input.allowedToolNames !== undefined ? { allowedToolNames: input.allowedToolNames } : {}),
    ...(input.projectScopedRemoteToolOptions !== undefined
      ? { projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions }
      : {}),
    ...(server.kind === "veryfront-api"
      ? {
        filterToolDefinitions: ({ source, toolDefinitions, activeProjectId, context }) =>
          filterVeryfrontApiToolDefinitionsWithAccessProfile({
            source,
            toolDefinitions,
            projectId: activeProjectId,
            context,
          }),
      }
      : {}),
    ...(prepareToolInput !== undefined ? { prepareToolInput } : {}),
    ...(input.retryToolName !== undefined ? { retryToolName: input.retryToolName } : {}),
    ...(input.shouldRetryWithTool !== undefined
      ? { shouldRetryWithTool: input.shouldRetryWithTool }
      : {}),
    ...(input.steeringPaths !== undefined ? { steeringPaths: input.steeringPaths } : {}),
    ...(input.onSteeringMutation !== undefined
      ? { onSteeringMutation: input.onSteeringMutation }
      : {}),
    ...(onProjectSwitch !== undefined ? { onProjectSwitch } : {}),
  });
}

/** Create hosted project remote tool sources. */
export function createHostedProjectRemoteToolSources(
  input: CreateHostedProjectRemoteToolSourcesInput,
): RemoteToolSource[] {
  const createRemoteToolSource = input.createRemoteToolSource ?? createRemoteMCPToolSource;
  const sources: RemoteToolSource[] = [];
  const mcpServers = input.mcpServers ?? defaultAgentServiceMcpServers();

  for (const server of mcpServers) {
    const remoteConfig = createAgentServiceRemoteMcpConfig({
      server,
      authToken: input.authToken,
      apiMcpUrl: input.apiMcpUrl,
      studioMcpUrl: input.studioMcpUrl,
      clientProfile: input.clientProfile,
      getProjectId: input.getProjectId,
      conversationId: input.conversationId,
    });
    if (!remoteConfig) {
      continue;
    }

    sources.push(
      createHostedProjectRemoteToolSourceFromConfig(
        input,
        server,
        createRemoteToolSource(remoteConfig),
        server.kind === "veryfront-studio" ? input.onStudioProjectSwitch : undefined,
      ),
    );
  }

  return sources;
}
