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
import type { AgentMcpToolPolicy } from "../types.ts";
import { CONFIG_INVALID, PERMISSION_DENIED } from "#veryfront/errors";
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
  /**
   * Live activated remote tool names from the discovery context.
   * When provided, this Set (passed by reference) is used as the execution
   * gate for the remote tool catalog instead of `allowedToolNames`. Because
   * the same Set is mutated by `load_tools`, newly activated tools become
   * executable without any catalog re-creation.
   */
  activatedRemoteToolNames?: ReadonlySet<string> | null;
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
  // When `activatedRemoteToolNames` is provided, it acts as the live execution
  // gate: only tools in this Set (which grows as load_tools activates them)
  // can be listed or executed. Falls back to `allowedToolNames` when absent.
  const catalogAllowedToolNames = input.activatedRemoteToolNames !== undefined
    ? input.activatedRemoteToolNames
    : input.allowedToolNames;
  const toolCatalog = createProjectScopedRemoteToolCatalog({
    source: input.source,
    defaultProjectId: input.defaultProjectId,
    allowedToolNames: catalogAllowedToolNames,
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
    filterToolDefinitions: input.filterToolDefinitions,
  });
  const retryToolName = input.retryToolName ?? "update_file";

  function normalizeProjectToolInput(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Record<string, unknown> {
    if (isProjectNavigationRemoteTool(toolName, input.projectScopedRemoteToolOptions)) {
      return toolInput;
    }

    const { project_reference: _untrustedProjectReference, ...trustedInput } = toolInput;
    return trustedInput;
  }

  async function executeRetryTool(inputExecution: {
    toolInput: Record<string, unknown>;
    context?: ToolExecutionContext;
  }): Promise<unknown> {
    const retryExecution = await toolCatalog.prepareExecution({
      toolName: retryToolName,
      toolInput: normalizeProjectToolInput(retryToolName, inputExecution.toolInput),
      context: inputExecution.context,
    });
    return await input.source.executeTool(
      retryToolName,
      retryExecution.toolInput,
      retryExecution.executeContext,
    );
  }

  async function executeWithRetry(inputExecution: {
    toolName: string;
    toolInput: Record<string, unknown>;
    executeContext?: ToolExecutionContext;
    activeProjectId: string | null;
    activeBranchId: string | null;
    context?: ToolExecutionContext;
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
        return await executeRetryTool(inputExecution);
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
      const trustedToolInput = normalizeProjectToolInput(toolName, normalizedToolInput);
      const {
        activeProjectId,
        toolInput: hydratedToolInput,
        executeContext,
      } = await toolCatalog.prepareExecution({
        toolName,
        toolInput: trustedToolInput,
        context,
      });
      const activeBranchId = resolveActiveBranchId(input.getActiveBranchId);
      let result = await executeWithRetry({
        toolName,
        toolInput: hydratedToolInput,
        executeContext,
        activeProjectId,
        activeBranchId,
        context,
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
        result = await executeRetryTool({
          toolInput: trustedToolInput,
          context,
        });
      }

      if (!isSuccessfulProjectSteeringMutationResult(result)) {
        return result;
      }

      if (isProjectNavigationRemoteTool(toolName, input.projectScopedRemoteToolOptions)) {
        const requestedProjectId = trustedToolInput.project_id;
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
    conversationId?: string;
    createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
    onStudioProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  };

function needsStudioMcpSource(input: CreateHostedProjectRemoteToolSourcesInput): boolean {
  const allowedToolNames = input.allowedToolNames;
  if (!allowedToolNames) {
    return false;
  }

  return Array.from(allowedToolNames).some((toolName) => toolName.startsWith("studio_"));
}

function resolveHostedProjectMcpServers(
  input: CreateHostedProjectRemoteToolSourcesInput,
): readonly AgentServiceMcpServerConfig[] {
  const servers = [...(input.mcpServers ?? defaultAgentServiceMcpServers())];
  if (
    input.mcpServers === undefined &&
    needsStudioMcpSource(input) &&
    !servers.some((server) => server.kind === "veryfront-studio")
  ) {
    servers.push({ kind: "veryfront-studio" });
  }
  return servers;
}

function throwExplicitStudioMcpUnavailable(
  input: CreateHostedProjectRemoteToolSourcesInput,
): never {
  const requirement =
    'Provide studioMcpUrl with a trusted Veryfront Studio client profile, or remove { kind: "veryfront-studio" } from mcpServers.';
  if (!input.studioMcpUrl) {
    throw CONFIG_INVALID.create({
      detail:
        `Explicit Veryfront Studio MCP server requires a hosted Studio MCP transport, but studioMcpUrl was not provided. ${requirement}`,
    });
  }

  const clientId = input.clientProfile?.id ?? "unknown";
  throw PERMISSION_DENIED.create({
    detail:
      `Explicit Veryfront Studio MCP server requires a hosted Studio MCP transport, but client "${clientId}" is not allowed to use Studio MCP. ${requirement}`,
  });
}

function createHostedProjectRemoteToolSourceFromConfig(
  input: CreateHostedProjectRemoteToolSourcesInput,
  server: AgentServiceMcpServerConfig,
  source: RemoteToolSource,
  onProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler,
): RemoteToolSource {
  const policySource = createHostedMcpToolPolicySource(source, server.toolPolicy);

  return createHostedProjectRemoteToolSource({
    source: policySource,
    ...(input.defaultProjectId !== undefined ? { defaultProjectId: input.defaultProjectId } : {}),
    ...(input.getActiveBranchId !== undefined
      ? { getActiveBranchId: input.getActiveBranchId }
      : {}),
    ...(input.allowedToolNames !== undefined ? { allowedToolNames: input.allowedToolNames } : {}),
    ...(input.activatedRemoteToolNames !== undefined
      ? { activatedRemoteToolNames: input.activatedRemoteToolNames }
      : {}),
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

function isHostedMcpToolAllowed(
  toolName: string,
  policy: AgentMcpToolPolicy | undefined,
): boolean {
  if (policy?.deny?.includes(toolName)) {
    return false;
  }

  return policy?.allow ? policy.allow.includes(toolName) : true;
}

export function createHostedMcpToolPolicySource(
  source: RemoteToolSource,
  policy: AgentMcpToolPolicy | undefined,
): RemoteToolSource {
  if (!policy?.allow && !policy?.deny) {
    return source;
  }

  return {
    id: source.id,
    async listTools(context) {
      return (await source.listTools(context)).filter((toolDefinition) =>
        isHostedMcpToolAllowed(toolDefinition.name, policy)
      );
    },
    executeTool(toolName, args, context) {
      if (!isHostedMcpToolAllowed(toolName, policy)) {
        throw PERMISSION_DENIED.create({
          detail: `Tool "${toolName}" is not allowed for this MCP server`,
        });
      }

      return source.executeTool(toolName, args, context);
    },
  };
}

/** Create hosted project remote tool sources. */
export function createHostedProjectRemoteToolSources(
  input: CreateHostedProjectRemoteToolSourcesInput,
): RemoteToolSource[] {
  const createRemoteToolSource = input.createRemoteToolSource ?? createRemoteMCPToolSource;
  const sources: RemoteToolSource[] = [];
  const mcpServers = resolveHostedProjectMcpServers(input);
  const hasExplicitMcpServers = input.mcpServers !== undefined;

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
      if (hasExplicitMcpServers && server.kind === "veryfront-studio") {
        throwExplicitStudioMcpUnavailable(input);
      }
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
