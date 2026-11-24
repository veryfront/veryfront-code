import {
  getForwardedHostedRuntimeOverrides,
  isHostedToolSelectionClosed,
} from "../hosted/runtime-request-config.ts";
import { readCanonicalSourceDefinition } from "./canonical-source-definition.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { BrokerRuntimeAgentIngress } from "./broker-ingress.ts";
import type { createCanonicalBrokerAuthorizer } from "./canonical-broker-authorization.ts";
import { createVerifiedPlatformToolDependencyRunner } from "./auth.ts";
import { createHostedProjectRemoteToolSources } from "../hosted/project-remote-tool-source.ts";
import { resolveRuntimeClientProfile } from "../runtime/client-profile.ts";
import { getServerResolvedProjectToolNames } from "../runtime/server-resolved-project-tools.ts";
import type { ExecutorToolCapability } from "../hosted/executor-tool-bridge.ts";
import { executorToolDefinition, executorToolLimits } from "../hosted/executor-tool-schema.ts";
import { disposeRemoteToolSources } from "#veryfront/tool/remote-tool-source-owner.ts";
import {
  hasTrustedPlatformSource,
  inheritTrustedPlatformSource,
} from "#veryfront/tool/platform-source-provenance.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import type { ManagedExecutorStartInput } from "../hosted/managed-executor-broker.ts";

type Authorization = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createCanonicalBrokerAuthorizer>>>
>;

/** Prepare authenticated remote capabilities; project code remains in the executor. */
export async function prepareCanonicalBrokerTools(input: {
  ingress: BrokerRuntimeAgentIngress<Authorization>;
  /** Definition read over the authenticated source channel, including configured first-party MCP presets. */
  sourceDefinition: RuntimeAgentMarkdownDefinition;
  apiTools: ExecutorToolCapability;
  apiMcpUrl: string;
  studioMcpUrl?: string;
  signal: AbortSignal;
  limits: { maxCalls: number; maxConcurrent: number };
  /** Trusted transport injection, never read from project metadata. */
  createRemoteToolSource?: Parameters<
    typeof createHostedProjectRemoteToolSources
  >[0]["createRemoteToolSource"];
}) {
  input.signal.throwIfAborted();
  const definition = readCanonicalSourceDefinition(input.ingress.executor, input.sourceDefinition);
  const { maxCalls, maxConcurrent } = input.limits;
  if (
    !Number.isSafeInteger(maxCalls) || maxCalls < 1 || !Number.isSafeInteger(maxConcurrent) ||
    maxConcurrent < 1 || maxConcurrent > maxCalls
  ) throw new TypeError("Invalid canonical tool limits");
  const run = input.ingress.executor.run;
  const identity = Object.freeze({
    agentId: run.agentId,
    runId: run.runId,
    projectId: run.project.projectId,
    userId: run.requestedByUserId,
    runIdBindsToolAuthorization: true,
  });
  for (
    const field of [
      "agentId",
      "runId",
      "projectId",
      "userId",
      "runIdBindsToolAuthorization",
    ] as const
  ) {
    if (input.apiTools.context[field] !== identity[field]) {
      throw new TypeError("Canonical API capability owner mismatch");
    }
  }
  const runner = createVerifiedPlatformToolDependencyRunner(
    input.ingress.privateAuthority.authorization.runEventWriter,
    identity,
  );
  const lifetime = new AbortController();
  const signal = AbortSignal.any([input.signal, lifetime.signal]);
  const context: ToolExecutionContext = {
    ...identity,
    authToken: input.ingress.privateAuthority.apiAuthToken,
    abortSignal: signal,
  };
  const pending = new Set<Promise<unknown>>();
  let raw: RemoteToolSource[] = [];
  let closing: Promise<void> | undefined;
  const cleanup = () => {
    if (closing) return closing;
    lifetime.abort();
    runner.revoke();
    closing = (async () => {
      await Promise.allSettled([...pending]);
      await disposeRemoteToolSources(raw, context);
    })();
    return closing;
  };
  const check = (requested?: ToolExecutionContext) => {
    signal.throwIfAborted();
    requested?.abortSignal?.throwIfAborted();
    for (
      const field of [
        "agentId",
        "runId",
        "projectId",
        "userId",
        "runIdBindsToolAuthorization",
      ] as const
    ) {
      if (requested?.[field] !== undefined && requested[field] !== identity[field]) {
        throw new TypeError("Canonical remote tool owner mismatch");
      }
    }
  };
  const retain = <T>(work: () => Promise<T>): Promise<T> => {
    const task = runner.run(work);
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  try {
    raw = isHostedToolSelectionClosed(
        definition.tools,
        getForwardedHostedRuntimeOverrides(input.ingress.executor.input.forwardedProps)
          ?.allowedTools,
      )
      ? []
      : createHostedProjectRemoteToolSources({
        authToken: input.ingress.privateAuthority.apiAuthToken,
        apiMcpUrl: input.apiMcpUrl,
        studioMcpUrl: input.studioMcpUrl,
        mcpServers: definition.mcpServers,
        clientProfile: resolveRuntimeClientProfile(input.ingress.executor.input.forwardedProps),
        getProjectId: () => identity.projectId,
        defaultProjectId: () => identity.projectId,
        conversationId: run.conversationId,
        createRemoteToolSource: input.createRemoteToolSource,
      });
    const limits = executorToolLimits();
    const projectToolNames = [
      ...getServerResolvedProjectToolNames(input.ingress.executor.input.forwardedProps),
    ];
    const catalog = new Map<string, { ownerAgentId?: string; shortName?: string }>(
      projectToolNames.map((name) => [name, {}]),
    );
    const sources = new Map<string, ExecutorToolCapability>();
    if (input.apiTools.allowedToolNames.size) {
      sources.set(input.apiTools.source.id, input.apiTools);
      for (const name of input.apiTools.allowedToolNames) {
        if (catalog.has(name)) throw new TypeError("Ambiguous canonical tool ownership");
        catalog.set(name, {});
      }
    }
    if (catalog.size > limits.maxTotalTools) {
      throw new TypeError("Canonical tool catalog exceeds its limit");
    }
    for (const source of raw) {
      check();
      if (sources.has(source.id) || source.id === "project") {
        throw new TypeError("Duplicate canonical remote source");
      }
      if (hasTrustedPlatformSource(source)) runner.captureSource(source);
      const definitions = await retain(() => source.listTools(context));
      check();
      if (definitions.length > limits.maxToolsPerSource) {
        throw new TypeError("Canonical remote catalog exceeds its limit");
      }
      const names = new Set<string>();
      for (const value of definitions) {
        const definition = executorToolDefinition(value, limits);
        if (input.apiTools.allowedToolNames.has(definition.name)) continue;
        if (names.has(definition.name) || catalog.has(definition.name)) {
          throw new TypeError("Ambiguous canonical tool ownership");
        }
        names.add(definition.name);
        catalog.set(definition.name, {});
      }
      if (catalog.size > limits.maxTotalTools) {
        throw new TypeError("Canonical tool catalog exceeds its limit");
      }
      const wrapper: RemoteToolSource = {
        id: source.id,
        async listTools(requested) {
          check(requested);
          const result = await retain(() =>
            source.listTools({
              ...requested,
              ...context,
              abortSignal: AbortSignal.any([
                signal,
                ...(requested?.abortSignal ? [requested.abortSignal] : []),
              ]),
            })
          );
          check(requested);
          return result.filter((tool) => names.has(tool.name));
        },
        async executeTool(name, args, requested) {
          check(requested);
          if (!names.has(name)) throw new TypeError("Canonical remote tool is not granted");
          const result = await retain(() =>
            source.executeTool(name, args, {
              ...requested,
              ...context,
              abortSignal: AbortSignal.any([
                signal,
                ...(requested?.abortSignal ? [requested.abortSignal] : []),
              ]),
            })
          );
          check(requested);
          return result;
        },
      };
      sources.set(source.id, {
        source: inheritTrustedPlatformSource(source, wrapper),
        allowedToolNames: names,
        context: identity,
      });
    }
    const tools: ManagedExecutorStartInput["tools"] = { catalog, sources, maxCalls, maxConcurrent };
    return { tools, projectToolNames, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Canonical tool preparation and cleanup failed",
      );
    }
    throw error;
  }
}
