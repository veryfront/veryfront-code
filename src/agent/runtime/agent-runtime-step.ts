import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig, Message } from "../types.ts";
import { filterToolsForSkill, type SkillToolAvailability } from "#veryfront/skill/allowed-tools.ts";
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
  systemPrompt: string;
  context?: Record<string, unknown>;
}

export type RuntimeStepStateResolver = (
  messages: Message[],
  runtimeContext: Record<string, unknown> | undefined,
  mode: AgentRuntimeStepMode,
  step: number,
  systemPrompt: string,
) => Promise<AgentRuntimeStepState>;

export interface PrepareAgentRuntimeStepInput {
  agentId: string;
  activeSkillId?: string | undefined;
  activeSkillToolAvailability: SkillToolAvailability | undefined;
  allowedRemoteToolNames: string[] | undefined;
  config: AgentConfig;
  effectiveModel?: string;
  excludedToolNames?: ReadonlySet<string>;
  forwardedRemoteToolDefinitions: ToolDefinition[] | undefined;
  getAvailableTools: RuntimeStepToolLoader;
  supportsToolCalling: boolean;
  messages: Message[];
  mode: AgentRuntimeStepMode;
  providerToolNames?: readonly string[];
  remoteToolSources: RemoteToolSource[] | undefined;
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
  resolveRuntimeState: RuntimeStepStateResolver;
  runtimeContext: Record<string, unknown> | undefined;
  step: number;
  systemPrompt: string;
  toolContextBase: ToolExecutionContext | undefined;
  strictConfiguredToolsOnly?: boolean;
  toolExposureState?: ToolExposureState;
  toolExposureCheckpoint?: ToolExposureCheckpoint;
}

export interface PreparedAgentRuntimeStep {
  integrationToolDiscovery?: RemoteIntegrationToolDiscoveryResult;
  runtimeContext: Record<string, unknown> | undefined;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  tools: ToolDefinition[];
  toolExposurePlan: ToolExposurePlan;
}

const INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER = "Integration tool discovery status:";
const INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER = "End integration tool discovery status.";

function removeIntegrationToolDiscoveryStatus(systemPrompt: string): string {
  const headerIndex = systemPrompt.lastIndexOf(INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER);
  if (headerIndex < 0) return systemPrompt;

  const statusBlock = systemPrompt.slice(headerIndex);
  if (!statusBlock.endsWith(INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER)) return systemPrompt;
  return systemPrompt.slice(0, headerIndex).trimEnd();
}

export function withIntegrationToolDiscoveryStatus(
  systemPrompt: string,
  discovery: RemoteIntegrationToolDiscoveryResult | undefined,
): string {
  const basePrompt = removeIntegrationToolDiscoveryStatus(systemPrompt);
  let message: string | undefined;
  if (discovery?.status === "unavailable") {
    message =
      "Integration tools could not be listed for this run. Do not treat this failure as an empty integration catalog. If the user needs an integration tool, explain that discovery is temporarily unavailable and ask them to retry.";
  }

  if (!message) return basePrompt;
  const statusBlock =
    `${INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER}\n\n${message}\n\n${INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER}`;
  return basePrompt.length > 0 ? `${basePrompt}\n\n${statusBlock}` : statusBlock;
}

function shouldIncludeSkillTools(config: AgentConfig): boolean {
  return config.skills !== false && (!Array.isArray(config.skills) || config.skills.length > 0);
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
      includeSkillTools: shouldIncludeSkillTools(input.config),
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
    tools = tools.filter((tool) => !excludedToolNames.has(tool.name));
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
  const systemPrompt = hasRuntimeToolInventory(baseSystemPrompt)
    ? flattenSystemInstructions(
      withRuntimeToolInventory(
        baseSystemPrompt,
        [...toolExposurePlan.visible.map((tool) => tool.name), ...(input.providerToolNames ?? [])]
          .filter((name, index, names) => names.indexOf(name) === index)
          .sort(),
        // Naming what is deferred is the difference between a tool the model
        // can seek and one it has no reason to believe exists.
        toolExposurePlan.deferred.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      ),
    )
    : baseSystemPrompt;

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
