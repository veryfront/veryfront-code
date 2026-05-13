import {
  createProjectScopedRemoteToolCatalog,
  createRemoteMCPToolSource,
  isProjectNavigationRemoteTool,
  type ProjectScopedRemoteToolDefaultProjectId,
  type ProjectScopedRemoteToolOptions,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";
import { buildStudioMcpHeaders } from "./live-studio-mcp-tools.ts";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "./runtime-client-profile.ts";
import { getConfirmedProjectContextSwitchId } from "./project-context.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  type ProjectSteeringMutationResult,
  type ProjectSteeringPaths,
} from "./project-steering-mutation.ts";

export type HostedProjectRemoteToolSourceMutationHandler = (
  mutation: ProjectSteeringMutationResult,
) => Promise<void> | void;

export type HostedProjectRemoteToolSourceProjectSwitchHandler = (
  projectId: string,
) => Promise<void> | void;

export type HostedProjectVeryfrontApiMcpServerConfig = {
  kind: "veryfront-api";
  id?: string;
};

export type HostedProjectVeryfrontStudioMcpServerConfig = {
  kind: "veryfront-studio";
  id?: string;
};

export type HostedProjectGenericMcpServerConfig = {
  kind?: "generic";
  id?: string;
  endpoint: RemoteMCPToolSourceConfig["endpoint"];
  headers?: RemoteMCPToolSourceConfig["headers"];
  fetch?: RemoteMCPToolSourceConfig["fetch"];
  listMethod?: RemoteMCPToolSourceConfig["listMethod"];
  callMethod?: RemoteMCPToolSourceConfig["callMethod"];
};

export type HostedProjectMcpServerConfig =
  | HostedProjectVeryfrontApiMcpServerConfig
  | HostedProjectVeryfrontStudioMcpServerConfig
  | HostedProjectGenericMcpServerConfig;

export type HostedProjectRemoteToolSourcePrepareToolInput = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: ToolExecutionContext;
}) => Record<string, unknown>;

export type HostedProjectRemoteToolSourceRetryPolicy = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  activeProjectId: string | null;
  activeBranchId: string | null;
  error: unknown;
}) => boolean;

export type CreateHostedProjectRemoteToolSourceInput = {
  source: RemoteToolSource;
  defaultProjectId?: ProjectScopedRemoteToolDefaultProjectId;
  getActiveBranchId?: () => string | null | undefined;
  allowedToolNames?: ReadonlySet<string> | null;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
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

export function createHostedProjectRemoteToolSource(
  input: CreateHostedProjectRemoteToolSourceInput,
): RemoteToolSource {
  const toolCatalog = createProjectScopedRemoteToolCatalog({
    source: input.source,
    defaultProjectId: input.defaultProjectId,
    allowedToolNames: input.allowedToolNames,
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
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

export type CreateHostedProjectRemoteToolSourcesInput =
  & Omit<
    CreateHostedProjectRemoteToolSourceInput,
    "source" | "onProjectSwitch"
  >
  & {
    authToken: string;
    apiMcpUrl: string;
    studioMcpUrl?: string | null;
    mcpServers?: readonly HostedProjectMcpServerConfig[];
    clientProfile?: RuntimeClientProfile | null;
    getProjectId: () => string | null | undefined;
    conversationId?: string;
    createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
    onStudioProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  };

function defaultHostedProjectMcpServers(): HostedProjectMcpServerConfig[] {
  return [{ kind: "veryfront-api" }];
}

export function createHostedProjectGenericRemoteMcpConfig(
  server: HostedProjectGenericMcpServerConfig,
): RemoteMCPToolSourceConfig {
  const config: RemoteMCPToolSourceConfig = {
    endpoint: server.endpoint,
  };

  if (server.id !== undefined) config.id = server.id;
  if (server.headers !== undefined) config.headers = server.headers;
  if (server.fetch !== undefined) config.fetch = server.fetch;
  if (server.listMethod !== undefined) config.listMethod = server.listMethod;
  if (server.callMethod !== undefined) config.callMethod = server.callMethod;

  return config;
}

export function createHostedProjectVeryfrontApiRemoteMcpConfig(
  input: Pick<CreateHostedProjectRemoteToolSourcesInput, "apiMcpUrl" | "authToken"> & {
    defaultSourceId?: string;
  },
  server: HostedProjectVeryfrontApiMcpServerConfig,
): RemoteMCPToolSourceConfig {
  return {
    id: server.id ?? input.defaultSourceId ?? "veryfront-mcp",
    endpoint: input.apiMcpUrl,
    headers: {
      Authorization: `Bearer ${input.authToken}`,
    },
  };
}

function createVeryfrontStudioRemoteMcpConfig(
  input: Pick<
    CreateHostedProjectRemoteToolSourcesInput,
    "authToken" | "clientProfile" | "conversationId" | "getProjectId" | "studioMcpUrl"
  >,
  server: HostedProjectVeryfrontStudioMcpServerConfig,
): RemoteMCPToolSourceConfig | null {
  if (!input.studioMcpUrl || !clientAllowsStudioMcp(input.clientProfile)) {
    return null;
  }

  return {
    id: server.id ?? "studio-mcp",
    endpoint: input.studioMcpUrl,
    headers: () =>
      buildStudioMcpHeaders(
        input.authToken,
        input.getProjectId() ?? null,
        input.conversationId,
      ),
  };
}

function createRemoteMcpConfig(
  input: CreateHostedProjectRemoteToolSourcesInput,
  server: HostedProjectMcpServerConfig,
): RemoteMCPToolSourceConfig | null {
  if (server.kind === "veryfront-api") {
    return createHostedProjectVeryfrontApiRemoteMcpConfig(input, server);
  }

  if (server.kind === "veryfront-studio") {
    return createVeryfrontStudioRemoteMcpConfig(input, server);
  }

  return createHostedProjectGenericRemoteMcpConfig(server);
}

function createHostedProjectRemoteToolSourceFromConfig(
  input: CreateHostedProjectRemoteToolSourcesInput,
  source: RemoteToolSource,
  onProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler,
): RemoteToolSource {
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
    ...(input.prepareToolInput !== undefined ? { prepareToolInput: input.prepareToolInput } : {}),
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

export function createHostedProjectRemoteToolSources(
  input: CreateHostedProjectRemoteToolSourcesInput,
): RemoteToolSource[] {
  const createRemoteToolSource = input.createRemoteToolSource ?? createRemoteMCPToolSource;
  const sources: RemoteToolSource[] = [];
  const mcpServers = input.mcpServers ?? defaultHostedProjectMcpServers();

  for (const server of mcpServers) {
    const remoteConfig = createRemoteMcpConfig(input, server);
    if (!remoteConfig) {
      continue;
    }

    sources.push(
      createHostedProjectRemoteToolSourceFromConfig(
        input,
        createRemoteToolSource(remoteConfig),
        server.kind === "veryfront-studio" ? input.onStudioProjectSwitch : undefined,
      ),
    );
  }

  return sources;
}
