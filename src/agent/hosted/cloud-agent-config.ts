/** Agent-config resolution, context creation, and project-steering accessor for the cloud agent service. */
import { AGENT_NOT_FOUND, CONFIG_INVALID, INITIALIZATION_ERROR } from "#veryfront/errors";
import { createNodeAgentServiceRuntimeInfrastructure } from "../service/node-runtime-infrastructure.ts";
import { createDetachedRunTracker } from "../service/detached-run-tracker.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import {
  createHostedAgentProjectSteering,
  type HostedAgentProjectSteering,
} from "./agent-project-steering.ts";
import {
  createRuntimeAgentDefinitionFromAgent,
  describeProjectAgentRuntimeAgentIdCandidates,
  discoverProjectAgentRuntime,
  doesProjectAgentRuntimeAgentMatchSource,
  getProjectAgentRuntimeAgentIdCandidates,
  type ProjectAgentRuntimeDiscovery,
  resolveSingleProjectAgentRuntimeAgentId,
} from "../project/agent-runtime.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import { nodeAdapter } from "../../platform/adapters/node.ts";
import type { ResolvedNodeVeryfrontCloudAgentServiceOptions } from "./cloud-agent-provider-bootstrap.ts";
import {
  resolveBaseDir,
  resolveDefaultProcessTarget,
  resolveProjectDir,
} from "./cloud-agent-paths.ts";
import { resolveEnvironment } from "./cloud-agent-paths.ts";

/**
 * Full runtime context for a running cloud agent service instance.
 * Typed as the return of its creator so accessors can use the inferred shape.
 */
export type NodeVeryfrontCloudAgentServiceContext = ReturnType<
  typeof createNodeVeryfrontCloudAgentServiceContext
>;

/** Creates the shared runtime context for a cloud agent service instance. */
export function createNodeVeryfrontCloudAgentServiceContext(
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
    discoveryResult: null as ProjectAgentRuntimeDiscovery | null,
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

/** Resolves and caches the agent config for the given agent id. */
export async function resolveAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
  agentId: string,
): Promise<RuntimeAgentMarkdownDefinition> {
  const cachedAgentConfig = context.agentConfigs.get(agentId);
  if (cachedAgentConfig) {
    return cachedAgentConfig;
  }

  const source = context.options.agentSource ?? "auto";
  const codeAgent = getProjectAgentRuntime(context).agents.get(agentId);

  if (codeAgent && doesProjectAgentRuntimeAgentMatchSource(codeAgent, source)) {
    const agentConfig = await createRuntimeAgentDefinitionFromAgent(codeAgent);
    context.agentConfigs.set(agentConfig.id, agentConfig);
    return agentConfig;
  }

  if (source === "code") {
    throw AGENT_NOT_FOUND.create({ detail: `Code agent "${agentId}" was not discovered.` });
  }

  const agentConfig = loadMarkdownAgentConfig(context, agentId);
  context.agentConfigs.set(agentConfig.id, agentConfig);
  return agentConfig;
}

/** Returns the resolved agent config, throwing if the context has not been initialized. */
export function getResolvedAgentConfig(
  context: NodeVeryfrontCloudAgentServiceContext,
): RuntimeAgentMarkdownDefinition {
  if (!context.agentConfig) {
    throw INITIALIZATION_ERROR.create({
      detail: "Agent service context has not been initialized.",
    });
  }
  return context.agentConfig;
}

/** Returns the discovered project agent runtime, throwing if not yet initialized. */
export function getProjectAgentRuntime(
  context: NodeVeryfrontCloudAgentServiceContext,
): ProjectAgentRuntimeDiscovery {
  if (!context.discoveryResult) {
    throw new Error("Agent service context has not been initialized.");
  }
  return context.discoveryResult;
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

  throw CONFIG_INVALID.create({
    detail: [
      "agentId is required when agent discovery does not resolve to exactly one agent.",
      `Discovered agents: ${describeProjectAgentRuntimeAgentIdCandidates(candidates)}.`,
    ].join(" "),
  });
}

/** Discovers project primitives and resolves the default agent id and config. */
export async function initializeNodeVeryfrontCloudAgentServiceContext(
  context: NodeVeryfrontCloudAgentServiceContext,
): Promise<void> {
  await discoverProjectPrimitives(context);
  context.defaultAgentId = resolveDefaultAgentId(context);
  context.agentConfig = await resolveAgentConfig(context, context.defaultAgentId);
}

/** Returns the default agent id, throwing if the context has not been initialized. */
export function getDefaultAgentId(context: NodeVeryfrontCloudAgentServiceContext): string {
  if (!context.defaultAgentId) {
    throw INITIALIZATION_ERROR.create({
      detail: "Agent service context has not been initialized.",
    });
  }

  return context.defaultAgentId;
}

/** Returns (and caches) the project steering object for the given agent id. */
export function getProjectSteering(
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
