import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import {
  createRemoteMCPToolSource,
  createToolsFromHostDefinitions,
  type HostToolSet,
  type HostToolTraceAttributes,
  listProjectScopedRemoteToolNames,
  type ProjectScopedRemoteToolOptions,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolSet,
  traceHostTools,
  type TraceHostToolsOptions,
} from "#veryfront/tool";
import {
  type DefaultResearchArtifactContext,
  fetchLatestConversationUserText,
  updateDefaultResearchArtifacts,
} from "../artifacts/default-research-artifact-support.ts";
import { type AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import {
  createHostedProjectRemoteToolSources,
  type HostedProjectRemoteToolSourceMutationHandler,
  type HostedProjectRemoteToolSourcePrepareToolInput,
  type HostedProjectRemoteToolSourceProjectSwitchHandler,
  type HostedProjectRemoteToolSourceRetryPolicy,
} from "./project-remote-tool-source.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "../mcp-tool-policy.ts";
import { type RuntimeClientProfile } from "../runtime/client-profile.ts";
import { selectProviderCompatibleToolNames } from "../runtime/provider-tool-compat.ts";
import { getProviderNativeToolNames } from "../runtime/provider-native-tool-inventory.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "../runtime/tool-inventory.ts";
import {
  type HostedRuntimeAllowedToolNames,
  normalizeHostedRuntimeAllowedToolNames,
  resolveHostedRuntimeAllowedToolNames,
} from "./runtime-essential-tools.ts";
import type { HostedSubmittedFormInputResult } from "./chat-runtime-contract.ts";
import {
  applySourceIntegrationPolicy,
  isIntegrationToolAllowedBySourcePolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import type { RuntimeToolDiscoveryContext } from "../runtime/tool-discovery-context.ts";
import type { RuntimeToolLoadingMode } from "../runtime/runtime-tool-config.ts";
import { TOOL_SEARCH_TOOL_NAME } from "../runtime/tool-exposure.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

/** Context for hosted chat runtime tool assembly. */
export type HostedChatRuntimeToolAssemblyContext = DefaultResearchArtifactContext & {
  authToken: string;
  agentId?: string;
  projectId?: string | null;
  branchId?: string | null;
  model?: string;
  clientProfile?: RuntimeClientProfile | null;
  availableToolNames?: string[];
  availableSkillIds?: readonly string[];
  userId?: string | null;
  submittedFormInputResult?: HostedSubmittedFormInputResult;
};

/** Public API contract for hosted chat runtime allowed tool names. */
export type HostedChatRuntimeAllowedToolNames = HostedRuntimeAllowedToolNames;

/** Service-operator authorization ceiling for Framework-owned host tools. */
export type HostedHostToolPolicy = {
  readonly allow: readonly string[];
};

/** Result returned from hosted chat runtime tool assembly. */
export type HostedChatRuntimeToolAssemblyResult = {
  /** Exact project-source restriction captured for this runtime assembly. */
  readonly sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  runtimeTools: ToolSet;
  remoteToolSources: RemoteToolSource[];
  localToolNames: string[];
  remoteToolNames: string[];
  providerToolNames: string[];
  availableToolNames: string[];
  modelVisibleToolNames?: string[];
  toolLoadingMode: RuntimeToolLoadingMode;
  compatibleRemoteToolNames: string[];
  systemInstructions: string;
  /** Structured system messages preserved for provider dispatch. */
  systemMessages?: ChatSystemMessage[];
};

/** Input payload for prepare hosted chat runtime tool assembly. */
export type PrepareHostedChatRuntimeToolAssemblyInput<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  taskContext: HostedChatRuntimeToolAssemblyContext;
  instructions: string | readonly ChatSystemMessage[];
  /** Re-render instructions after final source/provider tool visibility is known. */
  renderInstructions?: (
    modelVisibleToolNames: readonly string[],
  ) => string | readonly ChatSystemMessage[];
  localTools: HostToolSet;
  hostToolPolicy?: HostedHostToolPolicy;
  apiUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  /**
   * Integration tools the control plane resolved for this run, already verified
   * upstream. They widen the Veryfront API MCP allowlist for this run only.
   */
  serverResolvedIntegrationToolNames?: readonly string[];
  conversationId?: string;
  allowedToolNames?: HostedChatRuntimeAllowedToolNames;
  /**
   * Tool names the agent configuration denied explicitly (`false` entries).
   * Removed from the host tool set before runtime-essential preservation, so
   * a denied skill loader cannot be re-added on the hosted path.
   */
  deniedToolNames?: readonly string[];
  allowedProviderToolNames?: HostedChatRuntimeAllowedToolNames;
  includeRuntimeEssentialToolsWhenEmpty?: boolean;
  sourceProviderToolNames?: readonly string[];
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
  createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  traceLocalTools?: TraceHostToolsOptions<TTraceAttributes>;
  getProjectId?: () => string | null | undefined;
  getActiveBranchId?: () => string | null | undefined;
  prepareRemoteToolInput?: HostedProjectRemoteToolSourcePrepareToolInput;
  shouldRetryWithRemoteTool?: HostedProjectRemoteToolSourceRetryPolicy;
  onSteeringMutation?: HostedProjectRemoteToolSourceMutationHandler;
  onStudioProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  preloadLatestConversationUserText?: boolean;
  /**
   * Per-run tool activation context. When its `activatedRemoteToolNames` Set is
   * present, it is passed by reference to every remote tool source as the live
   * execution gate, so growing the Set exposes tools without re-creating the
   * sources. Deprecated: no framework path populates this. It is retained
   * because `PrepareHostedChatRuntimeToolAssemblyInput` is public API.
   *
   * @deprecated Use `tool_search` deferred loading. See
   * `docs/architecture/28-model-driven-tool-discovery.md`.
   */
  toolDiscoveryContext?: RuntimeToolDiscoveryContext;
  /** Exact project-source restriction applied before tool inventory is exposed. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
};

/**
 * Widen the Veryfront API MCP server's allowlist with a run's server-resolved
 * integration tools.
 *
 * The product policy that hosts ship is a static allowlist, so a project's
 * connected integration tools are absent from it by construction. This adds
 * exactly the names the control plane resolved for this run, and only to the
 * `veryfront-api` server. A server that denies a name keeps denying it, and an
 * unrestricted server (no `allow`) is left alone because it already permits
 * everything.
 */
export function augmentVeryfrontApiMcpServerPolicy(
  mcpServers: readonly AgentServiceMcpServerConfig[] | undefined,
  integrationToolNames: readonly string[] | undefined,
): readonly AgentServiceMcpServerConfig[] | undefined {
  if (!mcpServers || !integrationToolNames || integrationToolNames.length === 0) {
    return mcpServers;
  }

  return mcpServers.map((server) => {
    if (server.kind !== "veryfront-api" || !server.toolPolicy?.allow) {
      return server;
    }
    const denied = new Set(server.toolPolicy.deny ?? []);
    const allow = new Set(server.toolPolicy.allow);
    for (const toolName of integrationToolNames) {
      if (!denied.has(toolName)) allow.add(toolName);
    }
    return {
      ...server,
      toolPolicy: { ...server.toolPolicy, allow: [...allow] },
    };
  });
}

function withoutDeniedHostTools(
  tools: HostToolSet,
  deniedToolNames: readonly string[] | undefined,
): HostToolSet {
  if (!deniedToolNames?.length) {
    return tools;
  }
  const denied = new Set(deniedToolNames);
  return Object.fromEntries(
    Object.entries(tools).filter(([toolName, tool]) =>
      !denied.has(toolName) &&
      (tool.shortName === undefined || !denied.has(tool.shortName))
    ),
  );
}

/**
 * Explicit denials must also hold on the remote path: `allowedToolNames` can
 * be null (no filtering), so a denied MCP-backed tool would stay discoverable
 * and executable. The deny wrapper filters listings and rejects execution.
 */
function withoutDeniedRemoteTools(
  sources: RemoteToolSource[],
  deniedToolNames: readonly string[] | undefined,
): RemoteToolSource[] {
  if (!deniedToolNames?.length) {
    return sources;
  }
  const deny = [...deniedToolNames];
  return sources.map((source) =>
    wrapRemoteToolSourceWithMcpPolicy(source, { deny }, {
      deniedDetail: (toolName) => `Tool "${toolName}" is denied by the agent configuration`,
    })
  );
}

function applyHostedHostToolPolicy(
  tools: HostToolSet,
  policy: HostedHostToolPolicy | undefined,
): HostToolSet {
  if (policy === undefined) {
    return tools;
  }
  const allowed = new Set(policy.allow);
  return Object.fromEntries(
    Object.entries(tools).filter(([registeredName, tool]) =>
      allowed.has(registeredName) ||
      (tool.shortName !== undefined && allowed.has(tool.shortName))
    ),
  );
}

function activeProjectId(taskContext: HostedChatRuntimeToolAssemblyContext): string | null {
  return taskContext.projectId || null;
}

function activeBranchId(taskContext: HostedChatRuntimeToolAssemblyContext): string | null {
  return taskContext.branchId ?? null;
}

function hasSubmittedFormInputResult(
  taskContext: HostedChatRuntimeToolAssemblyContext,
): boolean {
  return taskContext.submittedFormInputResult !== undefined;
}

function filterPostFormInputLocalTools(
  tools: HostToolSet,
  taskContext: HostedChatRuntimeToolAssemblyContext,
): HostToolSet {
  if (!hasSubmittedFormInputResult(taskContext)) {
    return tools;
  }

  const blockedToolNames = new Set(["form_input", "load_skill"]);
  return Object.fromEntries(
    Object.entries(tools).filter(([toolName]) => !blockedToolNames.has(toolName)),
  );
}

function resolveOwnerScopedToolName(input: {
  toolName: string;
  agentId?: string;
  localTools: HostToolSet;
}): string {
  if (input.agentId === undefined) {
    return input.toolName;
  }

  for (const [registeredName, tool] of Object.entries(input.localTools)) {
    if (
      tool.ownerAgentId === input.agentId &&
      tool.shortName === input.toolName
    ) {
      return registeredName;
    }
  }

  return input.toolName;
}

function resolveOwnerScopedToolNames(input: {
  toolNames: HostedChatRuntimeAllowedToolNames | undefined;
  agentId?: string;
  localTools: HostToolSet;
}): HostedChatRuntimeAllowedToolNames | undefined {
  const toolNames = normalizeHostedRuntimeAllowedToolNames(input.toolNames);
  if (toolNames === null) {
    return input.toolNames;
  }

  const resolvedToolNames = new Set<string>();
  for (const toolName of toolNames) {
    resolvedToolNames.add(
      resolveOwnerScopedToolName({
        toolName,
        agentId: input.agentId,
        localTools: input.localTools,
      }),
    );
  }

  return resolvedToolNames;
}

/** Filter hosted chat runtime local tools. */
export function filterHostedChatRuntimeLocalTools(input: {
  tools: HostToolSet;
  allowedToolNames?: HostedChatRuntimeAllowedToolNames;
  sourceProviderToolNames?: readonly string[];
}): HostToolSet {
  const allowedToolNames = normalizeHostedRuntimeAllowedToolNames(input.allowedToolNames);
  const entries = Object.entries(input.tools).filter(([toolName]) =>
    allowedToolNames ? allowedToolNames.has(toolName) : true
  );

  return Object.fromEntries(entries.sort(([left], [right]) => compareStrings(left, right)));
}

function shouldIncludeHostedWebFetchFallback(input: {
  localTools: HostToolSet;
  sourceProviderToolNames: Set<string>;
  allowedToolNames: ReadonlySet<string> | null;
  allowedProviderToolNames: ReadonlySet<string> | null;
  providerNativeToolNames: readonly string[];
}): boolean {
  if (!Object.hasOwn(input.localTools, "web_fetch")) {
    return false;
  }
  if (input.providerNativeToolNames.includes("web_fetch")) {
    return false;
  }
  if (input.allowedProviderToolNames !== null) {
    return input.allowedProviderToolNames.has("web_fetch");
  }
  if (input.allowedToolNames !== null) {
    return input.allowedToolNames.has("web_fetch");
  }
  return input.sourceProviderToolNames.has("web_fetch");
}

/** Prepare hosted chat runtime tool assembly. */
export async function prepareHostedChatRuntimeToolAssembly<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: PrepareHostedChatRuntimeToolAssemblyInput<TTraceAttributes>,
): Promise<HostedChatRuntimeToolAssemblyResult> {
  const authorizedLocalTools = withoutDeniedHostTools(
    applyHostedHostToolPolicy(input.localTools, input.hostToolPolicy),
    input.deniedToolNames,
  );
  const ownerScopedAllowedToolNames = resolveOwnerScopedToolNames({
    toolNames: input.allowedToolNames,
    agentId: input.taskContext.agentId,
    localTools: authorizedLocalTools,
  });
  const normalizedAllowedToolNames = normalizeHostedRuntimeAllowedToolNames(
    ownerScopedAllowedToolNames,
  );
  const allowedToolNames = resolveHostedRuntimeAllowedToolNames({
    allowedToolNames: normalizedAllowedToolNames,
    localToolNames: Object.keys(authorizedLocalTools),
    availableSkillIds: input.taskContext.availableSkillIds,
    includeRuntimeEssentialToolsWhenEmpty: input.includeRuntimeEssentialToolsWhenEmpty,
  });
  const postFormInputLocalTools = filterPostFormInputLocalTools(
    authorizedLocalTools,
    input.taskContext,
  );
  const selectedLocalTools = filterHostedChatRuntimeLocalTools({
    tools: postFormInputLocalTools,
    allowedToolNames,
    sourceProviderToolNames: input.sourceProviderToolNames,
  });
  const sourceProviderToolNames = new Set(input.sourceProviderToolNames ?? []);
  const allowedProviderToolNames = normalizeHostedRuntimeAllowedToolNames(
    input.allowedProviderToolNames,
  );
  const providerNativeToolNames = getProviderNativeToolNames({ model: input.taskContext.model });
  const sortedLocalToolEntries = Object.entries(selectedLocalTools).filter(([toolName]) =>
    isIntegrationToolAllowedBySourcePolicy(toolName, input.sourceIntegrationPolicy)
  );
  if (
    !Object.hasOwn(selectedLocalTools, "web_fetch") &&
    shouldIncludeHostedWebFetchFallback({
      localTools: postFormInputLocalTools,
      sourceProviderToolNames,
      allowedToolNames,
      allowedProviderToolNames,
      providerNativeToolNames,
    }) && isIntegrationToolAllowedBySourcePolicy("web_fetch", input.sourceIntegrationPolicy)
  ) {
    const hostedWebFetchTool = postFormInputLocalTools.web_fetch;
    if (hostedWebFetchTool !== undefined) {
      sortedLocalToolEntries.push(["web_fetch", hostedWebFetchTool]);
    }
  }
  const sortedLocalTools = Object.fromEntries(
    sortedLocalToolEntries.sort(([left], [right]) => compareStrings(left, right)),
  );
  const localHostTools = input.traceLocalTools
    ? traceHostTools(sortedLocalTools, input.traceLocalTools)
    : sortedLocalTools;

  const remoteToolSources = withoutDeniedRemoteTools(
    createHostedProjectRemoteToolSources({
      authToken: input.taskContext.authToken,
      apiMcpUrl: input.apiMcpUrl,
      studioMcpUrl: input.studioMcpUrl,
      mcpServers: augmentVeryfrontApiMcpServerPolicy(
        input.mcpServers,
        input.serverResolvedIntegrationToolNames,
      ),
      clientProfile: input.taskContext.clientProfile,
      createRemoteToolSource: input.createRemoteToolSource ?? createRemoteMCPToolSource,
      defaultProjectId: () => activeProjectId(input.taskContext),
      getProjectId: input.getProjectId ?? (() => activeProjectId(input.taskContext)),
      getActiveBranchId: input.getActiveBranchId ?? (() => activeBranchId(input.taskContext)),
      conversationId: input.conversationId,
      allowedToolNames,
      ...(input.toolDiscoveryContext?.activatedRemoteToolNames !== undefined
        ? { activatedRemoteToolNames: input.toolDiscoveryContext.activatedRemoteToolNames }
        : {}),
      projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
      prepareToolInput: input.prepareRemoteToolInput,
      shouldRetryWithTool: input.shouldRetryWithRemoteTool,
      onSteeringMutation: input.onSteeringMutation,
      onStudioProjectSwitch: input.onStudioProjectSwitch,
    }),
    input.deniedToolNames,
  );
  const listedRemoteToolNames = await listProjectScopedRemoteToolNames(remoteToolSources, {
    projectId: activeProjectId(input.taskContext),
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
  });
  const remoteToolNames = applySourceIntegrationPolicy(
    listedRemoteToolNames,
    input.sourceIntegrationPolicy,
  );
  const localProviderToolNames = new Set(
    Object.keys(sortedLocalTools).filter((toolName) => providerNativeToolNames.includes(toolName)),
  );
  // Explicit denials also bind provider-native tools: a denied name must not
  // reach the model through the provider channel after the host and remote
  // paths filtered it out.
  const deniedProviderToolNames = new Set(input.deniedToolNames ?? []);
  const selectedProviderToolNames = providerNativeToolNames.filter(
    (toolName) =>
      !deniedProviderToolNames.has(toolName) &&
      !localProviderToolNames.has(toolName) &&
      (allowedProviderToolNames
        ? allowedProviderToolNames.has(toolName)
        : allowedToolNames
        ? allowedToolNames.has(toolName)
        : sourceProviderToolNames.has(toolName)),
  );
  const providerToolNames = applySourceIntegrationPolicy(
    selectedProviderToolNames,
    input.sourceIntegrationPolicy,
  );
  const localToolNames = Object.keys(localHostTools);
  const toolLoadingMode: RuntimeToolLoadingMode = normalizedAllowedToolNames === null
    ? "deferred"
    : "eager";
  const authorizedToolNames = [
    ...new Set([...localToolNames, ...providerToolNames, ...remoteToolNames]),
  ].sort(compareStrings);
  // Deferred mode sends only bootstrap/search plus explicitly loaded schemas to
  // the model, so the provider schema limit must not truncate its searchable or
  // executable authorization catalog. Eager mode still needs an up-front cap.
  const availableToolNames = toolLoadingMode === "deferred"
    ? authorizedToolNames
    : selectProviderCompatibleToolNames(authorizedToolNames, {
      model: input.taskContext.model,
      requiredToolNames: localToolNames,
    });
  const compatibleToolNames = new Set(availableToolNames);
  const compatibleRemoteToolNames = toolLoadingMode === "deferred"
    ? remoteToolNames
    : remoteToolNames.filter((toolName) => compatibleToolNames.has(toolName));
  const bootstrapToolNames = availableToolNames.filter((toolName) => toolName === "load_skill");
  const hasDeferredTools = availableToolNames.length > bootstrapToolNames.length;
  const modelVisibleToolNames = toolLoadingMode === "deferred"
    ? [
      ...bootstrapToolNames,
      ...(hasDeferredTools ? [TOOL_SEARCH_TOOL_NAME] : []),
    ].sort(compareStrings)
    : availableToolNames;

  input.taskContext.availableToolNames = modelVisibleToolNames;
  const modelInstructions = input.renderInstructions?.(modelVisibleToolNames) ??
    input.instructions;
  const instructionsWithToolInventory = withRuntimeToolInventory(
    modelInstructions,
    modelVisibleToolNames,
  );
  const systemInstructions = flattenSystemInstructions(instructionsWithToolInventory);
  const systemMessages = typeof modelInstructions === "string"
    ? undefined
    : instructionsWithToolInventory;

  if (input.preloadLatestConversationUserText !== false) {
    const latestUserText = await fetchLatestConversationUserText({
      apiUrl: input.apiUrl,
      authToken: input.taskContext.authToken,
      conversationId: input.conversationId,
    });
    updateDefaultResearchArtifacts({
      taskContext: input.taskContext,
      latestUserText,
      system: systemInstructions,
    });
  }

  return {
    sourceIntegrationPolicy: input.sourceIntegrationPolicy,
    runtimeTools: createToolsFromHostDefinitions(localHostTools),
    remoteToolSources,
    localToolNames,
    remoteToolNames,
    providerToolNames,
    availableToolNames,
    modelVisibleToolNames,
    toolLoadingMode,
    compatibleRemoteToolNames,
    systemInstructions,
    ...(systemMessages === undefined ? {} : { systemMessages }),
  };
}
