import {
  createProjectScopedRemoteToolCatalog,
  createRemoteMCPToolSource,
  isProjectNavigationRemoteTool,
  type ProjectScopedRemoteToolCatalogOptions,
  type ProjectScopedRemoteToolDefaultProjectId,
  type ProjectScopedRemoteToolOptions,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolDefinition,
  type ToolExecutionContext,
} from "#veryfront/tool";
import {
  type AgentServiceMcpServerConfig,
  createAgentServiceRemoteMcpConfig,
  defaultAgentServiceMcpServers,
} from "../service/mcp-server-config.ts";
import type { AgentMcpToolPolicy } from "../types.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "../mcp-tool-policy.ts";
import { CONFIG_INVALID, PERMISSION_DENIED, VeryfrontError } from "#veryfront/errors";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import {
  type ConfirmedAgentProjectContextSwitch,
  createUnconfirmedProjectContextSwitchResult,
  getConfirmedProjectContextSwitch,
  isClaimedSuccessfulProjectContextSwitchResult,
} from "../project/context.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  type ProjectSteeringMutationResult,
  type ProjectSteeringPaths,
} from "../project/steering-mutation.ts";
import { filterVeryfrontApiToolDefinitionsWithAccessProfile } from "./veryfront-api-tool-access.ts";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("agent");
const REMOTE_TOOL_CATALOG_INITIAL_BACKOFF_MS = 1_000;
const REMOTE_TOOL_CATALOG_MAX_BACKOFF_MS = 30_000;

interface LastSuccessfulRemoteToolCatalog {
  readonly projectId: string | null;
  readonly authToken: string | null;
  readonly definitions: ToolDefinition[];
}

function getRemoteToolCatalogProjectId(context: ToolExecutionContext | undefined): string | null {
  const projectId = context?.projectId;
  return typeof projectId === "string" && projectId.trim().length > 0 ? projectId.trim() : null;
}

function getRemoteToolCatalogAuthToken(context: ToolExecutionContext | undefined): string | null {
  const authToken = context?.authToken;
  return typeof authToken === "string" && authToken.length > 0 ? authToken : null;
}

function isTransientRemoteToolCatalogError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  return error instanceof VeryfrontError && error.slug === "timeout-error";
}

/** Keep one source's last successful catalog available during transient refresh failures. */
function createRunResilientRemoteToolSource(source: RemoteToolSource): RemoteToolSource {
  let lastSuccessfulCatalog: LastSuccessfulRemoteToolCatalog | undefined;
  let consecutiveFailures = 0;
  let retryAfter = 0;

  return {
    id: source.id,
    async listTools(context) {
      context?.abortSignal?.throwIfAborted();
      const projectId = getRemoteToolCatalogProjectId(context);
      const authToken = getRemoteToolCatalogAuthToken(context);
      const matchingCatalog = lastSuccessfulCatalog?.projectId === projectId &&
          lastSuccessfulCatalog.authToken === authToken
        ? lastSuccessfulCatalog
        : undefined;
      if (matchingCatalog && Date.now() < retryAfter) {
        return [...matchingCatalog.definitions];
      }

      try {
        const definitions = await source.listTools(context);
        context?.abortSignal?.throwIfAborted();
        lastSuccessfulCatalog = { projectId, authToken, definitions: [...definitions] };
        consecutiveFailures = 0;
        retryAfter = 0;
        return definitions;
      } catch (error) {
        context?.abortSignal?.throwIfAborted();
        if (!isTransientRemoteToolCatalogError(error)) {
          if (matchingCatalog) {
            lastSuccessfulCatalog = undefined;
            consecutiveFailures = 0;
            retryAfter = 0;
          }
          throw error;
        }
        if (!matchingCatalog) throw error;

        consecutiveFailures++;
        const backoffMs = Math.min(
          REMOTE_TOOL_CATALOG_INITIAL_BACKOFF_MS * 2 ** (consecutiveFailures - 1),
          REMOTE_TOOL_CATALOG_MAX_BACKOFF_MS,
        );
        retryAfter = Date.now() + backoffMs;
        logger.warn("Remote tool discovery failed; using the last successful catalog", {
          sourceId: source.id,
          retryAfterMs: backoffMs,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return [...matchingCatalog.definitions];
      }
    },
    executeTool: (toolName, args, context) => source.executeTool(toolName, args, context),
  };
}

/** Handler for hosted project remote tool source mutation. */
export type HostedProjectRemoteToolSourceMutationHandler = (
  mutation: ProjectSteeringMutationResult,
) => Promise<void> | void;

/** Handler for hosted project remote tool source project switch. */
export type HostedProjectRemoteToolSourceProjectSwitchHandler = (
  projectId: string,
  confirmedProject?: Readonly<ConfirmedAgentProjectContextSwitch>,
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
   * Narrower execution gate for the remote tool catalog. When set, only tools
   * in this Set can be listed or executed, overriding `allowedToolNames`. The
   * Set is held by reference, so growing it exposes tools without re-creating
   * the catalog.
   *
   * `null` is not a fallback: it overrides `allowedToolNames` and disables name
   * filtering entirely. Omit the property to keep `allowedToolNames` as the
   * gate.
   *
   * @deprecated No framework path supplies this. It is retained because
   * `CreateHostedProjectRemoteToolSourceInput` is public API, and dropping it
   * would silently widen the catalog to `allowedToolNames` for any caller that
   * relies on it as the gate.
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

/**
 * Create a project-scoped remote tool source. The source retains its last
 * successful catalog for the active project during transient discovery
 * failures and retries refreshes with bounded backoff.
 */
export function createHostedProjectRemoteToolSource(
  input: CreateHostedProjectRemoteToolSourceInput,
): RemoteToolSource {
  // `activatedRemoteToolNames` is the gate whenever the property is present,
  // including when it is `null`, which disables name filtering entirely. Only
  // an omitted property falls back to `allowedToolNames`.
  const catalogAllowedToolNames = input.activatedRemoteToolNames !== undefined
    ? input.activatedRemoteToolNames
    : input.allowedToolNames;
  const resilientSource = createRunResilientRemoteToolSource(input.source);
  const toolCatalog = createProjectScopedRemoteToolCatalog({
    source: resilientSource,
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
        const requestedProjectReference = trustedToolInput.project_reference;
        const confirmedProject = typeof requestedProjectReference === "string"
          ? getConfirmedProjectContextSwitch(result, requestedProjectReference)
          : null;

        if (confirmedProject) {
          await input.onProjectSwitch?.(confirmedProject.projectId, confirmedProject);
          return result;
        }

        return isClaimedSuccessfulProjectContextSwitchResult(result)
          ? createUnconfirmedProjectContextSwitchResult()
          : result;
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

function resolveHostedProjectMcpServers(
  input: CreateHostedProjectRemoteToolSourcesInput,
): readonly AgentServiceMcpServerConfig[] {
  return input.mcpServers ?? defaultAgentServiceMcpServers();
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

export function createHostedMcpToolPolicySource(
  source: RemoteToolSource,
  policy: AgentMcpToolPolicy | undefined,
): RemoteToolSource {
  return wrapRemoteToolSourceWithMcpPolicy(source, policy, {
    deniedDetail: (toolName) => `Tool "${toolName}" is not allowed for this MCP server`,
  });
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
