import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentServiceSandboxToolsOptions } from "#veryfront/sandbox";
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import { dirname, resolve } from "#veryfront/platform/compat/path/index.ts";
import { cwd, env } from "#veryfront/platform/compat/process.ts";
import type { AuthProvider } from "#veryfront/extensions/auth/index.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  type NodeTelemetryProvider,
  NodeTelemetryProviderName,
} from "#veryfront/extensions/observability/index.ts";
import {
  type SandboxShellToolsProvider,
  SandboxShellToolsProviderName,
} from "#veryfront/extensions/sandbox/index.ts";
import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  sleepTool,
  toolRegistry,
} from "#veryfront/tool";
import { parseProviderError } from "../../chat/provider-errors.ts";
import { DEFAULT_PROJECT_DISCOVERY_DIRS } from "../../discovery/index.ts";
import type { DiscoveryResult } from "../../discovery/types.ts";
import { nodeAdapter } from "../../platform/adapters/node.ts";
import {
  getVeryfrontCloudProviderFromModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "../../provider/index.ts";
import { __registerTraceContextGetter } from "../../utils/logger/logger.ts";
import {
  buildAgentRunTraceAttributes,
  buildExecuteToolTraceAttributes,
  filterAgentTraceAttributes,
} from "./trace-attributes.ts";
import {
  type BootstrapAgentServiceOptions,
  runAgentServiceMain,
  type RunAgentServiceMainOptions,
} from "../service/bootstrap.ts";
import { loadAgentServiceEnvFiles } from "../service/env-files.ts";
import { createHostedFormInputTool } from "./form-input-tool.ts";
import {
  createHostedAgentProjectSteering,
  type HostedAgentProjectSteering,
} from "./agent-project-steering.ts";
import { type HostedChatRuntimeCreationResult } from "./chat-runtime-contract.ts";
import type { HostedConversationRootRunContext } from "../conversation/root-run-lifecycle.ts";
import { type AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import { createLiveStudioMcpTools } from "../project/live-studio-mcp-tools.ts";
import {
  createDefaultHostedChatRuntime,
  type DefaultHostedChatRuntimeCreationOptions,
  type DefaultHostedChatRuntimeTaskContext,
} from "./default-chat-runtime.ts";
import { createVeryfrontCloudContextSummaryGenerator } from "./context-summary-generator.ts";
import { createDefaultHostedInvokeAgentTool } from "./default-invoke-agent-tool.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import type {
  DefaultHostedInvokeAgentConfig,
  DefaultHostedInvokeAgentContext,
} from "./default-invoke-agent-tool.ts";
import {
  createDefaultHostedProjectSteeringRefresh,
  fetchDefaultHostedProjectSteering,
} from "./default-project-steering-refresh.ts";
import { type HostedProjectSkillIdsContext } from "./project-steering-adapter.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import type { AgentVeryfrontMcpServerConfig } from "../types.ts";
import type { RuntimeLoadSkillToolContext } from "../runtime/load-skill-tool.ts";
import type { RuntimeProjectSteeringLookup } from "../runtime/project-skill-catalog.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import {
  createRuntimeAgentDefinitionFromAgent,
  describeProjectAgentRuntimeAgentIdCandidates,
  discoverProjectAgentRuntime,
  doesProjectAgentRuntimeAgentMatchSource,
  getProjectAgentRuntimeAgentIdCandidates,
  type ProjectAgentRuntimeAgentSource,
  resolveSingleProjectAgentRuntimeAgentId,
} from "../project/agent-runtime.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import {
  createNodeAgentServiceRuntimeInfrastructure,
  type CreateNodeAgentServiceRuntimeInfrastructureOptions,
} from "../service/node-runtime-infrastructure.ts";
import {
  type AgentServiceRuntimeBundle,
  type AgentServiceRuntimeConfig,
  createAgentServiceRuntime,
  type CreateAgentServiceRuntimeOptions,
  startAgentServiceRuntime,
  startNodeAgentService,
  type StartNodeAgentServiceResult,
} from "../service/runtime.ts";
import type { AgentServiceServerLifecycle } from "../service/server.ts";
import {
  createAgentServiceRegistrationLifecycle,
  resolveAgentServiceRegistrationInput,
} from "../service/registration.ts";
import { createDetachedRunTracker } from "../service/detached-run-tracker.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { PreparedHostedChatExecution } from "./prepared-chat-execution.ts";
import {
  runPreparedHostedChatExecutionDetached,
  streamPreparedHostedChatExecutionToAgUiResponse,
} from "./prepared-chat-execution.ts";
import {
  createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions,
} from "./cloud-prepared-chat-execution-runtime.ts";
import { prepareVeryfrontCloudHostedChatExecution } from "./cloud-chat-execution-preparation.ts";
import type { HostedChatContextBudgetOptions } from "./chat-preparation.ts";
import { applyAgentProjectContextChange } from "../project/context.ts";
import { getAgent } from "../composition/index.ts";

/** Public API contract for node Veryfront Cloud agent service process target. */
export type NodeVeryfrontCloudAgentServiceProcessTarget =
  & NonNullable<RunAgentServiceMainOptions["processTarget"]>
  & NonNullable<CreateNodeAgentServiceRuntimeInfrastructureOptions["processTarget"]>
  & {
    env?: Record<string, string | undefined>;
    exit?: (code: number) => never | void;
  };

export type NodeVeryfrontCloudAgentServiceAgentSource = ProjectAgentRuntimeAgentSource;

/** Public API contract for node Veryfront Cloud agent service MCP server. */
export type NodeVeryfrontCloudAgentServiceMcpServer = AgentServiceMcpServerConfig;

/** Veryfront API MCP server helper. */
export function veryfrontApiMcpServer():
  & AgentServiceMcpServerConfig
  & AgentVeryfrontMcpServerConfig {
  return { kind: "veryfront-api" };
}

/** Veryfront Studio MCP server helper. */
export function veryfrontStudioMcpServer():
  & AgentServiceMcpServerConfig
  & AgentVeryfrontMcpServerConfig {
  return { kind: "veryfront-studio" };
}

type AgentServicePathOption = string | URL;

/** Options accepted by node Veryfront Cloud agent service. */
export type NodeVeryfrontCloudAgentServiceOptions = {
  /**
   * Stable service identity used by the control plane and service runtime.
   * Defaults to VERYFRONT_AGENT_SERVICE_NAME, then the nearest project
   * package.json or deno.json name, then "veryfront-agent-service".
   */
  serviceName?: string;
  /**
   * Default agent served by requests that do not provide an agent id. When
   * omitted, the service selects the only discovered code or markdown agent.
   */
  agentId?: string;
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
  /**
   * Remote MCP servers available to the runtime. Defaults to the Veryfront API
   * MCP server. Pass [] to run without remote MCP tools.
   */
  mcpServers?: readonly NodeVeryfrontCloudAgentServiceMcpServer[];
  forwardedConfigNamespace?: string;
  createBashTool?: AgentServiceSandboxToolsOptions["createBashTool"];
  env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
  processTarget?: NodeVeryfrontCloudAgentServiceProcessTarget;
  drainTimeoutMs?: number;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
};

/** Options accepted by Veryfront Cloud agent service. */
export type VeryfrontCloudAgentServiceOptions = NodeVeryfrontCloudAgentServiceOptions;
/** Options accepted by agent service. */
export type AgentServiceOptions = NodeVeryfrontCloudAgentServiceOptions;

type ResolvedNodeVeryfrontCloudAgentServiceOptions =
  & Omit<NodeVeryfrontCloudAgentServiceOptions, "createBashTool" | "serviceName">
  & {
    createBashTool: AgentServiceSandboxToolsOptions["createBashTool"];
    serviceName: string;
  };

/** Public API contract for node Veryfront Cloud agent service prepared execution. */
export type NodeVeryfrontCloudAgentServicePreparedExecution = PreparedHostedChatExecution & {
  config: AgentServiceRuntimeConfig;
  agent: HostedChatRuntimeCreationResult["agent"];
  runtimeKind: "framework";
  finalMessages: AgentRuntimeMessage[];
  messages: PreparedHostedChatExecution["messages"];
  rootRunContext: HostedConversationRootRunContext;
};
/** Public API contract for agent service prepared execution. */
export type AgentServicePreparedExecution = NodeVeryfrontCloudAgentServicePreparedExecution;
/** Public API contract for agent service process target. */
export type AgentServiceProcessTarget = NodeVeryfrontCloudAgentServiceProcessTarget;

type NodeVeryfrontCloudAgentServiceContext = ReturnType<
  typeof createNodeVeryfrontCloudAgentServiceContext
>;
type ChildRunContext = DefaultHostedInvokeAgentContext & {
  clientProfile?: RuntimeClientProfile | null;
};

const DEFAULT_FORWARDED_CONFIG_NAMESPACE = "veryfront";
const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;
const DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS = 20_000;
const DEFAULT_AGENT_SERVICE_NAME = "veryfront-agent-service";
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
  return cwd();
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

/**
 * Schema for the subset of a project manifest (package.json / deno.json) we
 * read. Only `name` is consumed; extra fields are tolerated via passthrough so
 * arbitrary manifests validate. Defined lazily via `defineSchema` so the zod
 * extension is resolved at call time — the cloud-agent options resolver calls
 * `ensureDefaultSchemaValidator()` before reaching service-name resolution, so
 * a validator is registered by the time this runs.
 */
const getProjectManifestSchema = defineSchema((v) =>
  v.object({
    name: v.string().optional(),
  }).passthrough()
);

function readProjectManifestName(projectDir: string): string | null {
  const manifestSchema = getProjectManifestSchema();

  for (const fileName of ["package.json", "deno.json"]) {
    const filePath = resolve(projectDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const result = manifestSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
      if (!result.success) continue;
      const name = result.data.name;
      if (typeof name !== "string") continue;
      const trimmedName = name.trim();
      if (trimmedName) return trimmedName;
    } catch {
      continue;
    }
  }

  return null;
}

function resolveServiceName(
  options: Pick<
    NodeVeryfrontCloudAgentServiceOptions,
    "baseDir" | "entrypointUrl" | "env" | "processTarget" | "projectDir" | "serviceName"
  >,
): string {
  if (options.serviceName?.trim()) {
    return options.serviceName.trim();
  }

  const env = resolveEnvironment(options);
  const envServiceName = env.VERYFRONT_AGENT_SERVICE_NAME?.trim();
  if (envServiceName) {
    return envServiceName;
  }

  return readProjectManifestName(resolveProjectDir(options)) ?? DEFAULT_AGENT_SERVICE_NAME;
}

function resolveDefaultProcessTarget(): NodeVeryfrontCloudAgentServiceProcessTarget | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process;
}

function resolveMcpServers(
  options: Pick<NodeVeryfrontCloudAgentServiceOptions, "mcpServers">,
): readonly NodeVeryfrontCloudAgentServiceMcpServer[] {
  return options.mcpServers ?? [veryfrontApiMcpServer()];
}

async function loadDefaultCreateBashTool(): Promise<
  AgentServiceSandboxToolsOptions["createBashTool"]
> {
  const provider = tryResolve<SandboxShellToolsProvider>(SandboxShellToolsProviderName);
  if (provider) return provider;

  try {
    const { createBashSandboxShellToolsProvider } = await import(
      "../../../extensions/ext-sandbox-shell-tools/src/index.ts"
    );
    return createBashSandboxShellToolsProvider;
  } catch (error) {
    throw MISSING_EXTENSION_ERROR.create({
      message:
        'Missing extension for contract "SandboxShellToolsProvider". Enable ext-sandbox-shell-tools or pass createBashTool explicitly.',
      detail:
        `Veryfront cloud agent sandbox shell tools require a SandboxShellToolsProvider implementation: ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  }
}

async function resolveNodeVeryfrontCloudAgentServiceOptions(
  options: NodeVeryfrontCloudAgentServiceOptions,
): Promise<ResolvedNodeVeryfrontCloudAgentServiceOptions> {
  await ensureDefaultSchemaValidator();
  await ensureDefaultAuthProvider();
  await ensureDefaultNodeTelemetryProvider();
  return {
    ...options,
    serviceName: resolveServiceName(options),
    createBashTool: options.createBashTool ?? await loadDefaultCreateBashTool(),
  };
}

async function ensureDefaultSchemaValidator(): Promise<void> {
  if (tryResolve<SchemaValidator>("SchemaValidator")) return;
  const { createZodAdapter } = await import("../../../extensions/ext-schema-zod/src/adapter.ts");
  register<SchemaValidator>("SchemaValidator", createZodAdapter());
}

async function ensureDefaultAuthProvider(): Promise<void> {
  if (tryResolve<AuthProvider>("AuthProvider")) return;
  const { createAuthProvider } = await import("../../../extensions/ext-auth-jwt/src/index.ts");
  register<AuthProvider>("AuthProvider", createAuthProvider({}));
}

async function ensureDefaultNodeTelemetryProvider(): Promise<void> {
  if (tryResolve<NodeTelemetryProvider>(NodeTelemetryProviderName)) return;
  const OpenTelemetryNodeTelemetryProvider = await importOpenTelemetryNodeTelemetryProvider();
  if (!OpenTelemetryNodeTelemetryProvider) return;
  register<NodeTelemetryProvider>(
    NodeTelemetryProviderName,
    new OpenTelemetryNodeTelemetryProvider(),
  );
}

async function importOpenTelemetryNodeTelemetryProvider() {
  try {
    const { OpenTelemetryNodeTelemetryProvider } = await import(
      "../../../extensions/ext-observability-opentelemetry/src/index.ts"
    );
    return OpenTelemetryNodeTelemetryProvider;
  } catch (error) {
    if (!isMissingOptionalPackageError(error)) throw error;
    return null;
  }
}

function isMissingOptionalPackageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("Module not found");
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
  return env();
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

  return {
    options,
    processTarget,
    projectDir: resolveProjectDir(options),
    infrastructure,
    trace,
    defaultAgentId: null as string | null,
    projectSteeringByAgentId: new Map<string, HostedAgentProjectSteering>(),
    tracker: createDetachedRunTracker<AgUiResumeValue>(),
    discoveryResult: null as DiscoveryResult | null,
    agentConfig: null as RuntimeAgentMarkdownDefinition | null,
    agentConfigs: new Map<string, RuntimeAgentMarkdownDefinition>(),
  };
}

function getMarkdownAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  agentId: string,
): RuntimeAgentMarkdownDefinition {
  return getProjectSteering(context, agentId).getAgentConfig();
}

function loadMarkdownAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  agentId: string,
): RuntimeAgentMarkdownDefinition {
  return getMarkdownAgentConfig(context, agentId);
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

  if (codeAgent && doesProjectAgentRuntimeAgentMatchSource(codeAgent, source)) {
    const agentConfig = await createRuntimeAgentDefinitionFromAgent(codeAgent);
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
  context.discoveryResult = await discoverProjectAgentRuntime({
    projectDir: context.projectDir,
    adapter: nodeAdapter,
  });
}

function resolveDefaultAgentId(context: NodeVeryfrontCloudAgentServiceContext): string {
  if (context.options.agentId) {
    return context.options.agentId;
  }

  const source = context.options.agentSource ?? "auto";
  const candidates = getProjectAgentRuntimeAgentIdCandidates(context.discoveryResult);
  const agentId = resolveSingleProjectAgentRuntimeAgentId({ candidates, source });

  if (agentId) {
    return agentId;
  }

  throw new Error(
    [
      "agentId is required when agent discovery does not resolve to exactly one agent.",
      `Discovered agents: ${describeProjectAgentRuntimeAgentIdCandidates(candidates)}.`,
    ].join(" "),
  );
}

async function initializeNodeVeryfrontCloudAgentServiceContext(
  context: NodeVeryfrontCloudAgentServiceContext,
): Promise<void> {
  await discoverProjectPrimitives(context);
  context.defaultAgentId = resolveDefaultAgentId(context);
  context.agentConfig = await resolveAgentConfig(context, context.defaultAgentId);
}

function getDefaultAgentId(context: NodeVeryfrontCloudAgentServiceContext): string {
  if (!context.defaultAgentId) {
    throw new Error("Agent service context has not been initialized.");
  }

  return context.defaultAgentId;
}

function getProjectSteering(
  context: NodeVeryfrontCloudAgentServiceContext,
  agentId: string = getDefaultAgentId(context),
): HostedAgentProjectSteering {
  const cachedProjectSteering = context.projectSteeringByAgentId.get(agentId);
  if (cachedProjectSteering) {
    return cachedProjectSteering;
  }

  const projectSteering = createHostedAgentProjectSteering({
    baseDir: resolveBaseDir(context.options),
    agentId,
    getApiUrl: () => context.infrastructure.getConfig().VERYFRONT_API_URL,
    logger: context.infrastructure.logger,
    trace: context.trace,
  });

  context.projectSteeringByAgentId.set(agentId, projectSteering);
  return projectSteering;
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
    return await getProjectSteering(context).getProjectInstructions(lookup);
  });
}

function getSkillsConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  lookup: RuntimeProjectSteeringLookup,
): Promise<RuntimeSkillDefinition[]> {
  return context.trace("chat.getSkillsConfig", async () => {
    return await getProjectSteering(context).getSkillsConfig(lookup);
  });
}

function createLoadSkillTool(
  context: NodeVeryfrontCloudAgentServiceContext,
  toolContext: RuntimeLoadSkillToolContext,
) {
  return getProjectSteering(context).createLoadSkillTool(toolContext);
}

async function refreshProjectSkillIds(
  context: NodeVeryfrontCloudAgentServiceContext,
  skillContext: HostedProjectSkillIdsContext,
): Promise<void> {
  await getProjectSteering(context).refreshProjectSkillIds(skillContext);
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
    createAgentServiceSandboxTools,
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
      studioMcpUrl: config.VERYFRONT_STUDIO_MCP_URL,
      mcpServers: resolveMcpServers(context.options),
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

function createHostedChatContextBudgetOptions(
  context: NodeVeryfrontCloudAgentServiceContext,
  req: ParsedHostedChatRequest,
  agentConfig: { model?: string },
  abortSignal: AbortSignal,
): HostedChatContextBudgetOptions | undefined {
  const config = context.infrastructure.getConfig();
  if (!config.VERYFRONT_CONTEXT_COMPACTION_ENABLED || !req.durableRootRun) {
    return undefined;
  }

  return {
    tokenBudget: config.VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET,
    reserveTokens: config.VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS,
    recentTailTokens: config.VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS,
    minimumRecentTurns: config.VERYFRONT_CONTEXT_COMPACTION_MINIMUM_RECENT_TURNS,
    maxSummaryTokens: config.VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
    summaryGenerator: createVeryfrontCloudContextSummaryGenerator({
      apiUrl: config.VERYFRONT_API_URL,
      authToken: req.authToken,
      projectId: req.projectId,
      model: config.VERYFRONT_CONTEXT_COMPACTION_SUMMARY_MODEL ?? agentConfig.model,
      maxOutputTokens: config.VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
      maxInputTokens: config.VERYFRONT_CONTEXT_COMPACTION_SUMMARY_INPUT_TOKENS,
      abortSignal,
    }),
    logger: {
      debug: (message, metadata) => context.infrastructure.logger.debug(message, metadata),
      error: (message, metadata) => context.infrastructure.logger.error(message, metadata),
    },
  };
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

  const agentConfig = await resolveAgentConfig(context, req.agentId ?? getDefaultAgentId(context));
  const abortController = new AbortController();
  const {
    effectiveMessages,
    rootRunContext,
    runtime: { agent, runtimeKind, modelId, cleanup },
    finalMessages,
  } = await prepareVeryfrontCloudHostedChatExecution({
    request: req,
    agentConfig,
    apiUrl: config.VERYFRONT_API_URL,
    abortSignal: abortController.signal,
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
    contextBudget: createHostedChatContextBudgetOptions(
      context,
      req,
      agentConfig,
      abortController.signal,
    ),
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

function resolveAgentServiceRuntimeName(): string {
  if (Reflect.get(globalThis, "Bun")) {
    return "bun";
  }
  if (Reflect.get(globalThis, "Deno")) {
    return "deno";
  }
  return "node";
}

function getAgentServiceVersion(
  context: NodeVeryfrontCloudAgentServiceContext,
): string | undefined {
  return context.options.env?.npm_package_version;
}

async function createControlPlaneRegistrationLifecycle(
  context: NodeVeryfrontCloudAgentServiceContext,
): Promise<AgentServiceServerLifecycle | undefined> {
  const config = context.infrastructure.getConfig();
  const registrationInput = await resolveAgentServiceRegistrationInput({
    config,
    serviceName: context.options.serviceName,
    agentId: getDefaultAgentId(context),
    version: getAgentServiceVersion(context),
    runtime: resolveAgentServiceRuntimeName(),
  });

  if (!registrationInput) {
    return undefined;
  }

  try {
    const lifecycle = await createAgentServiceRegistrationLifecycle({
      ...registrationInput,
      logger: context.infrastructure.logger,
    });
    return {
      stop: () => lifecycle.stop(),
    };
  } catch (error) {
    if (config.VERYFRONT_AGENT_SERVICE_REGISTRATION === "enabled") {
      throw error;
    }

    context.infrastructure.logger.warn("Agent service registration skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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

/** Create node Veryfront Cloud agent service runtime. */
export async function createNodeVeryfrontCloudAgentServiceRuntime(
  options: NodeVeryfrontCloudAgentServiceOptions = {},
): Promise<AgentServiceRuntimeBundle<NodeVeryfrontCloudAgentServicePreparedExecution>> {
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext(resolvedOptions);
  await initializeNodeVeryfrontCloudAgentServiceContext(context);
  return createAgentServiceRuntime(createNodeVeryfrontCloudAgentServiceRuntimeOptions(context));
}

/** Starts node Veryfront Cloud agent service. */
export async function startNodeVeryfrontCloudAgentService(
  options: NodeVeryfrontCloudAgentServiceOptions = {},
): Promise<StartNodeAgentServiceResult<NodeVeryfrontCloudAgentServicePreparedExecution>> {
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext(resolvedOptions);
  await initializeNodeVeryfrontCloudAgentServiceContext(context);
  const registrationLifecycle = await createControlPlaneRegistrationLifecycle(context);
  try {
    return await startNodeAgentService({
      ...createNodeVeryfrontCloudAgentServiceRuntimeOptions(context),
      lifecycle: registrationLifecycle,
      signals: options.signals,
      hardShutdownTimeoutMs: options.hardShutdownTimeoutMs ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS,
    });
  } catch (error) {
    await registrationLifecycle?.stop?.();
    throw error;
  }
}

/** Starts agent service. */
export async function startAgentService(
  options: NodeVeryfrontCloudAgentServiceOptions = {},
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
      const registrationLifecycle = await createControlPlaneRegistrationLifecycle(context);
      try {
        await startAgentServiceRuntime({
          ...createNodeVeryfrontCloudAgentServiceRuntimeOptions(context),
          lifecycle: registrationLifecycle,
          signals: options.signals,
          hardShutdownTimeoutMs: options.hardShutdownTimeoutMs ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS,
        });
      } catch (error) {
        await registrationLifecycle?.stop?.();
        throw error;
      }
    },
    onStartupError: (error) => {
      console.error("Error in server startup:", error);
    },
    exit: processTarget?.exit,
    processTarget,
  });
}
