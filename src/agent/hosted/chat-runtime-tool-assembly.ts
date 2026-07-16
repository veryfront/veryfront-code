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
import type { RuntimeToolDiscoveryContext } from "../runtime/tool-discovery-context.ts";

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

/** Result returned from hosted chat runtime tool assembly. */
export type HostedChatRuntimeToolAssemblyResult = {
  runtimeTools: ToolSet;
  remoteToolSources: RemoteToolSource[];
  localToolNames: string[];
  remoteToolNames: string[];
  providerToolNames: string[];
  availableToolNames: string[];
  compatibleRemoteToolNames: string[];
  systemInstructions: string;
};

/** Input payload for prepare hosted chat runtime tool assembly. */
export type PrepareHostedChatRuntimeToolAssemblyInput<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  taskContext: HostedChatRuntimeToolAssemblyContext;
  instructions: string | readonly ChatSystemMessage[];
  localTools: HostToolSet;
  apiUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  conversationId?: string;
  allowedToolNames?: HostedChatRuntimeAllowedToolNames;
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
   * Per-run tool discovery context. When provided, its `activatedRemoteToolNames`
   * Set is passed (by reference) to every remote tool source as the live
   * execution gate. The same Set is mutated by `load_tools`, so newly activated
   * tools become executable without re-creating the sources.
   */
  toolDiscoveryContext?: RuntimeToolDiscoveryContext;
};

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

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

/** Prepare hosted chat runtime tool assembly. */
export async function prepareHostedChatRuntimeToolAssembly<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: PrepareHostedChatRuntimeToolAssemblyInput<TTraceAttributes>,
): Promise<HostedChatRuntimeToolAssemblyResult> {
  const ownerScopedAllowedToolNames = resolveOwnerScopedToolNames({
    toolNames: input.allowedToolNames,
    agentId: input.taskContext.agentId,
    localTools: input.localTools,
  });
  const allowedToolNames = resolveHostedRuntimeAllowedToolNames({
    allowedToolNames: ownerScopedAllowedToolNames,
    localToolNames: Object.keys(input.localTools),
    availableSkillIds: input.taskContext.availableSkillIds,
    includeRuntimeEssentialToolsWhenEmpty: input.includeRuntimeEssentialToolsWhenEmpty,
  });
  const sortedLocalTools = filterHostedChatRuntimeLocalTools({
    tools: filterPostFormInputLocalTools(input.localTools, input.taskContext),
    allowedToolNames,
    sourceProviderToolNames: input.sourceProviderToolNames,
  });
  const localHostTools = input.traceLocalTools
    ? traceHostTools(sortedLocalTools, input.traceLocalTools)
    : sortedLocalTools;

  const remoteToolSources = createHostedProjectRemoteToolSources({
    authToken: input.taskContext.authToken,
    apiMcpUrl: input.apiMcpUrl,
    studioMcpUrl: input.studioMcpUrl,
    mcpServers: input.mcpServers,
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
  });
  const remoteToolNames = await listProjectScopedRemoteToolNames(remoteToolSources, {
    projectId: activeProjectId(input.taskContext),
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
  });
  const sourceProviderToolNames = new Set(input.sourceProviderToolNames ?? []);
  const allowedProviderToolNames = normalizeHostedRuntimeAllowedToolNames(
    input.allowedProviderToolNames,
  );
  const providerNativeToolNames = getProviderNativeToolNames({ model: input.taskContext.model });
  const localProviderToolNames = new Set(
    Object.keys(sortedLocalTools).filter((toolName) => providerNativeToolNames.includes(toolName)),
  );
  const providerToolNames = providerNativeToolNames.filter(
    (toolName) =>
      !localProviderToolNames.has(toolName) &&
      (allowedProviderToolNames
        ? allowedProviderToolNames.has(toolName)
        : allowedToolNames
        ? allowedToolNames.has(toolName)
        : sourceProviderToolNames.has(toolName)),
  );
  const localToolNames = Object.keys(localHostTools);
  // Remote tools no longer flood the initial inventory. They are listed in
  // remoteToolNames for catalog purposes and activated on-demand via load_tools.
  // Only local and provider-native tools seed the initial inventory union.
  const availableToolNames = selectProviderCompatibleToolNames(
    [...new Set([...localToolNames, ...providerToolNames])].sort(),
    {
      model: input.taskContext.model,
      requiredToolNames: localToolNames,
    },
  );
  const compatibleToolNames = new Set(availableToolNames);
  const compatibleRemoteToolNames = remoteToolNames.filter((toolName) =>
    compatibleToolNames.has(toolName)
  );

  input.taskContext.availableToolNames = availableToolNames;
  const systemInstructions = flattenSystemInstructions(
    withRuntimeToolInventory(input.instructions, availableToolNames),
  );

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
    runtimeTools: createToolsFromHostDefinitions(localHostTools),
    remoteToolSources,
    localToolNames,
    remoteToolNames,
    providerToolNames,
    availableToolNames,
    compatibleRemoteToolNames,
    systemInstructions,
  };
}
