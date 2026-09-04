import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { ModelRuntime } from "#veryfront/provider";
import type { AgentConfig, AgentSystem, Message } from "../types.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { filterToolsForSkill, type SkillToolAvailability } from "#veryfront/skill/allowed-tools.ts";
import { resolveSkillToolDisposition } from "../skill-tool-disposition.ts";
import type { ToolConfigEntry } from "./tool-helpers.ts";
import { filterToolsAfterSubmittedFormInput } from "./skill-policy-enforcement.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { RemoteIntegrationToolDiscoveryResult } from "#veryfront/integrations/remote-tools.ts";
import {
  resolveRuntimeToolLoading,
  SOURCE_INTEGRATION_POLICY_CONTEXT_KEY,
} from "./runtime-tool-config.ts";
import {
  createToolExposurePlan,
  createToolExposureState,
  restoreToolExposureState,
  type ToolExposureCheckpoint,
  type ToolExposurePlan,
  type ToolExposureState,
} from "./tool-exposure.ts";
import {
  flattenSystemInstructions,
  hasRuntimeToolInventory,
  withRuntimeToolInventory,
} from "./tool-inventory.ts";
import { getProviderToolProfile } from "./provider-tool-compat.ts";
import { resolveModelProviderOptionKey } from "./model-resolution.ts";
import { createProviderNativeToolExposureDefinitions } from "./provider-native-tool-inventory.ts";

const IntrinsicSet = Set;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicSetAdd = Set.prototype.add;
const IntrinsicSetHas = Set.prototype.has;

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return IntrinsicReflectApply(IntrinsicSetHas, set, [value]) as boolean;
}

function collectToolNames(tools: readonly ToolDefinition[]): Set<string> {
  const names = new IntrinsicSet<string>();
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    if (tool !== undefined) IntrinsicReflectApply(IntrinsicSetAdd, names, [tool.name]);
  }
  return names;
}

export type AgentRuntimeStepMode = "generate" | "stream";

export type RuntimeStepToolLoader = (
  toolsConfig: true | Record<string, ToolConfigEntry> | undefined,
  options?: {
    includeSkillTools?: boolean;
    includeIntegrationTools?: boolean;
    allowedRemoteToolNames?: string[];
    forwardedRemoteToolDefinitions?: ToolDefinition[];
    remoteToolSources?: RemoteToolSource[];
    remoteToolContext?: ToolExecutionContext;
    onIntegrationToolDiscovery?: (result: RemoteIntegrationToolDiscoveryResult) => void;
    sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
    strictConfiguredToolsOnly?: boolean;
    callerAgentId?: string;
  },
) => Promise<ToolDefinition[]>;

export interface AgentRuntimeStepState {
  systemPrompt: AgentSystem;
  context?: Record<string, unknown>;
}

export type RuntimeStepStateResolver = (
  messages: Message[],
  runtimeContext: Record<string, unknown> | undefined,
  mode: AgentRuntimeStepMode,
  step: number,
  systemPrompt: AgentSystem,
  providerOptionKey: string | undefined,
) => Promise<AgentRuntimeStepState>;

export interface PrepareAgentRuntimeStepInput {
  agentId: string;
  activeSkillId?: string | undefined;
  activeSkillToolAvailability: SkillToolAvailability | undefined;
  allowedRemoteToolNames: string[] | undefined;
  config: AgentConfig;
  effectiveModel?: string;
  modelRuntime?: ModelRuntime;
  excludedToolNames?: ReadonlySet<string>;
  forwardedRemoteToolDefinitions: ToolDefinition[] | undefined;
  getAvailableTools: RuntimeStepToolLoader;
  supportsToolCalling: boolean;
  messages: Message[];
  mode: AgentRuntimeStepMode;
  providerOptionKey?: string;
  providerToolNames?: readonly string[];
  remoteToolSources: RemoteToolSource[] | undefined;
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
  resolveRuntimeState: RuntimeStepStateResolver;
  runtimeContext: Record<string, unknown> | undefined;
  step: number;
  systemPrompt: AgentSystem;
  toolContextBase: ToolExecutionContext | undefined;
  strictConfiguredToolsOnly?: boolean;
  toolExposureState?: ToolExposureState;
  toolExposureCheckpoint?: ToolExposureCheckpoint;
}

export interface PreparedAgentRuntimeStep {
  integrationToolDiscovery?: RemoteIntegrationToolDiscoveryResult;
  runtimeContext: Record<string, unknown> | undefined;
  systemPrompt: AgentSystem;
  toolContext: ToolExecutionContext;
  tools: ToolDefinition[];
  toolExposurePlan: ToolExposurePlan;
}

const INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER = "Integration tool discovery status:";
const INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER = "End integration tool discovery status.";

function removeIntegrationToolDiscoveryStatusText(systemPrompt: string): string {
  let result = systemPrompt;
  while (true) {
    const headerIndex = result.indexOf(INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER);
    if (headerIndex < 0) return result;
    const footerIndex = result.indexOf(
      INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER,
      headerIndex + INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER.length,
    );
    if (footerIndex < 0) return result;

    result = [
      result.slice(0, headerIndex).trimEnd(),
      result.slice(
        footerIndex + INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER.length,
      ).trimStart(),
    ].filter(Boolean).join("\n\n");
  }
}

function removeIntegrationToolDiscoveryStatus(systemPrompt: AgentSystem): AgentSystem {
  if (typeof systemPrompt === "string") {
    return removeIntegrationToolDiscoveryStatusText(systemPrompt);
  }

  return systemPrompt.flatMap((message) => {
    const content = removeIntegrationToolDiscoveryStatusText(message.content);
    return content.length > 0 ? [{ ...message, content }] : [];
  });
}

export function withIntegrationToolDiscoveryStatus(
  systemPrompt: string,
  discovery: RemoteIntegrationToolDiscoveryResult | undefined,
): string;
export function withIntegrationToolDiscoveryStatus(
  systemPrompt: ChatSystemMessage[],
  discovery: RemoteIntegrationToolDiscoveryResult | undefined,
): ChatSystemMessage[];
export function withIntegrationToolDiscoveryStatus(
  systemPrompt: AgentSystem,
  discovery: RemoteIntegrationToolDiscoveryResult | undefined,
): AgentSystem;
export function withIntegrationToolDiscoveryStatus(
  systemPrompt: AgentSystem,
  discovery: RemoteIntegrationToolDiscoveryResult | undefined,
): AgentSystem {
  const basePrompt = removeIntegrationToolDiscoveryStatus(systemPrompt);
  let message: string | undefined;
  if (discovery?.status === "unavailable") {
    message =
      "Integration tool discovery is temporarily unavailable for this run. You must not treat this failure as an empty integration catalog. If the user needs an integration tool, explain that discovery is temporarily unavailable and ask the user to retry.";
  }

  if (!message) return basePrompt;
  const statusBlock =
    `${INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER}\n\n${message}\n\n${INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER}`;
  return typeof basePrompt === "string"
    ? basePrompt.length > 0 ? `${basePrompt}\n\n${statusBlock}` : statusBlock
    : [...basePrompt, { role: "system", content: statusBlock }];
}

/**
 * An agent with a concrete tool map had this decided at construction, where the
 * skill tools were attached or not. `tools: true` draws from the registry on
 * every step instead, so the same rule has to be applied here or a bare agent
 * keeps `load_skill` on one path and loses it on the other.
 *
 * Asking per step also means this path picks up skills registered after the
 * agent was constructed.
 */
function shouldIncludeSkillTools(config: AgentConfig, agentId: string | undefined): boolean {
  return resolveSkillToolDisposition(config, agentId) === "inject";
}

function getTrustedAllowedSkillIds(
  input: PrepareAgentRuntimeStepInput,
): readonly string[] | undefined {
  const value = input.toolContextBase?.allowedSkillIds ?? input.runtimeContext?.allowedSkillIds;
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
    ? value
    : undefined;
}

/** Resolve per-step runtime state and the tools visible for that step. */
export async function prepareAgentRuntimeStep(
  input: PrepareAgentRuntimeStepInput,
): Promise<PreparedAgentRuntimeStep> {
  const trustedAllowedSkillIds = getTrustedAllowedSkillIds(input);
  const runtimeState = await input.resolveRuntimeState(
    input.messages,
    input.runtimeContext,
    input.mode,
    input.step,
    input.systemPrompt,
    input.providerOptionKey ??
      resolveModelProviderOptionKey(input.effectiveModel ?? input.config.model, input.modelRuntime),
  );
  const toolContext: ToolExecutionContext = { ...input.toolContextBase, ...runtimeState.context };
  if (input.toolContextBase?.abortSignal !== undefined) {
    toolContext.abortSignal = input.toolContextBase.abortSignal;
  }
  if (trustedAllowedSkillIds !== undefined) {
    toolContext.allowedSkillIds = [...trustedAllowedSkillIds];
  }
  delete toolContext[SOURCE_INTEGRATION_POLICY_CONTEXT_KEY];
  if (input.sourceIntegrationPolicy !== undefined) {
    toolContext[SOURCE_INTEGRATION_POLICY_CONTEXT_KEY] = input.sourceIntegrationPolicy;
  }
  if (input.activeSkillId !== undefined) {
    toolContext.activeSkillId = input.activeSkillId;
  }
  if (input.activeSkillToolAvailability !== undefined) {
    toolContext.activeSkillToolAvailability = input.activeSkillToolAvailability;
  }

  let integrationToolDiscovery: RemoteIntegrationToolDiscoveryResult | undefined;
  let tools = input.supportsToolCalling
    ? await input.getAvailableTools(input.config.tools, {
      callerAgentId: input.agentId,
      includeSkillTools: shouldIncludeSkillTools(input.config, input.agentId),
      allowedRemoteToolNames: input.allowedRemoteToolNames,
      forwardedRemoteToolDefinitions: input.forwardedRemoteToolDefinitions,
      remoteToolSources: input.remoteToolSources,
      remoteToolContext: toolContext,
      onIntegrationToolDiscovery: (result) => {
        integrationToolDiscovery = result;
      },
      sourceIntegrationPolicy: input.sourceIntegrationPolicy,
      strictConfiguredToolsOnly: input.strictConfiguredToolsOnly,
    })
    : [];

  if (input.activeSkillToolAvailability) {
    tools = filterToolsForSkill(tools, input.activeSkillToolAvailability);
  }
  tools = filterToolsAfterSubmittedFormInput(
    tools,
    input.messages,
    runtimeState.context,
    {
      id: input.activeSkillId,
      toolAvailability: input.activeSkillToolAvailability,
    },
  );
  const excludedToolNames = input.excludedToolNames;
  if (excludedToolNames !== undefined) {
    const included: ToolDefinition[] = [];
    for (let index = 0; index < tools.length; index++) {
      const tool = tools[index];
      if (tool !== undefined && !setHas(excludedToolNames, tool.name)) {
        included[included.length] = tool;
      }
    }
    tools = included;
  }
  if (
    integrationToolDiscovery?.status === "unavailable" &&
    input.forwardedRemoteToolDefinitions?.length
  ) {
    const forwardedToolNames = collectToolNames(input.forwardedRemoteToolDefinitions);
    const usableForwardedTools: ToolDefinition[] = [];
    for (let index = 0; index < tools.length; index++) {
      const tool = tools[index];
      if (tool !== undefined && setHas(forwardedToolNames, tool.name)) {
        usableForwardedTools[usableForwardedTools.length] = tool;
      }
    }
    if (usableForwardedTools.length > 0) {
      integrationToolDiscovery = { status: "ok", tools: usableForwardedTools };
    }
  }
  const existingToolNames = collectToolNames(tools);
  const providerToolDefinitions = createProviderNativeToolExposureDefinitions({
    model: input.effectiveModel ?? input.config.model,
    toolNames: input.providerToolNames ?? [],
  });
  for (let index = 0; index < providerToolDefinitions.length; index++) {
    const tool = providerToolDefinitions[index];
    if (tool !== undefined && !setHas(existingToolNames, tool.name)) {
      tools[tools.length] = tool;
      IntrinsicReflectApply(IntrinsicSetAdd, existingToolNames, [tool.name]);
    }
  }
  const toolExposureState = input.toolExposureState ?? createToolExposureState();
  if (input.toolExposureCheckpoint) {
    const restoredState = restoreToolExposureState(input.toolExposureCheckpoint, tools);
    toolExposureState.loadedToolNames.clear();
    for (const toolName of restoredState.loadedToolNames) {
      toolExposureState.loadedToolNames.add(toolName);
    }
  }
  const toolExposurePlan = createToolExposurePlan({
    authorized: tools,
    mode: resolveRuntimeToolLoading(input.config).mode,
    state: toolExposureState,
    maxVisibleTools: getProviderToolProfile(input.effectiveModel ?? input.config.model).maxTools,
  });
  const baseSystemPrompt = removeIntegrationToolDiscoveryStatus(runtimeState.systemPrompt);
  const instructionsWithToolInventory = hasRuntimeToolInventory(baseSystemPrompt)
    ? withRuntimeToolInventory(
      baseSystemPrompt,
      toolExposurePlan.visible.map((tool) => tool.name),
      // Naming what is deferred is the difference between a tool the model
      // can seek and one it has no reason to believe exists.
      toolExposurePlan.deferred.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    )
    : baseSystemPrompt;
  const systemPrompt = typeof baseSystemPrompt === "string" &&
      Array.isArray(instructionsWithToolInventory)
    ? flattenSystemInstructions(instructionsWithToolInventory)
    : instructionsWithToolInventory;

  return {
    integrationToolDiscovery,
    runtimeContext: trustedAllowedSkillIds === undefined
      ? runtimeState.context
      : { ...runtimeState.context, allowedSkillIds: [...trustedAllowedSkillIds] },
    systemPrompt,
    toolContext,
    tools: toolExposurePlan.visible,
    toolExposurePlan,
  };
}
