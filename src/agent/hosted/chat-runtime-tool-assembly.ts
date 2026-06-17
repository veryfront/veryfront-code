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

/** Context for hosted chat runtime tool assembly. */
export type HostedChatRuntimeToolAssemblyContext = DefaultResearchArtifactContext & {
  authToken: string;
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

  const blockedToolNames = new Set(["form_input", "load_skill", "invoke_agent"]);
  return Object.fromEntries(
    Object.entries(tools).filter(([toolName]) => !blockedToolNames.has(toolName)),
  );
}

/** Filter hosted chat runtime local tools. */
export function filterHostedChatRuntimeLocalTools(input: {
  tools: HostToolSet;
  allowedToolNames?: HostedChatRuntimeAllowedToolNames;
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
  const allowedToolNames = resolveHostedRuntimeAllowedToolNames({
    allowedToolNames: input.allowedToolNames,
    localToolNames: Object.keys(input.localTools),
    availableSkillIds: input.taskContext.availableSkillIds,
  });
  const sortedLocalTools = filterHostedChatRuntimeLocalTools({
    tools: filterPostFormInputLocalTools(input.localTools, input.taskContext),
    allowedToolNames,
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
  const providerToolNames = getProviderNativeToolNames({ model: input.taskContext.model }).filter(
    (toolName) =>
      sourceProviderToolNames.has(toolName) ||
      (allowedToolNames ? allowedToolNames.has(toolName) : false),
  );
  const localToolNames = Object.keys(localHostTools);
  const availableToolNames = selectProviderCompatibleToolNames(
    [...new Set([...localToolNames, ...remoteToolNames, ...providerToolNames])].sort(),
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
