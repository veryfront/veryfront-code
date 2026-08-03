import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig, Message } from "../types.ts";
import { filterToolsForSkill, type SkillToolAvailability } from "#veryfront/skill/allowed-tools.ts";
import type { ToolConfigEntry } from "./tool-helpers.ts";
import { filterToolsAfterSubmittedFormInput } from "./skill-policy-enforcement.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
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
  activeSkillPolicy: string[] | undefined;
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
  runtimeContext: Record<string, unknown> | undefined;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  tools: ToolDefinition[];
  toolExposurePlan: ToolExposurePlan;
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

  let tools = input.supportsToolCalling
    ? await input.getAvailableTools(input.config.tools, {
      callerAgentId: input.agentId,
      includeSkillTools: shouldIncludeSkillTools(input.config),
      allowedRemoteToolNames: input.allowedRemoteToolNames,
      forwardedRemoteToolDefinitions: input.forwardedRemoteToolDefinitions,
      remoteToolSources: input.remoteToolSources,
      remoteToolContext: toolContext,
      sourceIntegrationPolicy: input.sourceIntegrationPolicy,
      strictConfiguredToolsOnly: input.strictConfiguredToolsOnly,
    })
    : [];

  if (input.activeSkillPolicy || input.activeSkillToolAvailability) {
    tools = filterToolsForSkill(
      tools,
      input.activeSkillPolicy,
      input.activeSkillToolAvailability,
    );
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
  const systemPrompt = hasRuntimeToolInventory(runtimeState.systemPrompt)
    ? flattenSystemInstructions(
      withRuntimeToolInventory(
        runtimeState.systemPrompt,
        [...toolExposurePlan.visible.map((tool) => tool.name), ...(input.providerToolNames ?? [])]
          .filter((name, index, names) => names.indexOf(name) === index)
          .sort(),
      ),
    )
    : runtimeState.systemPrompt;

  return {
    runtimeContext: trustedAllowedSkillIds === undefined
      ? runtimeState.context
      : { ...runtimeState.context, allowedSkillIds: [...trustedAllowedSkillIds] },
    systemPrompt,
    toolContext,
    tools: toolExposurePlan.visible,
    toolExposurePlan,
  };
}
