/**
 * Hosted child tool assembly — MCP server resolution, delegation binding,
 * invoke-agent tool, and project steering/skill accessors for the cloud agent service.
 */
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import {
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  isToolVisibleTo,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  toolRegistry,
} from "#veryfront/tool";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import { parseProviderError } from "../../chat/provider-errors.ts";
import {
  getVeryfrontCloudProviderFromModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "../../provider/veryfront-cloud/model-catalog.ts";
import { filterAgentTraceAttributes } from "./trace-attributes.ts";
import {
  type AgentServiceMcpServerConfig,
  defaultAgentServiceMcpServers,
} from "../service/mcp-server-config.ts";
import type { AgentMcpToolPolicy } from "../types.ts";
import type { RuntimeLoadSkillToolContext } from "../runtime/load-skill-tool.ts";
import type { RuntimeProjectSteeringLookup } from "../runtime/project-skill-catalog.ts";
import {
  resolveRuntimeSkillSelectorForAgent,
  type RuntimeSkillDefinition,
} from "../runtime/skill-metadata.ts";
import type { ResolvedSkillSelectorSnapshot } from "#veryfront/skill/selector.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import { buildAgentDelegateTools } from "../runtime/agent-delegation.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import { createDefaultHostedInvokeAgentTool } from "./default-invoke-agent-tool.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import type {
  DefaultHostedChildAgentExecutionConfig,
  DefaultHostedInvokeAgentConfig,
  DefaultHostedInvokeAgentContext,
} from "./default-invoke-agent-tool.ts";
import type { HostedChildRunIdentifiers } from "./child-status.ts";
import { fetchDefaultHostedProjectSteering } from "./default-project-steering-refresh.ts";
import type { HostedProjectSkillIdsContext } from "./project-steering-adapter.ts";
import { createLiveStudioMcpTools } from "../project/live-studio-mcp-tools.ts";
import {
  getProjectAgentRuntime,
  getProjectSteering,
  getRemoteToolSourceFactory,
  type NodeVeryfrontCloudAgentServiceContext,
  resolveAgentConfig,
} from "./cloud-agent-config.ts";

const HOSTED_CHILD_LOCAL_SKILL_TOOL_NAMES = new Set([
  "execute_skill_script",
  "load_skill",
  "load_skill_reference",
]);

/**
 * Task context carried through a hosted child agent run. Combines the invoke-agent
 * base context with skill/tool availability fields.
 */
export type ChildRunContext =
  & DefaultHostedInvokeAgentContext
  & Pick<
    RuntimeLoadSkillToolContext,
    | "agentId"
    | "availableSkillIds"
    | "skillSelectorPolicy"
    | "skillSourcePaths"
    | "loadedSkillResponses"
    | "loadedSkillReferenceResponses"
  >
  & {
    clientProfile?: RuntimeClientProfile | null;
  };

/**
 * Resolves the effective MCP server list by intersecting service-level options
 * with optional per-agent overrides.
 */
export function resolveMcpServers(
  options: {
    mcpServers?: readonly AgentServiceMcpServerConfig[];
    createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  },
  agentConfig?: Pick<RuntimeAgentMarkdownDefinition, "mcpServers">,
): readonly AgentServiceMcpServerConfig[] {
  // A deployment-owned transport is a privileged capability. When present,
  // omitting mcpServers locks the service to first-party defaults as its
  // authority ceiling, so tenant configuration cannot bind that transport to
  // arbitrary endpoints.
  const serviceMcpServers = options.mcpServers ??
    (options.createRemoteToolSource === undefined ? undefined : defaultAgentServiceMcpServers());

  if (serviceMcpServers !== undefined) {
    if (agentConfig?.mcpServers === undefined) {
      return serviceMcpServers;
    }
    return agentConfig.mcpServers.flatMap((agentServer) => {
      const hostServer = serviceMcpServers.find((server) =>
        server.kind === agentServer.kind && server.id === agentServer.id
      );
      if (!hostServer) {
        return [];
      }
      const toolPolicy = mergeMcpToolPolicies(hostServer.toolPolicy, agentServer.toolPolicy);
      return [{
        ...hostServer,
        ...(toolPolicy === undefined ? {} : { toolPolicy }),
      }];
    });
  }

  if (agentConfig?.mcpServers !== undefined) {
    return agentConfig.mcpServers;
  }
  return defaultAgentServiceMcpServers();
}

function mergeMcpToolPolicies(
  hostPolicy: AgentMcpToolPolicy | undefined,
  agentPolicy: AgentMcpToolPolicy | undefined,
): AgentMcpToolPolicy | undefined {
  if (hostPolicy === undefined) {
    return agentPolicy;
  }
  if (agentPolicy === undefined) {
    return hostPolicy;
  }

  const allow = hostPolicy.allow === undefined
    ? agentPolicy.allow
    : agentPolicy.allow === undefined
    ? hostPolicy.allow
    : hostPolicy.allow.filter((toolName) => agentPolicy.allow?.includes(toolName));
  const deny = [
    ...new Set([
      ...(hostPolicy.deny ?? []),
      ...(agentPolicy.deny ?? []),
    ]),
  ];
  const approval = hostPolicy.approval ?? agentPolicy.approval;

  return {
    ...(allow === undefined ? {} : { allow }),
    ...(deny.length === 0 ? {} : { deny }),
    ...(approval === undefined ? {} : { approval }),
  };
}

/**
 * Returns the set of host tools visible to the given agent scope, excluding
 * shared skill infrastructure tools (load_skill_reference, execute_skill_script).
 */
export function getDiscoveredHostTools(scope?: { agentId?: string }): HostToolSet {
  // Without an agent identity, this remains the project-level host tool spread
  // and matches MCP tools/list: project-level callers see only unowned tools.
  // Hosted per-agent runs pass their task context identity so owned colocated
  // tools are available to their owner and hidden from other agents.
  // Shared skill tools use local registry and filesystem state. Hosted runs
  // instead add the request-scoped load_skill tool below; its optional file
  // input reads references with project, branch, auth, and owner context.
  // Hosted runs do not execute skill scripts directly.
  return Object.fromEntries(
    [...toolRegistry.getAll()]
      .filter(([toolId, registryTool]) =>
        !isSkillInfrastructureToolId(toolId) && isToolVisibleTo(registryTool, scope)
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Fetches the project instructions for the given agent id and lookup context. */
export function getProjectInstructions(
  context: NodeVeryfrontCloudAgentServiceContext,
  lookup: RuntimeProjectSteeringLookup,
  agentId?: string,
): Promise<string> {
  return context.trace("chat.getProjectInstructions", async () => {
    return await getProjectSteering(context, agentId).getProjectInstructions(lookup);
  });
}

/** Fetches the resolved skill definitions for the given agent id and lookup context. */
export function getSkillsConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  lookup: RuntimeProjectSteeringLookup,
  agentId?: string,
): Promise<RuntimeSkillDefinition[]> {
  return context.trace("chat.getSkillsConfig", async () => {
    return await getProjectSteering(context, agentId).getSkillsConfig(lookup);
  });
}

/** Creates the load_skill tool scoped to the given tool context. */
export function createLoadSkillTool(
  context: NodeVeryfrontCloudAgentServiceContext,
  toolContext: RuntimeLoadSkillToolContext,
) {
  return getProjectSteering(context, toolContext.agentId).createLoadSkillTool(toolContext);
}

/** Refreshes the project skill ids for the given skill context. */
export async function refreshProjectSkillIds(
  context: NodeVeryfrontCloudAgentServiceContext,
  skillContext: HostedProjectSkillIdsContext,
): Promise<void> {
  await getProjectSteering(context, skillContext.agentId).refreshProjectSkillIds(skillContext);
}

/** Sets filtered trace attributes on the active span. */
export function setFilteredTraceAttributes(
  context: NodeVeryfrontCloudAgentServiceContext,
  attributes: Record<string, unknown>,
): void {
  context.infrastructure.setActiveSpanAttributes(filterAgentTraceAttributes(attributes));
}

function getInvokeAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
): DefaultHostedInvokeAgentConfig {
  const config = context.infrastructure.getConfig();

  return {
    apiUrl: config.VERYFRONT_API_URL,
    apiMcpUrl: config.VERYFRONT_MCP_URL,
    studioMcpUrl: config.VERYFRONT_STUDIO_MCP_URL,
    mcpServers: resolveMcpServers(context.options),
    enableDurableInvokeAgent: config.VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT,
  };
}

function shouldRethrowInvokeAgentError(error: unknown): boolean {
  return parseProviderError(error).code === "INSUFFICIENT_CREDITS";
}

/** Resolves the effective tool name allowlist for a hosted child agent run. */
export function resolveHostedChildToolNames(
  agentConfig: RuntimeAgentMarkdownDefinition,
  skillSelectorSnapshot?: Pick<
    ResolvedSkillSelectorSnapshot<RuntimeSkillDefinition>,
    "allowedSkillIds"
  >,
): string[] | undefined {
  if (agentConfig.tools === true) {
    if (agentConfig.deniedTools?.length) return [];
    return undefined;
  }

  const deniedToolNames = new Set(agentConfig.deniedTools ?? []);
  const hasAuthorizedSkills = skillSelectorSnapshot === undefined ||
    skillSelectorSnapshot.allowedSkillIds.length > 0;
  return [
    ...new Set([
      ...(agentConfig.tools ?? []).filter((toolName) =>
        !HOSTED_CHILD_LOCAL_SKILL_TOOL_NAMES.has(toolName)
      ),
      ...(agentConfig.providerTools ?? []),
      ...(agentConfig.delegates ?? []).map((id) => `agent_${id}`),
      ...(hasAuthorizedSkills && !deniedToolNames.has("load_skill") ? ["load_skill"] : []),
    ]),
  ].filter((toolName) => !deniedToolNames.has(toolName));
}

/** Builds host tools for a configured hosted child run. */
export function buildHostedChildGlobalTools(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: {
    childAgentId: string;
    childConfig?: DefaultHostedChildAgentExecutionConfig;
    childToolContext: ChildRunContext;
  },
): HostToolSet {
  return {
    ...(input.childConfig ? getDiscoveredHostTools({ agentId: input.childAgentId }) : {}),
    // An undefined selector (`tools: true`) authorizes the loader unless it is
    // explicitly denied; a concrete selector must retain `load_skill` itself.
    ...(!input.childConfig ||
        ((input.childConfig.availableSkillIds?.length ?? 0) > 0 &&
          (input.childConfig.toolNames === undefined
            ? input.childConfig.deniedToolNames?.includes("load_skill") !== true
            : input.childConfig.toolNames.includes("load_skill")))
      ? { load_skill: createLoadSkillTool(context, input.childToolContext) }
      : {}),
    ...(input.childConfig?.delegateIds?.length
      ? buildHostedDelegateTools(context, {
        delegates: input.childConfig.delegateIds,
        selfId: input.childAgentId,
        taskContext: input.childToolContext,
      })
      : {}),
  };
}

/** Builds the child run context for a nested hosted agent invocation. */
export function buildHostedChildToolContext(
  globalToolContext: ChildRunContext,
  childAgentId: string,
  childConfig: DefaultHostedChildAgentExecutionConfig | undefined,
  durableChildRun?: HostedChildRunIdentifiers,
): ChildRunContext {
  return {
    ...globalToolContext,
    agentId: childAgentId,
    ...(childConfig
      ? {
        availableSkillIds: childConfig.availableSkillIds,
        skillSelectorPolicy: childConfig.skillSelectorPolicy,
        skillSourcePaths: childConfig.skillSourcePaths,
      }
      : {}),
    ...(childConfig?.toolNames ? { availableToolNames: childConfig.toolNames } : {}),
    loadedSkillResponses: {},
    loadedSkillReferenceResponses: {},
    ...(durableChildRun
      ? {
        conversationId: durableChildRun.childConversationId,
        parentRunId: durableChildRun.childRunId,
        parentMessageId: durableChildRun.childMessageId,
      }
      : {}),
  };
}

/** Fetches project steering for a given project / auth / branch combination. */
export function fetchProjectSteering(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: { projectId: string | null; authToken: string; branchId?: string | null },
  agentId?: string,
) {
  return fetchDefaultHostedProjectSteering({
    ...input,
    fetchProjectInstructions: (lookup) => getProjectInstructions(context, lookup, agentId),
    fetchSkills: (lookup) => getSkillsConfig(context, lookup, agentId),
    trace: context.trace,
    traceOperationName: "chat.fetchSteering",
  });
}

/** Resolves the execution config for a hosted child agent invocation. */
export async function resolveHostedChildAgentExecutionConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  taskContext: ChildRunContext,
  childAgentId: string,
  projectId: string,
): Promise<DefaultHostedChildAgentExecutionConfig | undefined> {
  if (!getProjectAgentRuntime(context).agents.has(childAgentId)) {
    return undefined;
  }

  const agentConfig = await resolveAgentConfig(context, childAgentId);
  const branchId = projectId === taskContext.projectId ? taskContext.branchId : null;
  const steering = await fetchProjectSteering(context, {
    projectId: projectId || null,
    authToken: taskContext.authToken,
    branchId,
  }, childAgentId);
  const skillSelectorSnapshot = resolveRuntimeSkillSelectorForAgent({
    skills: steering.skills,
    agentId: childAgentId,
    selector: agentConfig.skills === false ? [] : agentConfig.skills,
  });
  const toolNames = resolveHostedChildToolNames(agentConfig, skillSelectorSnapshot);
  // The skill catalog and the load_skill fork guidance both advertise the
  // loader, so they must track its effective availability: an undefined
  // selector (`tools: true`) exposes it unless explicitly denied, and a
  // concrete selector exposes it only when it survived denial filtering.
  const skillLoaderExposed = toolNames === undefined
    ? agentConfig.deniedTools?.includes("load_skill") !== true
    : toolNames.includes("load_skill");
  const thinking = agentConfig.thinking?.enabled === false ? 0 : agentConfig.thinking?.budgetTokens;

  return {
    system: buildVeryfrontCloudRuntimeInstructions({
      agentConfig,
      projectId: projectId || null,
      branchId,
      instructions: steering.instructions,
      skills: skillLoaderExposed ? skillSelectorSnapshot.definitions : [],
      availableToolNames: toolNames,
    }),
    ...(agentConfig.model ? { model: agentConfig.model } : {}),
    ...(agentConfig.temperature === undefined ? {} : { temperature: agentConfig.temperature }),
    ...(agentConfig.maxSteps === undefined ? {} : { maxSteps: agentConfig.maxSteps }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(toolNames === undefined ? {} : { toolNames }),
    ...(agentConfig.deniedTools?.length ? { deniedToolNames: [...agentConfig.deniedTools] } : {}),
    mcpServers: resolveMcpServers(context.options, agentConfig),
    availableSkillIds: skillLoaderExposed ? skillSelectorSnapshot.allowedSkillIds : [],
    skillSelectorPolicy: skillSelectorSnapshot.policy,
    ...(Object.keys(skillSelectorSnapshot.skillSourcePaths).length > 0
      ? { skillSourcePaths: skillSelectorSnapshot.skillSourcePaths }
      : {}),
    ...(agentConfig.delegates === undefined ? {} : { delegateIds: agentConfig.delegates }),
  };
}

/** Creates the invoke_agent tool for the given child context. */
export function createInvokeAgentTool(
  context: NodeVeryfrontCloudAgentServiceContext,
  childContext: ChildRunContext,
  options?: { requireDurable?: boolean },
) {
  return createDefaultHostedInvokeAgentTool({
    context: childContext,
    getConfig: () => getInvokeAgentConfig(context),
    logger: context.infrastructure.logger,
    trace: context.trace,
    setTraceAttributes: context.infrastructure.setActiveSpanAttributes,
    createBashTool: context.options.createBashTool,
    resolveModelId: resolveVeryfrontCloudModelId,
    resolveProvider: getVeryfrontCloudProviderFromModelId,
    resolveModelThinking: resolveVeryfrontCloudModelThinking,
    resolveProviderOptions: resolveVeryfrontCloudThinkingProviderOptions,
    resolveReasoning: resolveVeryfrontCloudReasoningOption,
    shouldRethrowError: shouldRethrowInvokeAgentError,
    buildGlobalTools: (globalToolContext, childAgentId, childConfig, durableChildRun) => {
      const childToolContext = buildHostedChildToolContext(
        globalToolContext,
        childAgentId,
        childConfig,
        durableChildRun,
      );
      return buildHostedChildGlobalTools(context, {
        childAgentId,
        childConfig,
        childToolContext,
      });
    },
    resolveChildAgentExecutionConfig: (childAgentId, projectId) =>
      resolveHostedChildAgentExecutionConfig(context, childContext, childAgentId, projectId),
    refreshProjectSkillIds: (projectSkillContext) =>
      refreshProjectSkillIds(context, projectSkillContext),
    createAgentServiceSandboxTools,
    createLiveStudioTools: createLiveStudioMcpTools,
    createRemoteToolSource: getRemoteToolSourceFactory(context),
    createToolsFromRemoteDefinitions,
    requireDurableInvokeAgent: options?.requireDurable,
  });
}

/** Builds the set of delegate agent tools for the given delegate ids. */
export function buildHostedDelegateTools(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: {
    delegates: readonly string[];
    selfId: string;
    taskContext: ChildRunContext;
  },
): HostToolSet {
  const invokeAgent = createInvokeAgentTool(context, input.taskContext, { requireDurable: true });
  return buildAgentDelegateTools({
    delegates: input.delegates,
    selfId: input.selfId,
    resolveAgent: (delegateId) => getProjectAgentRuntime(context).agents.get(delegateId),
    executeDelegate: ({ delegateId, toolInput, context: executionContext }) =>
      invokeAgent.execute({
        agent_id: delegateId,
        description: `Run ${delegateId} specialist task`,
        prompt: toolInput.input,
      }, executionContext),
  });
}

/** The shape of a hosted delegation binding (fixed-target vs. generic). */
export type HostedDelegationBinding =
  | { kind: "scoped"; delegateIds: string[] }
  | { kind: "generic" };

/**
 * Resolves the delegation binding from an agent config. Agents with an explicit
 * `delegates` list use scoped delegation; all others use generic invoke_agent.
 */
export function resolveHostedDelegationBinding(
  agentConfig: RuntimeAgentMarkdownDefinition | undefined,
): HostedDelegationBinding {
  if (agentConfig?.delegates !== undefined) {
    return { kind: "scoped", delegateIds: agentConfig.delegates };
  }
  return { kind: "generic" };
}
