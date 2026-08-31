import {
  type Agent,
  type AgentMessage as Message,
  type AgentResponse,
  AgentRuntime,
  type AgentSystem,
  getRuntimeAgentMarkdownDefinition,
} from "#veryfront/agent";
import { normalizeAgUiRuntimeMessages } from "#veryfront/agent/ag-ui/runtime-support.ts";
import {
  createProviderAwareAgentSystemResolver,
  getEffectiveAgentSystem,
  resolveAgentSystem,
  resolveAgentSystemFromResolvedBase,
} from "#veryfront/agent/runtime/effective-agent-system.ts";
import { flattenSystemInstructions } from "#veryfront/agent/runtime/tool-inventory.ts";
import { compactForStep, estimateOverhead } from "#veryfront/chat/message-prep.ts";
import {
  getRuntimeRemoteToolSources,
  type RuntimeRemoteToolConfig,
} from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { buildRuntimeUsageTraceAttributes } from "#veryfront/agent/runtime/trace-usage.ts";
import { getProviderNativeToolNames } from "#veryfront/agent/runtime/provider-native-tool-inventory.ts";
import { selectProviderCompatibleToolNames } from "#veryfront/agent/runtime/provider-tool-compat.ts";
import { INVOKE_AGENT_TOOL_ID } from "#veryfront/agent/runtime/agent-delegation.ts";
import {
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
} from "#veryfront/agent/runtime/message-adapter.ts";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
} from "#veryfront/sandbox";
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import {
  type SandboxShellToolsProvider,
  SandboxShellToolsProviderName,
} from "#veryfront/extensions/sandbox/index.ts";
import { resolveHostedRuntimeAllowedToolNames } from "#veryfront/agent/hosted/runtime-essential-tools.ts";
import {
  createToolsFromHostDefinitions,
  isToolVisibleTo,
  type Tool,
  type ToolExecutionContext,
  toolRegistry,
} from "#veryfront/tool";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import {
  addSpanEvent,
  setSpanAttributes,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
  parseSseJsonEvents,
} from "./ag-ui-sse.ts";
import type { AgentRunEvent, AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import {
  createAgentRunEventTimingAnchor,
  createTimedAgentRunEventSink,
} from "#veryfront/runtime/model-call-context.ts";
import { stampAgUiEventTiming } from "#veryfront/agent/ag-ui/encoder.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import { AgentRunCancelledError, type AgentRunSessionManager } from "./session-manager.ts";
import { composeInternalAgentRunSystemPrompt } from "./run-system-prompt.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";
import { serverLogger } from "#veryfront/utils";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { type ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED } from "#veryfront/errors";
import type { ProviderReplayCheckpointPersister } from "./provider-replay-checkpoint-persister.ts";

const getAnyObjectSchema = defineSchema((v) => v.record(v.string(), v.unknown()));
const anyObjectSchema = lazySchema(getAnyObjectSchema) as Schema<Record<string, unknown>>;
const logger = serverLogger.component("internal-agent-run-stream");
const PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME = "bash";
const INTERNAL_AGENT_RUNTIME_HEARTBEAT_INTERVAL_MS = 25_000;
const INTERNAL_AGENT_RUNTIME_HEARTBEAT_FRAME = new TextEncoder().encode(
  ": internal-agent-runtime-heartbeat\n\n",
);
/**
 * SSE frame name carrying AGENT_RUN_MODEL_CALL_CONTEXT to veryfront-api. Not an
 * AG-UI event: veryfront-api persists it under its own event type rather than
 * folding it into the run's public event sequence.
 */
export const MODEL_CALL_CONTEXT_SSE_EVENT_NAME = "AgentRunModelCallContext";
export const PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME = "AgentRunProviderReplayTurnComplete";
export const PROVIDER_REPLAY_PROTOCOL_HEADER = "X-Veryfront-Provider-Replay-Protocol";

type RuntimeFilteredAgent = Agent & {
  config: Agent["config"] & {
    __vfForwardedIntegrationToolDefs?: ForwardedToolDef[];
  } & RuntimeRemoteToolConfig;
};

type SandboxShellToolsExtensionModule = {
  createBashSandboxShellToolsProvider: AgentServiceSandboxToolsOptions["createBashTool"];
};

function getAgentAllowedRemoteToolNames(agent: Agent): string[] {
  const raw = (agent.config as Agent["config"] & RuntimeRemoteToolConfig).__vfAllowedRemoteTools;
  return Array.isArray(raw) && raw.every((toolName) => typeof toolName === "string") ? raw : [];
}

/**
 * Explicit `false` entries in the agent's tool map are authoritative denials.
 * Remote grants and forwarded integration tool definitions are appended to
 * the runtime tool surface independently of the merged tool map, so denied
 * names must be subtracted from them too or a denied remote tool would stay
 * discoverable and callable.
 */
export function getExplicitlyDeniedToolNames(agent: Agent): ReadonlySet<string> {
  const configuredTools = agent.config.tools;
  if (!configuredTools || configuredTools === true) {
    return new Set<string>();
  }

  return new Set(
    Object.entries(configuredTools)
      .filter(([, entry]) => entry === false)
      .map(([toolName]) => toolName),
  );
}

function hasTrustedAgentToolDeclaration(agent: Agent, toolName: string): boolean {
  const configuredTools = agent.config.tools;
  if (configuredTools === true) {
    const registryTool = toolRegistry.get(toolName);
    return Boolean(
      registryTool && isToolVisibleTo(registryTool, { agentId: agent.id }) ||
        getAgentAllowedRemoteToolNames(agent).includes(toolName),
    );
  }
  if (!isRecord(configuredTools) || !Object.hasOwn(configuredTools, toolName)) {
    return false;
  }
  const entry = configuredTools[toolName];
  return entry === true || Boolean(entry && typeof entry === "object");
}

function mergeRemoteToolNames(source: string[], forwarded: string[]): string[] {
  const merged = new Set<string>();
  for (const toolName of source) {
    merged.add(toolName);
  }
  for (const toolName of forwarded) {
    merged.add(toolName);
  }
  return [...merged];
}

export interface RuntimeAgentStreamExecutionDeps {
  sessionManager: AgentRunSessionManager;
  /** Framework-private gateway credential; never copy into runtime or tool context. */
  inferenceAuthToken?: string;
  localTools?: Record<string, Tool | boolean>;
  projectAgentSandbox?: {
    apiUrl?: string;
    authToken?: string;
    branchId?: string | null;
    projectId?: string | null;
    sandboxEndpoint?: string;
  };
  createBashTool?: AgentServiceSandboxToolsOptions["createBashTool"];
  createAgentServiceSandboxTools?: (
    input: AgentServiceSandboxToolsOptions,
  ) => Promise<AgentServiceSandboxToolsResult>;
  createRuntime?: (
    agent: Agent,
    mergedTools: Agent["config"]["tools"],
  ) => {
    stream: (
      messages: Message[],
      context?: Record<string, unknown>,
      callbacks?: {
        onFinish?: (response: AgentResponse) => void;
      },
      modelOverride?: string,
      maxOutputTokensOverride?: number,
      abortSignal?: AbortSignal,
    ) => Promise<ReadableStream<Uint8Array>>;
  };
  providerReplayCheckpointEmissionEnabled?: boolean;
  providerReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
  persistProviderReplayCheckpoint?: ProviderReplayCheckpointPersister;
}

function createInjectedStudioTool(
  runId: string,
  toolName: string,
  description: string | undefined,
  parameters: Record<string, unknown> | undefined,
  sessionManager: AgentRunSessionManager,
): Tool {
  return {
    id: toolName,
    type: "function",
    description: description ?? toolName,
    inputSchema: anyObjectSchema,
    inputSchemaJson: (parameters ??
      { type: "object", properties: {}, additionalProperties: true }) as Tool["inputSchemaJson"],
    execute: async (_input, context) => {
      const toolCallId = typeof context?.toolCallId === "string" ? context.toolCallId : null;
      if (!toolCallId) {
        throw new Error(`Missing toolCallId for injected tool "${toolName}"`);
      }

      sessionManager.prepareForToolResult(runId, toolCallId);
      const waitResult = await sessionManager.waitForToolResult(runId, toolCallId);
      if (waitResult.isError) {
        throw new Error(
          typeof waitResult.result === "string"
            ? waitResult.result
            : JSON.stringify(waitResult.result),
        );
      }
      return waitResult.result;
    },
  };
}

function isExplicitlyDeniedToolName(
  agent: Agent,
  deniedToolNames: ReadonlySet<string>,
  toolName: string,
): boolean {
  if (deniedToolNames.has(toolName)) return true;
  const registryTool = toolRegistry.get(toolName);
  return Boolean(
    registryTool &&
      isToolVisibleTo(registryTool, { agentId: agent.id }) &&
      registryTool.shortName !== undefined &&
      deniedToolNames.has(registryTool.shortName),
  );
}

export function buildMergedTools(
  agent: Agent,
  input: RuntimeRunAgentInput,
  sessionManager: AgentRunSessionManager,
  availableForwardedToolNames?: string[],
  availableLocalTools?: Record<string, Tool | boolean>,
) {
  const serverResolvedProjectToolNames = getServerResolvedProjectToolNames(input.forwardedProps);
  const explicitlyDeniedToolNames = getExplicitlyDeniedToolNames(agent);
  const markdownDefinition = getRuntimeAgentMarkdownDefinition(agent);
  const failClosedUnrestrictedSelector = markdownDefinition?.tools === true &&
    Boolean(markdownDefinition.deniedTools?.length);
  // Concrete source definitions stay authoritative, and so do explicit `false`
  // denials: a request-injected tool must not resurrect a tool the agent
  // author switched off by name (mirroring the AG-UI merge path).
  const authoritativeSourceToolNames = agent.config.tools && agent.config.tools !== true
    ? new Set(
      Object.entries(agent.config.tools)
        .filter(([, entry]) => (entry && typeof entry === "object") || entry === false)
        .map(([toolName]) => toolName),
    )
    : new Set<string>();
  const configOwnsDelegation = hasTrustedAgentToolDeclaration(agent, INVOKE_AGENT_TOOL_ID);
  const injectedTools = Object.fromEntries(
    input.tools
      .filter((tool) =>
        !failClosedUnrestrictedSelector &&
        !authoritativeSourceToolNames.has(tool.name) &&
        !isExplicitlyDeniedToolName(agent, explicitlyDeniedToolNames, tool.name) &&
        !serverResolvedProjectToolNames.has(tool.name) &&
        !(tool.name === INVOKE_AGENT_TOOL_ID && configOwnsDelegation)
      )
      .map((tool) => [
        tool.name,
        createInjectedStudioTool(
          input.runId,
          tool.name,
          tool.description,
          tool.inputSchema ?? tool.parameters,
          sessionManager,
        ),
      ]),
  );

  if (!agent.config.tools) {
    return Object.keys(injectedTools).length ? injectedTools : undefined;
  }

  const sourceAllowedRemoteToolNames = getAgentAllowedRemoteToolNames(agent);

  if (agent.config.tools === true) {
    const merged: Record<string, Tool | boolean> = {};
    for (const [toolId, registryTool] of toolRegistry.getAll()) {
      // Owner-aware: another agent's owned tool never enters this agent's
      // model tool definitions.
      if (!isToolVisibleTo(registryTool, { agentId: agent.id })) {
        continue;
      }
      merged[toolId] = true;
    }
    for (const toolName of sourceAllowedRemoteToolNames) {
      merged[toolName] = true;
    }
    // Injected Studio tools win: an unmarked forwarded name keeps its
    // wait-for-tool-result wrapper so the frontend handler still runs. Server
    // authority is opted into by name via serverResolvedProjectTools, which
    // filters the name out of injectedTools above.
    return { ...merged, ...injectedTools };
  }

  const merged: Record<string, Tool | boolean> = {};
  for (const [toolName, entry] of Object.entries(agent.config.tools)) {
    if (entry === true) {
      // Registry lookups are owner-aware: another agent's owned tool behaves
      // as if it does not exist for this agent.
      const visibleRegistryTool = (() => {
        const registryTool = toolRegistry.get(toolName);
        return registryTool && isToolVisibleTo(registryTool, { agentId: agent.id })
          ? registryTool
          : undefined;
      })();
      const serverResolvedProjectTool = serverResolvedProjectToolNames.has(toolName)
        ? visibleRegistryTool
        : undefined;
      if (
        serverResolvedProjectTool ||
        visibleRegistryTool ||
        availableLocalTools?.[toolName] ||
        availableForwardedToolNames?.includes(toolName) ||
        sourceAllowedRemoteToolNames.includes(toolName)
      ) {
        merged[toolName] = availableLocalTools?.[toolName] ?? serverResolvedProjectTool ?? true;
      }
      continue;
    }

    if (entry && typeof entry === "object") {
      merged[toolName] = entry;
    }
  }

  const filtered = { ...merged, ...injectedTools };
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

async function loadDefaultCreateBashTool(): Promise<
  AgentServiceSandboxToolsOptions["createBashTool"]
> {
  const provider = tryResolve<SandboxShellToolsProvider>(SandboxShellToolsProviderName);
  if (provider) return provider;

  const { createBashSandboxShellToolsProvider } = await importFirstPartyExtensionModule<
    SandboxShellToolsExtensionModule
  >(
    "ext-sandbox-shell-tools",
    "@veryfront/ext-sandbox-shell-tools",
  );
  return createBashSandboxShellToolsProvider;
}

function getStringProperty(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

type InternalAgentRunTraceAttributes = Record<string, string | number | boolean | undefined>;

function compactTraceAttributes(
  attributes: InternalAgentRunTraceAttributes,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ),
  ) as Record<string, string | number | boolean>;
}

function buildInternalAgentRunTraceAttributes(input: {
  runInput: RuntimeRunAgentInput;
  agent: Agent;
  deps: RuntimeAgentStreamExecutionDeps;
  status?: "running" | "completed" | "failed" | "cancelled";
}): Record<string, string | number | boolean> {
  const forwardedProps = input.runInput.forwardedProps;
  const scheduleId = forwardedProps
    ? getStringProperty(forwardedProps, ["schedule_id", "scheduleId"])
    : undefined;
  const scheduleName = forwardedProps
    ? getStringProperty(forwardedProps, ["schedule_name", "scheduleName"])
    : undefined;

  return compactTraceAttributes({
    "agent.id": input.agent.id,
    "run.id": input.runInput.runId,
    "thread.id": input.runInput.threadId,
    "parent.run.id": input.runInput.parentRunId,
    "project.id": input.deps.projectAgentSandbox?.projectId ?? undefined,
    "schedule.id": scheduleId,
    "schedule.name": scheduleName,
    "run.trigger.kind": scheduleId ? "schedule" : undefined,
    "run.trigger.id": scheduleId,
    "agent.run.status": input.status,
    "gen_ai.operation.name": "chat",
    "gen_ai.agent.id": input.agent.id,
  });
}

function getAgentSandboxConfig(
  agent: Agent,
): { sandboxId?: string; sandboxEndpoint?: string; projectId?: string } {
  const config = agent.config as Agent["config"] & { sandbox?: unknown };
  if (!isRecord(config.sandbox)) {
    return {};
  }

  return {
    sandboxId: getStringProperty(config.sandbox, ["id", "sandboxId", "sessionId"]),
    sandboxEndpoint: getStringProperty(config.sandbox, ["endpoint", "sandboxEndpoint"]),
    projectId: getStringProperty(config.sandbox, ["projectId"]),
  };
}

function createIdempotentAsyncCleanup(
  cleanup?: () => Promise<void>,
): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined;
  return () => {
    cleanupPromise ??= cleanup ? Promise.resolve().then(cleanup) : Promise.resolve();
    return cleanupPromise;
  };
}

function shouldExposeSandboxBash(agent: Agent): boolean {
  const tools = agent.config.tools;
  return isRecord(tools) && tools[PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME] === true;
}

async function buildProjectAgentSandboxTools(input: {
  agent: Agent;
  deps: RuntimeAgentStreamExecutionDeps;
}): Promise<{ tools?: Record<string, Tool | boolean>; closeSandbox?: () => Promise<void> }> {
  if (!shouldExposeSandboxBash(input.agent)) {
    return {};
  }

  const sandboxConfig = getAgentSandboxConfig(input.agent);
  const createBashTool = input.deps.createBashTool ?? await loadDefaultCreateBashTool();
  const createSandboxTools = input.deps.createAgentServiceSandboxTools ??
    createAgentServiceSandboxTools;
  const sandboxResult = await createSandboxTools({
    createBashTool,
    ...(input.deps.projectAgentSandbox?.apiUrl
      ? { apiUrl: input.deps.projectAgentSandbox.apiUrl }
      : {}),
    ...(input.deps.projectAgentSandbox?.authToken
      ? { authToken: input.deps.projectAgentSandbox.authToken }
      : {}),
    ...(sandboxConfig.sandboxId
      ? { sandboxId: sandboxConfig.sandboxId, deleteOnClose: false }
      : {}),
    ...(sandboxConfig.sandboxEndpoint ?? input.deps.projectAgentSandbox?.sandboxEndpoint
      ? {
        sandboxEndpoint: sandboxConfig.sandboxEndpoint ??
          input.deps.projectAgentSandbox?.sandboxEndpoint,
      }
      : {}),
    getProjectId: () => sandboxConfig.projectId ?? input.deps.projectAgentSandbox?.projectId,
  });
  const closeSandbox = createIdempotentAsyncCleanup(() => sandboxResult.closeSandbox());

  try {
    const declaredTools = input.agent.config.tools;
    const materializedTools = createToolsFromHostDefinitions(sandboxResult.tools);
    const configuredTools = isRecord(declaredTools)
      ? Object.fromEntries(
        Object.entries(materializedTools).filter(([toolName]) => declaredTools[toolName] === true),
      )
      : {};
    if (!configuredTools[PROJECT_AGENT_SANDBOX_BASH_TOOL_NAME]) {
      await closeSandbox();
      return {};
    }

    return {
      tools: configuredTools,
      closeSandbox,
    };
  } catch (error) {
    await closeSandbox().catch((cleanupError) => {
      logger.warn("Internal agent runtime sandbox cleanup failed during materialization", {
        agentId: input.agent.id,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAllowedRemoteToolNames(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): string[] | undefined {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides || !Object.hasOwn(runtimeOverrides, "allowedTools")) {
    return undefined;
  }
  const allowedTools = runtimeOverrides.allowedTools;
  if (!Array.isArray(allowedTools)) {
    return [];
  }
  return allowedTools.every((toolName) => typeof toolName === "string") ? allowedTools : [];
}

function getForwardedMaxOutputTokens(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): number | undefined {
  const value = forwardedProps?.maxOutputTokens;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Reads the restrictive `runtimeOverrides.toolAllowlist` override.
 *
 * Unlike `runtimeOverrides.allowedTools` — which this path treats as an
 * additive grant list (Studio forwards integration/studio tool names it wants
 * attached on top of the agent's own surface) — `toolAllowlist` is a hard
 * restriction: the model-visible tool set of the run is intersected with it.
 * Scheduled automations declare it via schedule `input.runtimeOverrides` for
 * defense in depth. Returns null when absent (no restriction); a present but
 * malformed value fails closed to an empty allowlist.
 */
function getRuntimeToolAllowlist(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): ReadonlySet<string> | null {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides || !Object.hasOwn(runtimeOverrides, "toolAllowlist")) {
    return null;
  }
  const toolAllowlist = runtimeOverrides.toolAllowlist;
  if (!Array.isArray(toolAllowlist)) {
    return new Set();
  }
  return new Set(
    toolAllowlist.filter((toolName): toolName is string =>
      typeof toolName === "string" && toolName.length > 0
    ),
  );
}

/**
 * Intersects the merged run tool set with the restrictive tool allowlist.
 * Skill runtime tools are preserved for every agent. Delegation tools are
 * preserved only when the agent has at least one visible skill and its trusted
 * configuration declares delegation, mirroring the hosted chat runtime.
 *
 * The allowlist bounds this run's direct tool surface only: preserved skill
 * delegation tools (`invoke_agent`) can spawn child runs whose tool assembly
 * derives from the child agent's own config and is not capped by this run's
 * allowlist. Strict schedules must exclude delegation via agent config.
 */
function applyRuntimeToolAllowlist(
  mergedTools: Agent["config"]["tools"],
  toolAllowlist: ReadonlySet<string> | null,
  agent: Agent,
): Agent["config"]["tools"] {
  if (!toolAllowlist || !mergedTools) {
    return mergedTools;
  }
  if (mergedTools === true) {
    // buildMergedTools always expands `tools: true` into a concrete record,
    // so this is unreachable; if that invariant ever breaks, fail closed
    // rather than silently skipping enforcement.
    return {};
  }
  const hasVisibleSkills = skillRegistry.hasVisibleSkills({ agentId: agent.id });
  const allowedToolNames = resolveHostedRuntimeAllowedToolNames({
    allowedToolNames: toolAllowlist,
    localToolNames: Object.keys(mergedTools),
    ...(hasVisibleSkills ? { availableSkillIds: ["*"] } : {}),
  });
  if (!allowedToolNames) {
    return mergedTools;
  }
  // The shared resolver never appends delegation to a request-derived
  // allowlist. Preserve invoke_agent only when the trusted agent configuration
  // declared it; caller-injected entries in mergedTools cannot establish that
  // provenance. An empty allowlist stays deny-all, and explicit delegation
  // denial still strips the tool below.
  const preservesConfigDelegation = hasVisibleSkills &&
    allowedToolNames.size > 0 &&
    hasTrustedAgentToolDeclaration(agent, INVOKE_AGENT_TOOL_ID);
  return Object.fromEntries(
    Object.entries(mergedTools).filter(([toolName]) =>
      allowedToolNames.has(toolName) ||
      (preservesConfigDelegation && toolName === INVOKE_AGENT_TOOL_ID)
    ),
  );
}

function applyDelegationAuthority(
  mergedTools: Agent["config"]["tools"],
  allowDelegation: RuntimeRunAgentInput["allowDelegation"],
): Agent["config"]["tools"] {
  if (allowDelegation !== false || !mergedTools || mergedTools === true) {
    return mergedTools;
  }

  const filtered = Object.fromEntries(
    Object.entries(mergedTools).filter(([toolName]) => toolName !== INVOKE_AGENT_TOOL_ID),
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function getRequiredLocalToolNames(input: {
  mergedTools: Agent["config"]["tools"];
  availableLocalTools: Record<string, Tool | boolean>;
  agent: Agent;
}): string[] {
  if (!input.mergedTools || input.mergedTools === true) {
    return [];
  }

  return Object.entries(input.mergedTools)
    .filter(([toolName, entry]) => {
      if (entry && typeof entry === "object") {
        return true;
      }
      if (Object.hasOwn(input.availableLocalTools, toolName)) {
        return true;
      }
      const registryTool = toolRegistry.get(toolName);
      return Boolean(registryTool && isToolVisibleTo(registryTool, { agentId: input.agent.id }));
    })
    .map(([toolName]) => toolName);
}

function getServerResolvedProjectToolNames(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): Set<string> {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides) return new Set();
  const toolNames = runtimeOverrides.serverResolvedProjectTools;
  if (!Array.isArray(toolNames)) return new Set();
  return new Set(
    toolNames.filter((toolName): toolName is string =>
      typeof toolName === "string" && toolName.length > 0
    ),
  );
}

interface ForwardedToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

function getForwardedIntegrationToolDefinitions(
  forwardedProps: RuntimeRunAgentInput["forwardedProps"],
): ForwardedToolDef[] | undefined {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides) return undefined;
  const defs = runtimeOverrides.integrationToolDefinitions;
  if (!Array.isArray(defs) || defs.length === 0) return undefined;
  return defs.filter(
    (def): def is ForwardedToolDef =>
      typeof def === "object" &&
      def !== null &&
      typeof def.name === "string" &&
      typeof def.description === "string",
  ).map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.inputSchema ?? def.parameters ?? { type: "object", properties: {} },
  }));
}

function getRemoteToolDiscoveryContext(input: {
  agent: Agent;
  runInput: RuntimeRunAgentInput;
  deps: RuntimeAgentStreamExecutionDeps;
}): ToolExecutionContext {
  return {
    agentId: input.agent.id,
    runId: input.runInput.runId,
    ...(input.deps.projectAgentSandbox?.authToken
      ? { authToken: input.deps.projectAgentSandbox.authToken }
      : {}),
    ...(input.deps.projectAgentSandbox?.projectId
      ? { projectId: input.deps.projectAgentSandbox.projectId }
      : {}),
    ...(input.runInput.parentRunId ? { parentRunId: input.runInput.parentRunId } : {}),
    ...(input.runInput.state !== undefined ? { state: input.runInput.state } : {}),
    context: input.runInput.context,
    forwardedProps: input.runInput.forwardedProps,
  };
}

async function getDeclaredRemoteSourceToolNames(input: {
  agent: Agent;
  runInput: RuntimeRunAgentInput;
  deps: RuntimeAgentStreamExecutionDeps;
}): Promise<string[]> {
  const sources = getRuntimeRemoteToolSources(input.agent.config);
  if (!sources?.length) {
    return [];
  }

  const context = getRemoteToolDiscoveryContext(input);
  const toolNames = new Set<string>();
  for (const source of sources) {
    try {
      for (const definition of await source.listTools(context)) {
        if (typeof definition.name === "string" && definition.name.length > 0) {
          toolNames.add(definition.name);
        }
      }
    } catch (error) {
      logger.warn("Failed to inspect remote tool source for restrictive allowlist fallback", {
        runId: input.runInput.runId,
        agentId: input.agent.id,
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return [...toolNames];
}

function compactRuntimeMessagesForStream(
  messages: Message[],
  systemPrompt: AgentSystem,
  toolCount: number,
): Message[] {
  const systemText = typeof systemPrompt === "string"
    ? systemPrompt
    : flattenSystemInstructions(systemPrompt);
  return convertProviderMessagesToAgentRuntimeMessages(
    compactForStep(
      convertAgentRuntimeMessagesToProviderMessages(messages),
      estimateOverhead(systemText, toolCount),
    ),
  ) as Message[];
}

/**
 * Relays run events produced by the runtime into the run's SSE stream.
 *
 * The first model call is dispatched while `runtime.stream()` is still being
 * awaited, before there is a controller to enqueue into, so events raised
 * before `attach` are buffered and replayed once the stream opens.
 */
function createModelCallContextRelay(
  timing: Parameters<typeof createTimedAgentRunEventSink>[1],
): {
  sink: AgentRunEventSink;
  attach: (emit: (event: AgentRunEvent) => void) => void;
} {
  const buffered: AgentRunEvent[] = [];
  let emit: ((event: AgentRunEvent) => void) | undefined;
  return {
    sink: createTimedAgentRunEventSink((event) => {
      if (emit) emit(event);
      else buffered.push(event);
    }, timing),
    attach: (next) => {
      emit = next;
      for (const event of buffered.splice(0)) next(event);
    },
  };
}

type ProviderReplayPrivateFrame = {
  event: string;
  payload: Record<string, unknown>;
};

function createProviderReplayCheckpointRelay(): {
  complete: (messageId: string) => Promise<void>;
  fail: () => Promise<void>;
  takeCompletedTurn: () => Promise<ProviderReplayPrivateFrame[]>;
  hasCompletedTurn: () => boolean;
} {
  const buffered: ProviderReplayPrivateFrame[] = [];
  let resolvePending:
    | ((frames: ProviderReplayPrivateFrame[]) => void)
    | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  let terminalError: Error | undefined;

  const takeReadyTurn = (): ProviderReplayPrivateFrame[] | undefined => {
    const boundaryIndex = buffered.findIndex((frame) =>
      frame.event === PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME
    );
    return boundaryIndex >= 0 ? buffered.splice(0, boundaryIndex + 1) : undefined;
  };
  const resolveIfReady = () => {
    if (!resolvePending) return;
    const frames = takeReadyTurn();
    if (!frames) return;
    const resolve = resolvePending;
    resolvePending = undefined;
    rejectPending = undefined;
    resolve(frames);
  };

  return {
    complete: async (messageId) => {
      buffered.push({
        event: PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME,
        payload: {
          type: "AGENT_RUN_PROVIDER_REPLAY_TURN_COMPLETE",
          messageId,
        },
      });
      resolveIfReady();
    },
    fail: async () => {
      if (terminalError) return;
      terminalError = new Error("Provider replay turn failed before its boundary");
      buffered.splice(0);
      const reject = rejectPending;
      resolvePending = undefined;
      rejectPending = undefined;
      reject?.(terminalError);
    },
    takeCompletedTurn: () => {
      if (terminalError) return Promise.reject(terminalError);
      const frames = takeReadyTurn();
      if (frames) return Promise.resolve(frames);
      if (resolvePending) {
        return Promise.reject(new Error("Provider replay turn boundary already has a waiter"));
      }
      return new Promise((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
    },
    hasCompletedTurn: () =>
      buffered.some((frame) => frame.event === PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME),
  };
}

export async function createRuntimeAgentStreamResponse(
  input: RuntimeRunAgentInput,
  agent: Agent,
  deps: RuntimeAgentStreamExecutionDeps,
): Promise<Response> {
  logger.info("Starting internal agent runtime stream", {
    runId: input.runId,
    threadId: input.threadId,
    agentId: agent.id,
    messageCount: input.messages.length,
    toolCount: input.tools.length,
    contextCount: input.context.length,
  });
  const abortSignal = deps.sessionManager.startRun({
    runId: input.runId,
    threadId: input.threadId,
  });

  let completedResponse: AgentResponse | null = null;
  let runtimeStream: ReadableStream<Uint8Array>;
  let closeSandbox = createIdempotentAsyncCleanup();
  const timing = createAgentRunEventTimingAnchor();
  const modelCallContextRelay = createModelCallContextRelay(timing);
  const providerReplayCheckpointRelay = createProviderReplayCheckpointRelay();
  let shouldEmitProviderReplayCheckpoints = false;
  try {
    const forwardedAllowedRemoteToolNames = getAllowedRemoteToolNames(input.forwardedProps);
    const sourceAllowedRemoteToolNames = getAgentAllowedRemoteToolNames(agent);
    const sourceRemoteFilterBase = Object.hasOwn(agent.config, "__vfAllowedRemoteTools")
      ? sourceAllowedRemoteToolNames
      : undefined;
    const grantedRemoteToolNames = forwardedAllowedRemoteToolNames === undefined
      ? sourceRemoteFilterBase
      : mergeRemoteToolNames(
        sourceAllowedRemoteToolNames,
        forwardedAllowedRemoteToolNames,
      );
    const runtimeToolAllowlist = getRuntimeToolAllowlist(input.forwardedProps);
    if (runtimeToolAllowlist === null && forwardedAllowedRemoteToolNames !== undefined) {
      logger.debug(
        "runtimeOverrides.allowedTools is additive on internal runs; use runtimeOverrides.toolAllowlist to restrict the run tool surface",
        { runId: input.runId, agentId: agent.id },
      );
    }
    const explicitlyDeniedToolNames = getExplicitlyDeniedToolNames(agent);
    const forwardedIntegrationToolDefsWithDenied = getForwardedIntegrationToolDefinitions(
      input.forwardedProps,
    );
    const forwardedIntegrationToolDefs = explicitlyDeniedToolNames.size === 0
      ? forwardedIntegrationToolDefsWithDenied
      : forwardedIntegrationToolDefsWithDenied?.filter(
        (tool) => !isExplicitlyDeniedToolName(agent, explicitlyDeniedToolNames, tool.name),
      );
    const availableForwardedToolNames = forwardedIntegrationToolDefs?.map((tool) => tool.name);
    // A restrictive toolAllowlist caps remote exposure too: it intersects the
    // tightest existing remote filter (forwarded grants, else the agent source's
    // own __vfAllowedRemoteTools). With neither present, discover the agent's
    // declared remote-source surface and intersect with that. A bare allowlist
    // entry can narrow actual remote sources, but never becomes an implicit
    // project-scoped integration grant (#2768).
    const remoteFallbackBase = runtimeToolAllowlist !== null &&
        grantedRemoteToolNames === undefined &&
        sourceRemoteFilterBase === undefined
      ? await getDeclaredRemoteSourceToolNames({ agent, runInput: input, deps })
      : undefined;
    const runtimeAllowedRemoteToolNames = runtimeToolAllowlist === null
      ? grantedRemoteToolNames
      : (grantedRemoteToolNames ?? sourceRemoteFilterBase ?? remoteFallbackBase ?? []).filter(
        (toolName) => runtimeToolAllowlist.has(toolName),
      );
    const denialFilteredRemoteToolNames = explicitlyDeniedToolNames.size === 0
      ? runtimeAllowedRemoteToolNames
      : runtimeAllowedRemoteToolNames?.filter(
        (toolName) => !isExplicitlyDeniedToolName(agent, explicitlyDeniedToolNames, toolName),
      );
    const allowedRemoteToolNames = input.allowDelegation === false
      ? denialFilteredRemoteToolNames?.filter((toolName) => toolName !== INVOKE_AGENT_TOOL_ID)
      : denialFilteredRemoteToolNames;
    const sandboxTools = await buildProjectAgentSandboxTools({ agent, deps });
    closeSandbox = sandboxTools.closeSandbox ?? closeSandbox;
    const availableLocalTools = {
      ...(deps.localTools ?? {}),
      ...(sandboxTools.tools ?? {}),
    };
    const mergedTools = applyDelegationAuthority(
      applyRuntimeToolAllowlist(
        buildMergedTools(
          agent,
          input,
          deps.sessionManager,
          availableForwardedToolNames,
          Object.keys(availableLocalTools).length > 0 ? availableLocalTools : undefined,
        ),
        runtimeToolAllowlist,
        agent,
      ),
      input.allowDelegation,
    );
    // Provider-native tools (e.g. web_search) are provider-side and bypass the
    // merged tool record, so cap them against the allowlist explicitly.
    const cappedProviderTools =
      runtimeToolAllowlist !== null && Array.isArray(agent.config.providerTools)
        ? agent.config.providerTools.filter(
          (toolName) => typeof toolName === "string" && runtimeToolAllowlist.has(toolName),
        )
        : undefined;
    const effectiveProviderToolNames = cappedProviderTools ??
      (Array.isArray(agent.config.providerTools)
        ? agent.config.providerTools.filter((toolName): toolName is string =>
          typeof toolName === "string"
        )
        : []);
    const modelSupportedProviderToolNames = new Set(
      getProviderNativeToolNames({ model: agent.config.model }),
    );
    const providerToolNames = effectiveProviderToolNames.filter((toolName) =>
      modelSupportedProviderToolNames.has(toolName) &&
      !isExplicitlyDeniedToolName(agent, explicitlyDeniedToolNames, toolName)
    );
    const mergedToolNames = mergedTools && mergedTools !== true ? Object.keys(mergedTools) : [];
    const allowedRemoteToolNameSet = new Set(allowedRemoteToolNames ?? []);
    const forwardedToolNames = (forwardedIntegrationToolDefs?.map((def) => def.name) ?? [])
      .filter((toolName) => allowedRemoteToolNameSet.has(toolName));
    const localToolNames = getRequiredLocalToolNames({
      mergedTools,
      availableLocalTools,
      agent,
    });
    const runtimeToolNames = selectProviderCompatibleToolNames(
      [
        ...new Set([
          ...mergedToolNames,
          ...providerToolNames,
          ...(allowedRemoteToolNames ?? []),
          ...forwardedToolNames,
        ]),
      ].sort(compareStrings),
      {
        model: agent.config.model,
        requiredToolNames: localToolNames,
      },
    );
    const runtimeContext = {
      threadId: input.threadId,
      runId: input.runId,
      ...(deps.projectAgentSandbox?.authToken
        ? { authToken: deps.projectAgentSandbox.authToken }
        : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      context: input.context,
      forwardedProps: input.forwardedProps,
    };
    const authoredSystemPromise = Promise.resolve(
      resolveAgentSystem(agent.config.system, undefined),
    );
    const effectiveAgentSystem = getEffectiveAgentSystem(agent);
    const resolveSystemPrompt = async (providerOptionKey?: string) => {
      const authoredSystem = await authoredSystemPromise;
      const resolvedBaseSystem = await resolveAgentSystemFromResolvedBase(
        effectiveAgentSystem,
        authoredSystem,
        providerOptionKey,
        { preserveRuntimeContextMarker: true },
      );
      return composeInternalAgentRunSystemPrompt({
        agent,
        resolvedBaseSystem,
        runInput: input,
        projectId: deps.projectAgentSandbox?.projectId ?? null,
        branchId: deps.projectAgentSandbox?.branchId,
        toolNames: runtimeToolNames,
        ...(providerOptionKey ? { providerOptionKey } : {}),
      });
    };
    const systemPrompt = await resolveSystemPrompt();
    const providerReplayCheckpoints = deps.providerReplayCheckpoints ?? [];
    if (deps.providerReplayCheckpointEmissionEnabled === true && !input.messageId) {
      throw new Error(
        "Provider replay checkpoint emission requires a runtime message identity",
      );
    }
    shouldEmitProviderReplayCheckpoints = Boolean(
      input.messageId &&
        (deps.providerReplayCheckpointEmissionEnabled === true ||
          providerReplayCheckpoints.some((checkpoint) => checkpoint.messageId === input.messageId)),
    );
    if (shouldEmitProviderReplayCheckpoints && !deps.persistProviderReplayCheckpoint) {
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail:
          "A trusted run-event append token is required to persist a private provider replay checkpoint",
      });
    }
    const runtimeAgent: RuntimeFilteredAgent = {
      ...agent,
      config: {
        ...agent.config,
        system: createProviderAwareAgentSystemResolver(resolveSystemPrompt),
        tools: mergedTools,
        ...(Array.isArray(agent.config.providerTools) ? { providerTools: providerToolNames } : {}),
        ...(allowedRemoteToolNames !== undefined
          ? { __vfAllowedRemoteTools: allowedRemoteToolNames }
          : {}),
        ...(forwardedIntegrationToolDefs !== undefined
          ? { __vfForwardedIntegrationToolDefs: forwardedIntegrationToolDefs }
          : {}),
        ...(providerReplayCheckpoints.length > 0
          ? { __vfProviderReplayCheckpoints: providerReplayCheckpoints }
          : {}),
        ...(shouldEmitProviderReplayCheckpoints
          ? {
            __vfProviderReplayCheckpointMessageId: input.messageId,
            __vfPersistProviderReplayCheckpoint: (checkpoint: ProviderReplayCheckpoint) =>
              deps.persistProviderReplayCheckpoint!(checkpoint, abortSignal),
            __vfProviderReplayCheckpointPersistenceRequired: true,
          }
          : {}),
        ...(shouldEmitProviderReplayCheckpoints
          ? {
            __vfProviderReplayCheckpointTurnComplete: () =>
              providerReplayCheckpointRelay.complete(input.messageId!),
            __vfProviderReplayCheckpointTurnFailed: providerReplayCheckpointRelay.fail,
          }
          : {}),
      },
    };
    const runtime = deps.createRuntime?.(runtimeAgent, mergedTools) ??
      new AgentRuntime(runtimeAgent.id, runtimeAgent.config, deps.inferenceAuthToken);
    const runtimeMessages = compactRuntimeMessagesForStream(
      normalizeAgUiRuntimeMessages(input.messages),
      systemPrompt,
      runtimeToolNames.length,
    );
    const maxOutputTokens = getForwardedMaxOutputTokens(input.forwardedProps);
    const candidateRuntimeStream = await runWithMandatoryRunEventSink(
      modelCallContextRelay.sink,
      () =>
        runtime.stream(
          runtimeMessages,
          runtimeContext,
          {
            onFinish: (response) => {
              completedResponse = response;
            },
          },
          undefined,
          maxOutputTokens,
          abortSignal,
        ),
    );
    if (candidateRuntimeStream.locked) {
      throw new TypeError("Internal agent runtime returned a locked stream");
    }
    runtimeStream = candidateRuntimeStream;
    logger.info("Internal agent runtime stream attached", {
      runId: input.runId,
      threadId: input.threadId,
      agentId: agent.id,
    });
  } catch (error) {
    deps.sessionManager.failRun(input.runId);
    await closeSandbox().catch((cleanupError) => {
      logger.warn("Internal agent runtime sandbox cleanup failed after setup error", {
        runId: input.runId,
        agentId: agent.id,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    logger.error("Internal agent runtime stream setup failed", {
      runId: input.runId,
      threadId: input.threadId,
      agentId: agent.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  let clientAttached = true;
  let stopHeartbeat: (() => void) | undefined;
  const response = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      await withSpan(
        "agent.run",
        async (runSpan) => {
          setSpanAttributes(
            runSpan,
            buildInternalAgentRunTraceAttributes({
              runInput: input,
              agent,
              deps,
              status: "running",
            }),
          );
          addSpanEvent(runSpan, "agent.run.started");
          const state = createStreamTransformState(timing);
          const reader = runtimeStream.getReader();
          const decoder = new TextDecoder();
          let remainder = "";
          let aborted = false;
          let readerReachedEof = false;
          let readerExitReason: unknown = new Error(
            "Internal agent runtime stream stopped before EOF",
          );
          let readerCancellation: Promise<void> | undefined;
          let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
          stopHeartbeat = () => {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = undefined;
            }
          };

          const enqueueIfAttached = (event: string, payload: Record<string, unknown>) => {
            const [timed] = stampAgUiEventTiming(state, [{ event, payload }]);
            const encodedEvent = formatAgUiEvent(event, timed?.payload ?? payload);
            if (!clientAttached) {
              return;
            }

            try {
              controller.enqueue(encodedEvent);
            } catch {
              clientAttached = false;
            }
          };
          const enqueueHeartbeatIfAttached = () => {
            if (!clientAttached) {
              return;
            }

            try {
              controller.enqueue(INTERNAL_AGENT_RUNTIME_HEARTBEAT_FRAME);
            } catch {
              clientAttached = false;
            }
          };
          const prepareToolResultIfNeeded = (event: string, payload: Record<string, unknown>) => {
            if (
              event !== "ToolCallStart" && event !== "ToolCallArgs" &&
              event !== "ToolCallEnd"
            ) {
              return;
            }

            const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : null;
            if (!toolCallId) {
              return;
            }

            deps.sessionManager.prepareForToolResult(input.runId, toolCallId);
          };

          const throwIfAborted = () => {
            if (aborted || abortSignal.aborted) {
              throw new AgentRunCancelledError();
            }
          };

          const cancelReaderOnce = (reason: unknown): Promise<void> => {
            if (readerReachedEof) {
              return Promise.resolve();
            }
            readerCancellation ??= reader.cancel(reason).catch((error) => {
              logger.debug(
                "Internal agent runtime reader cancellation failed during cleanup",
                {
                  runId: input.runId,
                  threadId: input.threadId,
                  agentId: agent.id,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            });
            return readerCancellation;
          };

          const abortHandler = () => {
            if (aborted) {
              return;
            }
            aborted = true;
            const cancellationError = new AgentRunCancelledError();
            readerExitReason = cancellationError;
            logger.debug("Internal agent runtime stream aborted", {
              runId: input.runId,
              threadId: input.threadId,
              agentId: agent.id,
            });
            void providerReplayCheckpointRelay.fail();
            void cancelReaderOnce(cancellationError);
          };

          try {
            abortSignal.addEventListener("abort", abortHandler, { once: true });
            if (abortSignal.aborted) {
              abortHandler();
            }
            enqueueIfAttached("RunStarted", {
              runId: input.runId,
              threadId: input.threadId,
              agentId: agent.id,
            });
            // Replays whatever the first model call already produced, then
            // forwards later steps as they happen. RunStarted stays first.
            modelCallContextRelay.attach((event) =>
              enqueueIfAttached(MODEL_CALL_CONTEXT_SSE_EVENT_NAME, event)
            );
            const enqueueProviderReplayFrame = (frame: ProviderReplayPrivateFrame) => {
              if (!clientAttached) {
                throw new Error(
                  "Provider replay checkpoint stream detached before persistence",
                );
              }
              try {
                controller.enqueue(
                  formatAgUiEvent(frame.event, frame.payload),
                );
              } catch {
                clientAttached = false;
                throw new Error(
                  "Provider replay checkpoint stream detached before persistence",
                );
              }
            };
            let providerReplayStepOpen = false;
            const flushProviderReplayTurn = async () => {
              if (!providerReplayStepOpen) return;
              for (const frame of await providerReplayCheckpointRelay.takeCompletedTurn()) {
                enqueueProviderReplayFrame(frame);
              }
              providerReplayStepOpen = false;
            };
            const emitMappedEvent = async (mappedEvent: {
              event: string;
              payload: Record<string, unknown>;
            }) => {
              if (mappedEvent.event === "StepStarted") {
                await flushProviderReplayTurn();
                providerReplayStepOpen = shouldEmitProviderReplayCheckpoints;
              }
              if (mappedEvent.event === "ToolCallEnd") {
                await flushProviderReplayTurn();
              }
              if (mappedEvent.event === "RunError" && providerReplayStepOpen) {
                await providerReplayCheckpointRelay.fail();
                providerReplayStepOpen = false;
              }
              prepareToolResultIfNeeded(mappedEvent.event, mappedEvent.payload);
              enqueueIfAttached(mappedEvent.event, mappedEvent.payload);
            };
            heartbeatTimer = setInterval(
              enqueueHeartbeatIfAttached,
              INTERNAL_AGENT_RUNTIME_HEARTBEAT_INTERVAL_MS,
            );

            while (true) {
              throwIfAborted();

              const { done, value } = await runWithMandatoryRunEventSink(
                modelCallContextRelay.sink,
                () => reader.read(),
              );
              throwIfAborted();

              if (done) {
                readerReachedEof = true;
                logger.info("Internal agent runtime stream reader completed", {
                  runId: input.runId,
                  threadId: input.threadId,
                  agentId: agent.id,
                });
                break;
              }

              remainder += decoder.decode(value, { stream: true });
              const parsed = parseSseJsonEvents(remainder);
              remainder = parsed.remainder;

              for (const event of parsed.events) {
                for (const mappedEvent of mapRuntimeEventToAgUi(state, event)) {
                  await emitMappedEvent(mappedEvent);
                }
              }
            }

            throwIfAborted();

            const trailingEvents = parseSseJsonEvents(`${remainder}\n\n`);
            for (const event of trailingEvents.events) {
              for (const mappedEvent of mapRuntimeEventToAgUi(state, event)) {
                await emitMappedEvent(mappedEvent);
              }
            }

            throwIfAborted();
            await flushProviderReplayTurn();
            while (providerReplayCheckpointRelay.hasCompletedTurn()) {
              for (const frame of await providerReplayCheckpointRelay.takeCompletedTurn()) {
                enqueueProviderReplayFrame(frame);
              }
            }

            for (const mappedEvent of finalizeRunEvents(state, completedResponse)) {
              enqueueIfAttached(mappedEvent.event, mappedEvent.payload);
            }
            const finalStatus = state.sawTerminalError ? "failed" : "completed";
            if (state.sawTerminalError) {
              deps.sessionManager.failRun(input.runId);
            } else {
              deps.sessionManager.completeRun(input.runId);
            }
            setSpanAttributes(runSpan, {
              ...buildInternalAgentRunTraceAttributes({
                runInput: input,
                agent,
                deps,
                status: finalStatus,
              }),
              "agent.run.final_status": finalStatus,
              "agent.run.saw_visible_output": state.sawVisibleOutput,
              "agent.run.saw_terminal_error": state.sawTerminalError,
              ...(state.sawTerminalError ? { "error.type": "AgentRunTerminalError" } : {}),
              ...buildRuntimeUsageTraceAttributes(completedResponse?.usage),
              ...(state.metadata.finishReason
                ? { "gen_ai.response.finish_reasons": state.metadata.finishReason }
                : {}),
            });
            addSpanEvent(
              runSpan,
              state.sawTerminalError ? "agent.run.failed" : "agent.run.completed",
            );
            logger.info("Internal agent runtime stream finalized", {
              runId: input.runId,
              threadId: input.threadId,
              agentId: agent.id,
              status: finalStatus,
              sawVisibleOutput: state.sawVisibleOutput,
              sawTerminalError: state.sawTerminalError,
              finishReason: state.metadata.finishReason,
            });
          } catch (error) {
            readerExitReason = error;
            if (error instanceof AgentRunCancelledError) {
              deps.sessionManager.cancelRun(input.runId);
              setSpanAttributes(runSpan, {
                ...buildInternalAgentRunTraceAttributes({
                  runInput: input,
                  agent,
                  deps,
                  status: "cancelled",
                }),
                "agent.run.final_status": "cancelled",
                "error.type": "AgentRunCancelledError",
                "error.message": error.message,
              });
              addSpanEvent(runSpan, "agent.run.cancelled");
              // The control plane also cancels runtime sessions to park canonical runs for tools.
              // This is a lifecycle transition, not an execution failure.
              logger.info("Internal agent runtime session cancelled", {
                runId: input.runId,
                threadId: input.threadId,
                agentId: agent.id,
                status: "cancelled",
              });
              enqueueIfAttached("RunError", {
                code: "CANCELLED",
                message: error.message,
              });
            } else {
              deps.sessionManager.failRun(input.runId);
              const errorMessage = error instanceof Error ? error.message : String(error);
              setSpanAttributes(runSpan, {
                ...buildInternalAgentRunTraceAttributes({
                  runInput: input,
                  agent,
                  deps,
                  status: "failed",
                }),
                "agent.run.final_status": "failed",
                "error.type": error instanceof Error ? error.name : "Error",
                "error.message": errorMessage,
              });
              addSpanEvent(runSpan, "agent.run.failed");
              logger.error("Internal agent runtime stream failed", {
                runId: input.runId,
                threadId: input.threadId,
                agentId: agent.id,
                error: errorMessage,
              });
              enqueueIfAttached("RunError", {
                code: "RUNTIME_ERROR",
                message: errorMessage,
              });
            }
          } finally {
            stopHeartbeat?.();
            stopHeartbeat = undefined;
            abortSignal.removeEventListener("abort", abortHandler);
            if (!readerReachedEof) {
              await cancelReaderOnce(readerExitReason);
            }
            try {
              reader.releaseLock();
            } catch (releaseError) {
              logger.debug("Internal agent runtime reader lock release failed", {
                runId: input.runId,
                threadId: input.threadId,
                agentId: agent.id,
                error: releaseError instanceof Error ? releaseError.message : String(releaseError),
              });
            }
            await closeSandbox().catch((cleanupError) => {
              logger.warn("Internal agent runtime sandbox cleanup failed", {
                runId: input.runId,
                agentId: agent.id,
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              });
            });
          }
        },
        buildInternalAgentRunTraceAttributes({
          runInput: input,
          agent,
          deps,
          status: "running",
        }),
      );

      // `withSpan` ends the run span after its callback settles. Keep the
      // response open until that lifecycle has completed so observing EOF also
      // guarantees that the terminal run telemetry is finalized. Cancellation
      // marks the client detached, in which case the stream is already closed
      // by its consumer and must not be closed a second time here.
      if (clientAttached) {
        controller.close();
      }
      logger.debug("Internal agent runtime stream response closed", {
        runId: input.runId,
        threadId: input.threadId,
        agentId: agent.id,
        clientAttached,
      });
    },
    cancel() {
      clientAttached = false;
      stopHeartbeat?.();
      stopHeartbeat = undefined;
      const status = deps.sessionManager.getRunStatus(input.runId);
      const shouldCancelActiveRun = status !== null && status !== "waiting";
      if (shouldCancelActiveRun) {
        deps.sessionManager.cancelRun(input.runId);
      }
      logger.info("Internal agent runtime client detached", {
        runId: input.runId,
        threadId: input.threadId,
        agentId: agent.id,
        status,
        cancelledActiveRun: shouldCancelActiveRun,
      });
      return Promise.resolve();
    },
  });

  return new Response(response, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(shouldEmitProviderReplayCheckpoints ? { [PROVIDER_REPLAY_PROTOCOL_HEADER]: "1" } : {}),
    },
  });
}
