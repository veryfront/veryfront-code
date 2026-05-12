import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostedSandboxToolsOptions } from "#veryfront/sandbox";
import { createHostedSandboxTools } from "#veryfront/sandbox";
import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  sleepTool,
  toolRegistry,
} from "#veryfront/tool";
import { parseProviderError } from "../chat/provider-errors.ts";
import { getConfig } from "../config/index.ts";
import {
  clearTrackedAgents,
  clearTranspileCache,
  createProjectDiscoveryConfig,
  DEFAULT_PROJECT_DISCOVERY_DIRS,
  discoverAll,
} from "../discovery/index.ts";
import type { DiscoveryResult } from "../discovery/types.ts";
import { nodeAdapter } from "../platform/adapters/node.ts";
import {
  getVeryfrontCloudProviderFromModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "../provider/index.ts";
import { __registerTraceContextGetter } from "../utils/logger/logger.ts";
import {
  buildAgentRunTraceAttributes,
  buildExecuteToolTraceAttributes,
  filterAgentTraceAttributes,
} from "./agent-trace-attributes.ts";
import {
  type BootstrapAgentServiceOptions,
  runAgentServiceMain,
  type RunAgentServiceMainOptions,
} from "./agent-service-bootstrap.ts";
import { loadAgentServiceEnvFiles } from "./hosted-agent-service-env-files.ts";
import { createHostedFormInputTool } from "./hosted-form-input-tool.ts";
import { createHostedAgentProjectSteering } from "./hosted-agent-project-steering.ts";
import { type HostedChatRuntimeCreationResult } from "./hosted-chat-runtime-contract.ts";
import type { HostedConversationRootRunContext } from "./conversation-root-run-lifecycle.ts";
import { type AgentRuntimeMessage } from "./agent-runtime-message-adapter.ts";
import { createLiveStudioMcpTools } from "./live-studio-mcp-tools.ts";
import {
  createDefaultHostedChatRuntime,
  type DefaultHostedChatRuntimeCreationOptions,
  type DefaultHostedChatRuntimeTaskContext,
} from "./default-hosted-chat-runtime.ts";
import { createDefaultHostedInvokeAgentTool } from "./default-hosted-invoke-agent-tool.ts";
import type { RuntimeClientProfile } from "./runtime-client-profile.ts";
import type {
  DefaultHostedInvokeAgentConfig,
  DefaultHostedInvokeAgentContext,
} from "./default-hosted-invoke-agent-tool.ts";
import {
  createDefaultHostedProjectSteeringRefresh,
  fetchDefaultHostedProjectSteering,
} from "./default-hosted-project-steering-refresh.ts";
import { type HostedProjectSkillIdsContext } from "./hosted-project-steering-adapter.ts";
import type { RuntimeLoadSkillToolContext } from "./runtime-load-skill-tool.ts";
import type { RuntimeProjectSteeringLookup } from "./runtime-project-skill-catalog.ts";
import type { RuntimeSkillDefinition } from "./runtime-skill-metadata.ts";
import {
  loadRuntimeAgentMarkdownDefinitionFromFile,
  resolveRuntimeAgentDefinitionsDir,
} from "./runtime-agent-definition-files.ts";
import type { RuntimeAgentMarkdownDefinition } from "./runtime-agent-definition.ts";
import {
  buildVeryfrontCloudRuntimeInstructions,
} from "./veryfront-cloud-runtime-system-messages.ts";
import {
  createNodeAgentServiceRuntimeInfrastructure,
  type CreateNodeAgentServiceRuntimeInfrastructureOptions,
} from "./node-hosted-agent-service-runtime-infrastructure.ts";
import {
  type AgentServiceRuntimeBundle,
  type AgentServiceRuntimeConfig,
  createAgentServiceRuntime,
  type CreateAgentServiceRuntimeOptions,
  startAgentServiceRuntime,
  startNodeAgentService,
  type StartNodeAgentServiceResult,
} from "./hosted-agent-service-runtime.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import type { AgUiResumeValue } from "./ag-ui-tool-shared.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";
import type { PreparedHostedChatExecution } from "./prepared-hosted-chat-execution.ts";
import {
  runPreparedHostedChatExecutionDetached,
  streamPreparedHostedChatExecutionToAgUiResponse,
} from "./prepared-hosted-chat-execution.ts";
import {
  createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions,
} from "./veryfront-cloud-prepared-hosted-chat-execution-runtime.ts";
import {
  prepareVeryfrontCloudHostedChatExecution,
} from "./veryfront-cloud-hosted-chat-execution-preparation.ts";
import { applyAgentProjectContextChange } from "./project-context.ts";
import type { Agent, AgentConfig } from "./types.ts";
import { agentRegistry, getAgent } from "./composition/index.ts";

export type NodeVeryfrontCloudAgentServiceProcessTarget =
  & NonNullable<RunAgentServiceMainOptions["processTarget"]>
  & NonNullable<CreateNodeAgentServiceRuntimeInfrastructureOptions["processTarget"]>
  & {
    env?: Record<string, string | undefined>;
    exit?: (code: number) => never | void;
  };

export type NodeVeryfrontCloudAgentServiceAgentSource = "auto" | "code" | "markdown";

export type NodeVeryfrontCloudAgentServiceMcpOptions = {
  /**
   * Opt in to Studio UI/control-plane MCP tools for trusted Studio-capable clients.
   * API MCP tools remain part of the Veryfront Cloud service preset.
   */
  studio?: boolean;
};

type AgentServicePathOption = string | URL;

export type NodeVeryfrontCloudAgentServiceOptions = {
  serviceName: string;
  agentId: string;
  /**
   * Project/discovery root. Defaults to the process cwd when neither baseDir
   * nor an entrypoint URL is provided.
   */
  baseDir?: AgentServicePathOption;
  projectDir?: string;
  /**
   * Convenience URL for deriving baseDir from the entry module location.
   */
  entrypointUrl?: AgentServicePathOption;
  agentSource?: NodeVeryfrontCloudAgentServiceAgentSource;
  mcp?: NodeVeryfrontCloudAgentServiceMcpOptions;
  forwardedConfigNamespace?: string;
  createBashTool?: HostedSandboxToolsOptions["createBashTool"];
  env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
  processTarget?: NodeVeryfrontCloudAgentServiceProcessTarget;
  drainTimeoutMs?: number;
  hardShutdownTimeoutMs?: number;
};

export type VeryfrontCloudAgentServiceOptions = NodeVeryfrontCloudAgentServiceOptions;

type ResolvedNodeVeryfrontCloudAgentServiceOptions =
  & NodeVeryfrontCloudAgentServiceOptions
  & {
    createBashTool: HostedSandboxToolsOptions["createBashTool"];
  };

export type NodeVeryfrontCloudAgentServicePreparedExecution = PreparedHostedChatExecution & {
  config: AgentServiceRuntimeConfig;
  agent: HostedChatRuntimeCreationResult["agent"];
  runtimeKind: "framework";
  finalMessages: AgentRuntimeMessage[];
  messages: PreparedHostedChatExecution["messages"];
  rootRunContext: HostedConversationRootRunContext;
};

type NodeVeryfrontCloudAgentServiceContext = ReturnType<
  typeof createNodeVeryfrontCloudAgentServiceContext
>;
type ChildRunContext = DefaultHostedInvokeAgentContext & {
  clientProfile?: RuntimeClientProfile | null;
};

const DEFAULT_FORWARDED_CONFIG_NAMESPACE = "veryfront";
const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;
const DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS = 20_000;
const DEFAULT_PROJECT_NAVIGATION_TOOL_NAMES = ["studio_open_project"];
const PROJECT_CONFIG_FILES = [
  "veryfront.config.js",
  "veryfront.config.ts",
  "veryfront.config.mjs",
];

function pathOptionToPath(pathOption: AgentServicePathOption): string {
  return pathOption instanceof URL ? fileURLToPath(pathOption) : pathOption;
}

function resolveBaseDir(
  options: Pick<NodeVeryfrontCloudAgentServiceOptions, "baseDir" | "entrypointUrl">,
): string {
  if (options.baseDir !== undefined) {
    return pathOptionToPath(options.baseDir);
  }
  if (options.entrypointUrl !== undefined) {
    return dirname(pathOptionToPath(options.entrypointUrl));
  }
  if (typeof process !== "undefined") {
    return process.cwd();
  }
  return Deno.cwd();
}
function hasDiscoveryRoot(baseDir: string): boolean {
  const discoveryDirs = [
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.agentDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.skillDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.resourceDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.promptDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.workflowDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.taskDirs,
  ];

  return discoveryDirs.some((dir) => existsSync(resolve(baseDir, dir))) ||
    PROJECT_CONFIG_FILES.some((file) => existsSync(resolve(baseDir, file)));
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function resolveProjectDir(
  options: Pick<
    NodeVeryfrontCloudAgentServiceOptions,
    "baseDir" | "entrypointUrl" | "projectDir"
  >,
): string {
  if (options.projectDir) {
    return options.projectDir;
  }

  const baseDir = resolveBaseDir(options);
  const candidates = uniquePaths([baseDir, dirname(baseDir), dirname(dirname(baseDir))]);
  return candidates.find(hasDiscoveryRoot) ?? baseDir;
}

function resolveDefaultProcessTarget(): NodeVeryfrontCloudAgentServiceProcessTarget | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process;
}

async function loadDefaultCreateBashTool(): Promise<
  HostedSandboxToolsOptions["createBashTool"]
> {
  const { createBashTool } = await import("bash-tool");
  return createBashTool;
}

async function resolveNodeVeryfrontCloudAgentServiceOptions(
  options: NodeVeryfrontCloudAgentServiceOptions,
): Promise<ResolvedNodeVeryfrontCloudAgentServiceOptions> {
  return {
    ...options,
    createBashTool: options.createBashTool ?? await loadDefaultCreateBashTool(),
  };
}

function resolveEnvironment(
  options: Pick<NodeVeryfrontCloudAgentServiceOptions, "env" | "processTarget">,
): CreateNodeAgentServiceRuntimeInfrastructureOptions["env"] {
  if (options.env) {
    return options.env;
  }
  if (options.processTarget?.env) {
    return options.processTarget.env;
  }
  if (typeof process !== "undefined") {
    return process.env;
  }
  if (typeof Deno !== "undefined") {
    return Deno.env.toObject();
  }
  return {};
}

function createNodeVeryfrontCloudAgentServiceContext(
  options: ResolvedNodeVeryfrontCloudAgentServiceOptions,
) {
  const processTarget = options.processTarget ?? resolveDefaultProcessTarget();
  const infrastructure = createNodeAgentServiceRuntimeInfrastructure({
    serviceName: options.serviceName,
    env: resolveEnvironment({ env: options.env, processTarget }),
    processTarget,
  });
  function trace<TResult>(
    operationName: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult>;
  function trace<TResult>(operationName: string, operation: () => TResult): TResult;
  function trace<TResult>(
    operationName: string,
    operation: () => TResult | Promise<TResult>,
  ): TResult | Promise<TResult> {
    return infrastructure.tracer.trace(operationName, operation);
  }
  const projectSteering = createHostedAgentProjectSteering({
    baseDir: resolveBaseDir(options),
    agentId: options.agentId,
    getApiUrl: () => infrastructure.getConfig().VERYFRONT_API_URL,
    logger: infrastructure.logger,
    trace,
  });

  return {
    options,
    processTarget,
    projectDir: resolveProjectDir(options),
    infrastructure,
    trace,
    projectSteering,
    tracker: createDetachedRunTracker<AgUiResumeValue>(),
    discoveryResult: null as DiscoveryResult | null,
    agentConfig: null as RuntimeAgentMarkdownDefinition | null,
    agentConfigs: new Map<string, RuntimeAgentMarkdownDefinition>(),
  };
}

function resolveAgentSystem(system: AgentConfig["system"]): Promise<string> | string {
  return typeof system === "function" ? system() : system;
}

async function createRuntimeAgentDefinitionFromCodeAgent(
  codeAgent: Agent,
): Promise<RuntimeAgentMarkdownDefinition> {
  return {
    id: codeAgent.id,
    name: codeAgent.id,
    description: "",
    instructions: await resolveAgentSystem(codeAgent.config.system),
    model: codeAgent.config.model,
    maxSteps: codeAgent.config.maxSteps,
  };
}

function getMarkdownAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
): RuntimeAgentMarkdownDefinition {
  return context.projectSteering.getAgentConfig();
}

function loadMarkdownAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  agentId: string,
): RuntimeAgentMarkdownDefinition {
  if (agentId === context.options.agentId) {
    return getMarkdownAgentConfig(context);
  }

  const agentsDir = resolveRuntimeAgentDefinitionsDir({
    baseDir: resolveBaseDir(context.options),
    id: agentId,
  });

  return loadRuntimeAgentMarkdownDefinitionFromFile({
    agentsDir,
    id: agentId,
  });
}

async function resolveAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  agentId: string,
): Promise<RuntimeAgentMarkdownDefinition> {
  const cachedAgentConfig = context.agentConfigs.get(agentId);
  if (cachedAgentConfig) {
    return cachedAgentConfig;
  }

  const source = context.options.agentSource ?? "auto";
  const codeAgent = getAgent(agentId);

  if (source !== "markdown" && codeAgent) {
    const agentConfig = await createRuntimeAgentDefinitionFromCodeAgent(codeAgent);
    context.agentConfigs.set(agentConfig.id, agentConfig);
    return agentConfig;
  }

  if (source === "code") {
    throw new Error(`Code agent "${agentId}" was not discovered.`);
  }

  const agentConfig = loadMarkdownAgentConfig(context, agentId);
  context.agentConfigs.set(agentConfig.id, agentConfig);
  return agentConfig;
}

function getResolvedAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
): RuntimeAgentMarkdownDefinition {
  if (!context.agentConfig) {
    throw new Error("Agent service context has not been initialized.");
  }
  return context.agentConfig;
}

async function discoverProjectPrimitives(
  context: NodeVeryfrontCloudAgentServiceContext,
): Promise<void> {
  clearTrackedAgents();
  clearTranspileCache();
  agentRegistry.clear();
  toolRegistry.clear();

  const config = await getConfig(context.projectDir, nodeAdapter);
  const discoveryOptions = createProjectDiscoveryConfig({
    projectDir: context.projectDir,
    config,
  });

  context.discoveryResult = await discoverAll(discoveryOptions);
}

async function initializeNodeVeryfrontCloudAgentServiceContext(
  context: NodeVeryfrontCloudAgentServiceContext,
): Promise<void> {
  await discoverProjectPrimitives(context);
  context.agentConfig = await resolveAgentConfig(context, context.options.agentId);
}

function getDiscoveredHostTools(): HostToolSet {
  return Object.fromEntries(
    [...toolRegistry.getAll()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function getProjectInstructions(
  context: NodeVeryfrontCloudAgentServiceContext,
  lookup: RuntimeProjectSteeringLookup,
): Promise<string> {
  return context.trace("chat.getProjectInstructions", async () => {
    return await context.projectSteering.getProjectInstructions(lookup);
  });
}

function getSkillsConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  lookup: RuntimeProjectSteeringLookup,
): Promise<RuntimeSkillDefinition[]> {
  return context.trace("chat.getSkillsConfig", async () => {
    return await context.projectSteering.getSkillsConfig(lookup);
  });
}

function createLoadSkillTool(
  context: NodeVeryfrontCloudAgentServiceContext,
  toolContext: RuntimeLoadSkillToolContext,
) {
  return context.projectSteering.createLoadSkillTool(toolContext);
}

async function refreshProjectSkillIds(
  context: NodeVeryfrontCloudAgentServiceContext,
  skillContext: HostedProjectSkillIdsContext,
): Promise<void> {
  await context.projectSteering.refreshProjectSkillIds(skillContext);
}

function setFilteredTraceAttributes(
  context: NodeVeryfrontCloudAgentServiceContext,
  attributes: Record<string, unknown>,
): void {
  context.infrastructure.setActiveSpanAttributes(filterAgentTraceAttributes(attributes));
}

function getInvokeAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
): DefaultHostedInvokeAgentConfig {
  const config = context.infrastructure.getConfig();
  const studioMcpUrl = context.options.mcp?.studio ? config.VERYFRONT_STUDIO_MCP_URL : "";

  return {
    apiUrl: config.VERYFRONT_API_URL,
    apiMcpUrl: config.VERYFRONT_MCP_URL,
    studioMcpUrl,
    enableDurableInvokeAgent: config.VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT,
  };
}

function shouldRethrowInvokeAgentError(error: unknown): boolean {
  return parseProviderError(error).code === "INSUFFICIENT_CREDITS";
}

function createInvokeAgentTool(
  context: NodeVeryfrontCloudAgentServiceContext,
  childContext: ChildRunContext,
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
    resolveProviderOptions: resolveVeryfrontCloudThinkingProviderOptions,
    shouldRethrowError: shouldRethrowInvokeAgentError,
    buildGlobalTools: (globalToolContext) => ({
      load_skill: createLoadSkillTool(context, globalToolContext),
    }),
    refreshProjectSkillIds: (projectSkillContext) =>
      refreshProjectSkillIds(context, projectSkillContext),
    createHostedSandboxTools,
    createLiveStudioTools: createLiveStudioMcpTools,
    createRemoteToolSource: createRemoteMCPToolSource,
    createToolsFromRemoteDefinitions,
  });
}

function buildLocalTools(
  context: NodeVeryfrontCloudAgentServiceContext,
  options: DefaultHostedChatRuntimeCreationOptions,
  taskContext: DefaultHostedChatRuntimeTaskContext,
): HostToolSet {
  const config = context.infrastructure.getConfig();
  const tools: HostToolSet = {
    ...getDiscoveredHostTools(),
    form_input: createHostedFormInputTool(taskContext, config.VERYFRONT_API_URL),
    load_skill: createLoadSkillTool(context, taskContext),
    sleep: sleepTool,
  };

  if (options.allowDelegation !== false) {
    tools.invoke_agent = createInvokeAgentTool(context, taskContext);
  }

  return tools;
}

function createProjectSteeringRefresh(context: NodeVeryfrontCloudAgentServiceContext) {
  return createDefaultHostedProjectSteeringRefresh({
    fetchProjectInstructions: (lookup) => getProjectInstructions(context, lookup),
    fetchSkills: (lookup) => getSkillsConfig(context, lookup),
    buildInstructions: buildVeryfrontCloudRuntimeInstructions,
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: DEFAULT_PROJECT_NAVIGATION_TOOL_NAMES,
    },
    logger: context.infrastructure.logger,
  });
}

function createAgentRuntime(
  context: NodeVeryfrontCloudAgentServiceContext,
  options: DefaultHostedChatRuntimeCreationOptions,
): Promise<HostedChatRuntimeCreationResult> {
  const config = context.infrastructure.getConfig();
  const refreshSystem = createProjectSteeringRefresh(context);

  return createDefaultHostedChatRuntime({
    options,
    config: {
      apiUrl: config.VERYFRONT_API_URL,
      apiMcpUrl: config.VERYFRONT_MCP_URL,
      studioMcpUrl: context.options.mcp?.studio ? config.VERYFRONT_STUDIO_MCP_URL : "",
      studioMcpEnabled: context.options.mcp?.studio ?? false,
    },
    buildLocalTools: (taskContext) => buildLocalTools(context, options, taskContext),
    refreshSystem,
    onSteeringMutation: async ({ mutation, taskContext }) => {
      if (mutation.skillsChanged) {
        await refreshProjectSkillIds(context, {
          ...taskContext,
          authToken: taskContext.authToken,
        });
      }
    },
    onStudioProjectSwitch: async ({ projectId, taskContext }) => {
      if (!applyAgentProjectContextChange(taskContext, projectId)) {
        return false;
      }

      await refreshProjectSkillIds(context, {
        ...taskContext,
        authToken: taskContext.authToken,
      });
      return true;
    },
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: DEFAULT_PROJECT_NAVIGATION_TOOL_NAMES,
    },
    createRemoteToolSource: createRemoteMCPToolSource,
    traceLocalTools: {
      trace: (spanName, operation) => context.infrastructure.tracer.trace(spanName, operation),
      buildAttributes: ({ toolName, toolCallId }) =>
        buildExecuteToolTraceAttributes({
          toolName,
          toolCallId,
        }),
      setAttributes: (attributes) => setFilteredTraceAttributes(context, attributes),
    },
    logger: context.infrastructure.logger,
  });
}

function setPrepareChatExecutionStartAttributes(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: { projectId: string | null; userId: string },
): void {
  const span = context.infrastructure.tracer.scope().active();
  span?.setAttributes({
    "chat.projectId": input.projectId ?? "none",
    "chat.userId": input.userId,
  });
}

function setPrepareChatExecutionResultAttributes(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: {
    conversationId?: string;
    projectId: string | null;
    userId: string;
    agentId: string;
    runId?: string;
    upstreamParentConversationId?: string;
    upstreamParentRunId?: string;
    spawnedFromToolCallId?: string;
    runtimeKind: "framework";
  },
): void {
  const span = context.infrastructure.tracer.scope().active();
  span?.setAttributes(
    buildAgentRunTraceAttributes({
      operationName: "chat",
      conversationId: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
      agentId: input.agentId,
      runId: input.runId,
      parentConversationId: input.upstreamParentConversationId,
      parentRunId: input.upstreamParentRunId,
      toolCallId: input.spawnedFromToolCallId,
    }),
  );
  span?.setAttributes({
    "agent.runtime.kind": input.runtimeKind,
  });
}

function fetchProjectSteering(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: { projectId: string | null; authToken: string; branchId?: string | null },
) {
  return fetchDefaultHostedProjectSteering({
    ...input,
    fetchProjectInstructions: (lookup) => getProjectInstructions(context, lookup),
    fetchSkills: (lookup) => getSkillsConfig(context, lookup),
    trace: context.trace,
    traceOperationName: "chat.fetchSteering",
  });
}

async function prepareChatExecution(
  context: NodeVeryfrontCloudAgentServiceContext,
  req: ParsedHostedChatRequest,
): Promise<NodeVeryfrontCloudAgentServicePreparedExecution> {
  const {
    userId,
    authToken,
    projectId,
    conversationId,
    upstreamParentConversationId,
    upstreamParentRunId,
    spawnedFromToolCallId,
  } = req;
  const config = context.infrastructure.getConfig();

  setPrepareChatExecutionStartAttributes(context, { projectId, userId });

  const agentConfig = await resolveAgentConfig(context, req.agentId ?? context.options.agentId);
  const {
    effectiveMessages,
    rootRunContext,
    runtime: { agent, runtimeKind, modelId, cleanup },
    finalMessages,
  } = await prepareVeryfrontCloudHostedChatExecution({
    request: req,
    agentConfig,
    apiUrl: config.VERYFRONT_API_URL,
    abortSignal: new AbortController().signal,
    logger: context.infrastructure.logger,
    rootRun: {
      instrumentation: {
        trace: context.trace,
        setTraceAttributes: context.infrastructure.setActiveSpanAttributes,
        debug: (message, metadata) => context.infrastructure.logger.debug(message, metadata),
        warn: (message, metadata) => context.infrastructure.logger.warn(message, metadata),
        error: (message, metadata) => context.infrastructure.logger.error(message, metadata),
      },
    },
    fetchSteering: (steeringInput) => fetchProjectSteering(context, steeringInput),
    buildInstructions: buildVeryfrontCloudRuntimeInstructions,
    createRuntime: (creationOptions) =>
      context.trace("chat.createRuntime", () =>
        createAgentRuntime(context, {
          ...creationOptions,
          userId: req.userId,
        })),
  });

  setPrepareChatExecutionResultAttributes(context, {
    conversationId,
    projectId,
    userId,
    agentId: agentConfig.id,
    runId: rootRunContext.durableRootRun?.runId,
    upstreamParentConversationId,
    upstreamParentRunId,
    spawnedFromToolCallId,
    runtimeKind,
  });

  return {
    config,
    agent,
    agentId: agentConfig.id,
    runtimeKind,
    modelId,
    cleanup,
    messages: effectiveMessages,
    finalMessages,
    conversationId,
    authToken,
    projectId,
    userId,
    rootRunContext,
    upstreamParentConversationId,
    upstreamParentRunId,
    spawnedFromToolCallId,
  };
}

function createPreparedExecutionRuntimeOptions(
  context: NodeVeryfrontCloudAgentServiceContext,
  config: AgentServiceRuntimeConfig,
) {
  return createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions({
    apiUrl: config.VERYFRONT_API_URL,
    tracer: context.infrastructure.tracer,
    trace: context.trace,
    traceStream: (operation) => context.infrastructure.tracer.trace("chat.stream", operation),
    logger: context.infrastructure.logger,
    setActiveSpanAttributes: context.infrastructure.setActiveSpanAttributes,
  });
}

function createNodeVeryfrontCloudAgentServiceRuntimeOptions(
  context: NodeVeryfrontCloudAgentServiceContext,
): CreateAgentServiceRuntimeOptions<NodeVeryfrontCloudAgentServicePreparedExecution> {
  return {
    serviceName: context.options.serviceName,
    forwardedConfigNamespace: context.options.forwardedConfigNamespace ??
      DEFAULT_FORWARDED_CONFIG_NAMESPACE,
    getConfig: context.infrastructure.getConfig,
    getAgentConfig: () => getResolvedAgentConfig(context),
    tracker: context.tracker,
    prepareExecution: (request) => prepareChatExecution(context, request),
    streamExecutionToAgUiResponse: (execution) =>
      streamPreparedHostedChatExecutionToAgUiResponse({
        execution,
        runtime: createPreparedExecutionRuntimeOptions(context, execution.config),
      }),
    startDetachedExecution: ({ execution, abortSignal }) =>
      runPreparedHostedChatExecutionDetached({
        execution: {
          ...execution,
          abortSignal,
        },
        runtime: createPreparedExecutionRuntimeOptions(context, execution.config),
      }),
    cleanupExecution: async ({ execution, runId, conversationId }) => {
      await execution.cleanup().catch((error) => {
        context.infrastructure.logger.error(
          "Detached durable run cleanup failed after duplicate start",
          {
            runId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    },
    setActiveSpanAttributes: context.infrastructure.setActiveSpanAttributes,
    trace: context.trace,
    logger: context.infrastructure.logger,
    drainTimeoutMs: context.options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
  };
}

export async function createNodeVeryfrontCloudAgentServiceRuntime(
  options: NodeVeryfrontCloudAgentServiceOptions,
): Promise<AgentServiceRuntimeBundle<NodeVeryfrontCloudAgentServicePreparedExecution>> {
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext(resolvedOptions);
  await initializeNodeVeryfrontCloudAgentServiceContext(context);
  return createAgentServiceRuntime(createNodeVeryfrontCloudAgentServiceRuntimeOptions(context));
}

export async function startNodeVeryfrontCloudAgentService(
  options: NodeVeryfrontCloudAgentServiceOptions,
): Promise<StartNodeAgentServiceResult<NodeVeryfrontCloudAgentServicePreparedExecution>> {
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext(resolvedOptions);
  await initializeNodeVeryfrontCloudAgentServiceContext(context);
  return await startNodeAgentService({
    ...createNodeVeryfrontCloudAgentServiceRuntimeOptions(context),
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS,
  });
}

export async function startAgentService(
  options: NodeVeryfrontCloudAgentServiceOptions,
): Promise<void> {
  const processTarget = options.processTarget ?? resolveDefaultProcessTarget();
  let getRuntimeTraceContext: NonNullable<BootstrapAgentServiceOptions["getTraceContext"]> =
    () => ({});

  await loadAgentServiceEnvFiles();
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext({
    ...resolvedOptions,
    processTarget,
  });
  getRuntimeTraceContext = context.infrastructure.getTraceContext;
  await initializeNodeVeryfrontCloudAgentServiceContext(context);

  await runAgentServiceMain({
    loadLogger: () => context.infrastructure.logger,
    initializeTelemetry: async () => {
      return await context.infrastructure.initializeOpenTelemetry().catch((error) => {
        console.error("Failed to initialize OpenTelemetry:", error);
        return false;
      });
    },
    onTelemetryInitialized: () => {
      console.log("OpenTelemetry initialized successfully");
    },
    getTraceContext: () => getRuntimeTraceContext(),
    registerTraceContextGetter: (getter) => {
      __registerTraceContextGetter(getter);
    },
    start: async () => {
      await startAgentServiceRuntime({
        ...createNodeVeryfrontCloudAgentServiceRuntimeOptions(context),
        hardShutdownTimeoutMs: options.hardShutdownTimeoutMs ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS,
      });
    },
    onStartupError: (error) => {
      console.error("Error in server startup:", error);
    },
    exit: processTarget?.exit,
    processTarget,
  });
}
