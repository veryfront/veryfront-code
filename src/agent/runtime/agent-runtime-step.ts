import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig, Message } from "../types.ts";
import { filterToolsForSkill, type SkillToolAvailability } from "#veryfront/skill/allowed-tools.ts";
import type { ToolConfigEntry } from "./tool-helpers.ts";
import { filterToolsAfterSubmittedFormInput } from "./skill-policy-enforcement.ts";

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
  forwardedRemoteToolDefinitions: ToolDefinition[] | undefined;
  getAvailableTools: RuntimeStepToolLoader;
  isLocalModel: boolean;
  messages: Message[];
  mode: AgentRuntimeStepMode;
  remoteToolSources: RemoteToolSource[] | undefined;
  resolveRuntimeState: RuntimeStepStateResolver;
  runtimeContext: Record<string, unknown> | undefined;
  step: number;
  systemPrompt: string;
  toolContextBase: ToolExecutionContext | undefined;
}

export interface PreparedAgentRuntimeStep {
  runtimeContext: Record<string, unknown> | undefined;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  tools: ToolDefinition[];
}

/** Resolve per-step runtime state and the tools visible for that step. */
export async function prepareAgentRuntimeStep(
  input: PrepareAgentRuntimeStepInput,
): Promise<PreparedAgentRuntimeStep> {
  const runtimeState = await input.resolveRuntimeState(
    input.messages,
    input.runtimeContext,
    input.mode,
    input.step,
    input.systemPrompt,
  );
  const toolContext: ToolExecutionContext = { ...input.toolContextBase, ...runtimeState.context };
  // Runtime context is caller-controlled. Only the execution layer may provide
  // the cancellation signal used by model and tool work.
  delete toolContext.abortSignal;
  if (input.toolContextBase?.abortSignal) {
    toolContext.abortSignal = input.toolContextBase.abortSignal;
  }
  if (input.activeSkillId !== undefined) {
    toolContext.activeSkillId = input.activeSkillId;
  }
  if (input.activeSkillToolAvailability !== undefined) {
    toolContext.activeSkillToolAvailability = input.activeSkillToolAvailability;
  }

  let tools = input.isLocalModel ? [] : await input.getAvailableTools(input.config.tools, {
    callerAgentId: input.agentId,
    includeSkillTools: Boolean(input.config.skills),
    allowedRemoteToolNames: input.allowedRemoteToolNames,
    forwardedRemoteToolDefinitions: input.forwardedRemoteToolDefinitions,
    remoteToolSources: input.remoteToolSources,
    remoteToolContext: toolContext,
  });

  if (input.activeSkillPolicy || input.activeSkillToolAvailability) {
    tools = filterToolsForSkill(
      tools,
      input.activeSkillPolicy,
      input.activeSkillToolAvailability,
    );
  }
  tools = filterToolsAfterSubmittedFormInput(tools, input.messages, runtimeState.context);

  return {
    runtimeContext: runtimeState.context,
    systemPrompt: runtimeState.systemPrompt,
    toolContext,
    tools,
  };
}
