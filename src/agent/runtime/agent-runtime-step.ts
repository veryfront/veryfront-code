import {
  concatPrivateArrays,
  everyPrivateArray,
  filterPrivateArray,
  flatMapPrivateArray,
  joinPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import {
  privateTextIndexOf,
  privateTextSlice,
  privateTextTrimEnd,
  privateTextTrimStart,
} from "#veryfront/security/private-text.ts";
import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { ModelRuntime } from "#veryfront/provider";
import type { AgentConfig, AgentSystem, Message } from "../types.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { filterToolsForSkill, type SkillToolAvailability } from "#veryfront/skill/allowed-tools.ts";
import {
  resolveSkillToolDisposition,
  resolveTrustedSkillLoaderToolName,
} from "../skill-tool-disposition.ts";
import type { ToolConfigEntry } from "./tool-helpers.ts";
import { filterToolsAfterSubmittedFormInput } from "./skill-policy-enforcement.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { RemoteIntegrationToolDiscoveryResult } from "#veryfront/integrations/remote-tools.ts";
import {
  getRuntimeToolBootstrapNames,
  resolveRuntimeToolLoading,
  snapshotConfiguredToolBootstrapNames,
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
import { isRuntimeProviderSchemaHiddenTool } from "./local-tool.ts";
import { getProviderToolProfile } from "./provider-tool-compat.ts";
import type { VeryfrontCloudSurfaceId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { resolveModelProviderOptionKey } from "./model-resolution.ts";
import { createProviderNativeToolExposureDefinitions } from "./provider-native-tool-inventory.ts";

const ArrayIsArray = Array.isArray;
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
    unavailableOptionalRemoteToolNames?: string[];
    unavailableOptionalRemoteToolPrefixes?: string[];
    onIntegrationToolDiscovery?: (result: RemoteIntegrationToolDiscoveryResult) => void;
    sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
    strictConfiguredToolsOnly?: boolean;
    frameworkLocalTools?: Record<string, Tool>;
    includeProviderSchemaHiddenTools?: boolean;
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
  /** The authenticated gateway model's resolved wire surface, when available. */
  wireSurface?: VeryfrontCloudSurfaceId;
  /** Model ID whose provider tool limit applies, when it differs from `effectiveModel`. */
  toolSchemaModel?: string;
  /**
   * Schemas the runtime appends after planning (such as the tool-result
   * reader). The plan leaves this many slots under the provider tool limit.
   */
  reservedToolSlots?: number;
  modelRuntime?: ModelRuntime;
  excludedToolNames?: ReadonlySet<string>;
  forwardedRemoteToolDefinitions: ToolDefinition[] | undefined;
  getAvailableTools: RuntimeStepToolLoader;
  unavailableOptionalRemoteToolNames?: string[];
  unavailableOptionalRemoteToolPrefixes?: string[];
  supportsToolCalling: boolean;
  /** Load the authorized catalog for a pending startup skill even when the model cannot call tools. */
  includeStartupAuthorizedTools?: boolean;
  messages: Message[];
  mode: AgentRuntimeStepMode;
  providerOptionKey?: string;
  providerToolNames?: readonly string[];
  authorizedProviderToolNames?: readonly string[];
  remoteToolSources: RemoteToolSource[] | undefined;
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
  resolveRuntimeState: RuntimeStepStateResolver;
  runtimeContext: Record<string, unknown> | undefined;
  step: number;
  systemPrompt: AgentSystem;
  toolContextBase: ToolExecutionContext | undefined;
  strictConfiguredToolsOnly?: boolean;
  frameworkLocalTools?: Record<string, Tool>;
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
  /** Authorized catalog before per-step skill restrictions, for host-controlled startup loads. */
  startupAuthorizedTools: ToolDefinition[];
}

const INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER = "Integration tool discovery status:";
const INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER = "End integration tool discovery status.";

function removeIntegrationToolDiscoveryStatusText(systemPrompt: string): string {
  let result = systemPrompt;
  while (true) {
    const headerIndex = privateTextIndexOf(result, INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER);
    if (headerIndex < 0) return result;
    const footerIndex = privateTextIndexOf(
      result,
      INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER,
      headerIndex + INTEGRATION_TOOL_DISCOVERY_STATUS_HEADER.length,
    );
    if (footerIndex < 0) return result;

    result = joinPrivateArray(
      filterPrivateArray([
        privateTextTrimEnd(privateTextSlice(result, 0, headerIndex)),
        privateTextTrimStart(
          privateTextSlice(result, footerIndex + INTEGRATION_TOOL_DISCOVERY_STATUS_FOOTER.length),
        ),
      ], (text) => text.length > 0),
      "\n\n",
    );
  }
}

function removeIntegrationToolDiscoveryStatus(systemPrompt: AgentSystem): AgentSystem {
  if (typeof systemPrompt === "string") {
    return removeIntegrationToolDiscoveryStatusText(systemPrompt);
  }

  return flatMapPrivateArray(systemPrompt, (message) => {
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
    : concatPrivateArrays<ChatSystemMessage>(basePrompt, [{
      role: "system",
      content: statusBlock,
    }]);
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
  return ArrayIsArray(value) &&
      everyPrivateArray(value, (entry): entry is string => typeof entry === "string")
    ? value
    : undefined;
}

/** Resolve per-step runtime state and the tools visible for that step. */
function reserveToolSlots(
  maxTools: number | undefined,
  reservedToolSlots: number | undefined,
): number | undefined {
  if (maxTools === undefined || reservedToolSlots === undefined || reservedToolSlots <= 0) {
    return maxTools;
  }
  return Math.max(0, maxTools - reservedToolSlots);
}

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
  // Host-controlled startup loads need the authorized catalog even when the
  // model itself cannot call tools; the model still sees no tool schemas.
  const authorizedCatalog = input.supportsToolCalling || input.includeStartupAuthorizedTools
    ? await input.getAvailableTools(input.config.tools, {
      callerAgentId: input.agentId,
      includeSkillTools: shouldIncludeSkillTools(input.config, input.agentId),
      allowedRemoteToolNames: input.allowedRemoteToolNames,
      forwardedRemoteToolDefinitions: input.forwardedRemoteToolDefinitions,
      remoteToolSources: input.remoteToolSources,
      remoteToolContext: toolContext,
      unavailableOptionalRemoteToolNames: input.unavailableOptionalRemoteToolNames,
      unavailableOptionalRemoteToolPrefixes: input.unavailableOptionalRemoteToolPrefixes,
      onIntegrationToolDiscovery: (result) => {
        if (input.supportsToolCalling) integrationToolDiscovery = result;
      },
      sourceIntegrationPolicy: input.sourceIntegrationPolicy,
      strictConfiguredToolsOnly: input.strictConfiguredToolsOnly,
      frameworkLocalTools: input.frameworkLocalTools,
      includeProviderSchemaHiddenTools: true,
    })
    : [];
  let tools = input.supportsToolCalling ? authorizedCatalog : [];

  // Validate authored startup choices against the executable catalog before per-step restrictions.
  const startupAuthorizedTools = authorizedCatalog;

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
  // A host that already selected the model-visible loader (hosted runs hide
  // the unselected alias schema) supplies its bootstrap names. Otherwise
  // bootstrap the loader the skill catalog names, chosen by trusted
  // provenance; a project tool owning a loader spelling is never bootstrapped.
  let bootstrapToolNames = getRuntimeToolBootstrapNames(input.config);
  if (bootstrapToolNames === undefined) {
    const trustedSkillLoaderToolName = resolveTrustedSkillLoaderToolName(input.config.tools);
    const provenanceBootstrapToolNames = new IntrinsicSet<string>();
    if (trustedSkillLoaderToolName !== undefined) {
      IntrinsicReflectApply(IntrinsicSetAdd, provenanceBootstrapToolNames, [
        trustedSkillLoaderToolName,
      ]);
    }
    bootstrapToolNames = provenanceBootstrapToolNames;
  }
  const configuredBootstrapNames = snapshotConfiguredToolBootstrapNames(
    input.config.bootstrapTools,
  );
  if (configuredBootstrapNames.length > 0) {
    const mergedBootstrap = new IntrinsicSet<string>(bootstrapToolNames);
    const authorizedNativeTools = createProviderNativeToolExposureDefinitions({
      model: input.effectiveModel ?? input.config.model,
      toolNames: input.authorizedProviderToolNames ?? input.providerToolNames ?? [],
    });
    const executableCatalog = concatPrivateArrays(startupAuthorizedTools, authorizedNativeTools);
    for (let index = 0; index < configuredBootstrapNames.length; index++) {
      const name = configuredBootstrapNames[index]!;
      if (
        !somePrivateArray(
          executableCatalog,
          (tool) => tool.name === name && !isRuntimeProviderSchemaHiddenTool(tool),
        )
      ) {
        throw new Error("bootstrapTools contains a tool outside the authorized executable catalog");
      }
      // A tool hidden by the active step's restrictions stays hidden.
      if (setHas(existingToolNames, name)) {
        IntrinsicReflectApply(IntrinsicSetAdd, mergedBootstrap, [name]);
      }
    }
    bootstrapToolNames = mergedBootstrap;
  }
  const maxVisibleTools = reserveToolSlots(
    getProviderToolProfile(
      input.toolSchemaModel ?? input.effectiveModel ?? input.config.model,
      input.wireSurface,
    ).maxTools,
    input.reservedToolSlots,
  );
  const toolExposurePlan = createToolExposurePlan({
    authorized: tools,
    mode: resolveRuntimeToolLoading(input.config).mode,
    state: toolExposureState,
    bootstrapToolNames,
    maxVisibleTools,
  });
  if (
    configuredBootstrapNames.length > 0 && maxVisibleTools !== undefined &&
    toolExposurePlan.visible.length > maxVisibleTools
  ) {
    throw new Error("bootstrapTools exceeds the model's visible tool schema limit");
  }
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
      ArrayIsArray(instructionsWithToolInventory)
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
    startupAuthorizedTools,
  };
}
