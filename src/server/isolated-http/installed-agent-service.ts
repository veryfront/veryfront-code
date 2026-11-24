import { requireSecureInferenceApiBaseUrl } from "#veryfront/provider/veryfront-cloud/shared.ts";
import { validateRemoteMcpEndpoint } from "#veryfront/tool/remote-mcp.ts";
import { createCanonicalCapabilitiesHandler } from "#veryfront/agent/service/canonical-capabilities.ts";
import {
  isHostedToolSelectionClosed,
  resolveHostedRuntimeRequestConfig,
} from "#veryfront/agent/hosted/runtime-request-config.ts";
import { extractLatestUserText } from "#veryfront/agent/artifacts/default-research-artifact-support.ts";
import {
  convertProviderMessagesToAgentRuntimeMessages,
} from "#veryfront/agent/runtime/message-adapter.ts";
import { convertRuntimeMessagesToProviderMessagesWithSource } from "#veryfront/agent/runtime/provider-history-source.ts";
import {
  createInstalledProjectAgentSessionResolver,
  type InstalledProjectAgentSessionOptions,
} from "./installed-agent-session.ts";
import { createCanonicalManagedBrokerService } from "#veryfront/agent/service/canonical-managed-service.ts";
import { createCanonicalBrokerAuthorizer } from "#veryfront/agent/service/canonical-broker-authorization.ts";
import { createTrustedManagedExecutorBroker } from "#veryfront/agent/service/trusted-managed-broker.ts";
import { prepareCanonicalBrokerModel } from "#veryfront/agent/service/canonical-model-policy.ts";
import { prepareCanonicalBrokerTools } from "#veryfront/agent/service/canonical-tool-policy.ts";
import type { HostedServiceAuth } from "#veryfront/agent/service/auth.ts";
import type { BrokerRuntimeAgentIngressOptions } from "#veryfront/agent/service/broker-ingress.ts";
import { getServerResolvedProjectToolNames } from "#veryfront/agent/runtime/server-resolved-project-tools.ts";
import { normalizeAgUiRuntimeMessages } from "#veryfront/agent/ag-ui/runtime-support.ts";
import { restoreTrustedHostedRuntimeHistory } from "#veryfront/agent/runtime/trusted-hosted-history.ts";
import { parseServerResolvedProviderReplayCheckpoints } from "#veryfront/agent/runtime/provider-replay.ts";
import { getServerResolvedToolExposureCheckpoint } from "#veryfront/agent/hosted/tool-exposure-checkpoint.ts";
import type { ManagedExecutorStartInput } from "#veryfront/agent/hosted/managed-executor-broker.ts";

type Authorization = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createCanonicalBrokerAuthorizer>>>
>;
type ServiceOptions = Parameters<typeof createCanonicalManagedBrokerService<Authorization>>[0];

function normalizeFixedApiBaseUrl(endpoint: string): string {
  requireSecureInferenceApiBaseUrl(endpoint);
  const url = new URL(endpoint);
  if (url.href.includes("?") || url.href.includes("#")) {
    throw new TypeError("Fixed API base URL cannot contain a query or fragment");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function validateFixedMcpEndpoint(endpoint: string): string {
  const normalized = validateRemoteMcpEndpoint(endpoint);
  // Fixed host destinations carry private authority and use the host egress policy.
  requireSecureInferenceApiBaseUrl(new URL(normalized).origin);
  return normalized;
}

/** Deployment composition for signed canonical runs over immutable installed project sources. */
export function createInstalledCanonicalAgentService(options: {
  source: InstalledProjectAgentSessionOptions;
  ingress: Pick<
    BrokerRuntimeAgentIngressOptions<Authorization>,
    "publicKeyPem" | "audience" | "projectId" | "expectedSurface" | "readTimeoutMs"
  >;
  auth: HostedServiceAuth;
  apiUrl: string;
  inferenceApiBaseUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string;
  modelLimits: Parameters<typeof prepareCanonicalBrokerModel>[0]["limits"];
  toolLimits: Parameters<typeof prepareCanonicalBrokerTools>[0]["limits"];
  maxActive: number;
  signal?: AbortSignal;
  fetch?: ServiceOptions["fetch"];
  resolveProvider: ServiceOptions["resolveProvider"];
  createRemoteToolSource?: Parameters<
    typeof prepareCanonicalBrokerTools
  >[0]["createRemoteToolSource"];
  onExecutionError?: ServiceOptions["onExecutionError"];
}) {
  for (
    const key of [
      "authenticateRequest",
      "verifyRunCancellationToken",
      "verifyRunResumeToken",
      "verifyJwt",
      "verifyRunEventAppendToken",
    ] as const
  ) {
    if (typeof options.auth[key] !== "function") {
      throw new TypeError("Installed agent authentication is incomplete");
    }
  }
  const verifyTerminal = options.auth.verifyRunTerminalToken;
  if (!verifyTerminal) throw new TypeError("Canonical terminal verification is required");
  if (
    !Number.isSafeInteger(options.maxActive) || options.maxActive < 1 || options.maxActive > 256
  ) throw new TypeError("Invalid installed agent capacity");
  const modelLimits = Object.freeze({ ...options.modelLimits });
  const toolLimits = Object.freeze({ ...options.toolLimits });
  if (
    Object.keys(modelLimits).length !== 4 ||
    (["maxCalls", "maxConcurrentCalls", "maxOutputTokens", "maxSteps"] as const).some((key) =>
      !Number.isSafeInteger(modelLimits[key]) || modelLimits[key] < 1
    ) ||
    modelLimits.maxConcurrentCalls > modelLimits.maxCalls ||
    !Number.isSafeInteger(toolLimits.maxCalls) || toolLimits.maxCalls < 1 ||
    toolLimits.maxCalls > 4096 || !Number.isSafeInteger(toolLimits.maxConcurrent) ||
    toolLimits.maxConcurrent < 1 || toolLimits.maxConcurrent > 32 ||
    toolLimits.maxConcurrent > toolLimits.maxCalls
  ) throw new TypeError("Invalid installed agent execution limits");
  const ingressOptions = Object.freeze({ ...options.ingress });
  const apiUrl = normalizeFixedApiBaseUrl(options.apiUrl);
  const inferenceApiBaseUrl = options.inferenceApiBaseUrl;
  requireSecureInferenceApiBaseUrl(inferenceApiBaseUrl);
  const apiMcpUrl = validateFixedMcpEndpoint(options.apiMcpUrl);
  const studioMcpUrl = options.studioMcpUrl === undefined
    ? undefined
    : validateFixedMcpEndpoint(options.studioMcpUrl);
  const createRemoteToolSource = options.createRemoteToolSource;
  const authorizeScope = createCanonicalBrokerAuthorizer({
    verifyJwt: options.auth.verifyJwt.bind(options.auth),
    verifyRunEventAppendToken: options.auth.verifyRunEventAppendToken.bind(options.auth),
    verifyRunTerminalToken: verifyTerminal.bind(options.auth),
  });
  const lifetime = new AbortController();
  const signal = AbortSignal.any([
    lifetime.signal,
    ...(options.signal ? [options.signal] : []),
    ...(options.source.ownerSignal ? [options.source.ownerSignal] : []),
  ]);
  const resolveSession = createInstalledProjectAgentSessionResolver({
    ...options.source,
    ownerSignal: signal,
  });
  const broker = createTrustedManagedExecutorBroker({ maxActive: options.maxActive, signal });
  const service = createCanonicalManagedBrokerService({
    auth: options.auth,
    broker,
    apiUrl,
    inferenceApiBaseUrl,
    fetch: options.fetch,
    signal,
    maxActiveRuns: options.maxActive,
    clock: options.source.clock,
    resolveProvider: options.resolveProvider,
    onExecutionError: options.onExecutionError,
    resolveIngressOptions: () => ({
      ...ingressOptions,
      expectedOwner: { scopeKind: "project", projectId: ingressOptions.projectId },
      boundSource: undefined,
      resolveBoundSource: resolveSession.resolveBoundSource,
      authorizeScope,
    }),
    async prepareExecutor({ ingress, signal: preparationSignal, apiTools }) {
      const run = ingress.executor.run;
      const checkpoint = getServerResolvedToolExposureCheckpoint(
        ingress.executor.input.forwardedProps,
        true,
      );
      if (
        Object.hasOwn(
          ingress.executor.input.forwardedProps ?? {},
          "serverResolvedToolExposureCheckpoint",
        ) && checkpoint === undefined
      ) throw new TypeError("Invalid canonical tool exposure checkpoint");
      const replay = ingress.executor.input.serverResolvedProviderReplayCheckpoints === undefined
        ? undefined
        : parseServerResolvedProviderReplayCheckpoints(
          ingress.executor.input.serverResolvedProviderReplayCheckpoints,
        );
      const normalized = normalizeAgUiRuntimeMessages(ingress.executor.input.messages);
      const runtimeMessages = convertProviderMessagesToAgentRuntimeMessages(
        convertRuntimeMessagesToProviderMessagesWithSource(normalized),
      );
      const messages = restoreTrustedHostedRuntimeHistory(
        runtimeMessages,
        ingress.executor.input.messages,
        ingress.executor.input.serverResolvedTrustedHostedHistoryMessageIds,
      );
      const agentSource = ingress.executor.agentSource;
      if (agentSource.type !== "release") {
        throw new TypeError("Installed canonical agents require release sources");
      }
      const session = resolveSession(ingress.executor, preparationSignal);
      const projectToolNames = [
        ...getServerResolvedProjectToolNames(ingress.executor.input.forwardedProps),
      ];
      const source = await broker.prepareSource({
        session,
        installation: {
          version: 1,
          mode: "project-tools",
          owner: ingress.executor.owner,
          source: agentSource,
          root: "project",
          ...(ingress.executor.agentEntrypoint === undefined
            ? {}
            : { agentEntrypoint: ingress.executor.agentEntrypoint }),
          context: {
            agentId: run.agentId,
            projectId: run.project.projectId,
            projectSlug: run.project.projectSlug,
            ...(run.project.runtimeTargetBranchId
              ? { branch: run.project.runtimeTargetBranchId }
              : {}),
            userId: run.requestedByUserId,
            runId: run.runId,
          },
          allowedToolNames: projectToolNames,
          maxCalls: toolLimits.maxCalls,
          maxConcurrent: toolLimits.maxConcurrent,
        },
      });
      const policyOwner = new AbortController();
      const executionSignal = AbortSignal.any([
        preparationSignal,
        source.signal,
        policyOwner.signal,
      ]);
      let model: Awaited<ReturnType<typeof prepareCanonicalBrokerModel>> | undefined;
      let tools: Awaited<ReturnType<typeof prepareCanonicalBrokerTools>> | undefined;
      let closing: Promise<void> | undefined;
      const cleanup = () =>
        closing ??= (async () => {
          policyOwner.abort();
          const results = await Promise.allSettled([
            Promise.resolve().then(() => model?.cleanup()),
            Promise.resolve().then(() => source.close()),
            source.settled,
            Promise.resolve().then(() => tools?.cleanup()),
          ]);
          const errors = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : []
          );
          if (
            results[1]?.status === "fulfilled" && results[1].value.release === "reaper-required"
          ) errors.push(new Error("Installed agent source requires reaping"));
          if (errors.length) {
            throw new AggregateError(errors, "Installed agent preparation cleanup failed");
          }
        })();
      try {
        const prepared = await source.runOwned(async () => {
          model = await prepareCanonicalBrokerModel({
            ingress,
            sourceDefinition: source.definition,
            apiBaseUrl: inferenceApiBaseUrl,
            signal: executionSignal,
            limits: modelLimits,
          });
          tools = await prepareCanonicalBrokerTools({
            ingress,
            sourceDefinition: source.definition,
            apiTools,
            apiMcpUrl,
            studioMcpUrl,
            signal: executionSignal,
            limits: toolLimits,
            createRemoteToolSource,
          });
          executionSignal.throwIfAborted();
          return { model, tools };
        });
        const invocationConfig = resolveHostedRuntimeRequestConfig({
          request: { forwardedProps: ingress.executor.input.forwardedProps },
          agentConfig: source.definition,
          resolveModelId: (modelId) => modelId,
        });
        const requestedToolNames = invocationConfig.effectiveRuntimeOverrides?.allowedTools;
        const deniedToolNames = new Set(source.definition.deniedTools ?? []);
        const callerToolNames = [...apiTools.allowedToolNames];
        const selectedCallerTools = isHostedToolSelectionClosed(
            source.definition.tools,
            requestedToolNames,
            source.definition.deniedTools,
          )
          ? []
          : callerToolNames.filter((name) =>
            !deniedToolNames.has(name) &&
            (requestedToolNames === undefined || requestedToolNames.includes(name))
          );
        const invocationToolNames = requestedToolNames === undefined ? undefined : [
          ...new Set([...(invocationConfig.requestedAllowedTools ?? []), ...selectedCallerTools]),
        ];
        const start: Omit<
          ManagedExecutorStartInput,
          "state" | "persistence" | "bindSessionOwnedWork"
        > = {
          preparedSource: source.capability,
          session,
          installation: {
            version: 1,
            owner: ingress.executor.owner,
            source: agentSource,
            root: "project",
            ...(ingress.executor.agentEntrypoint === undefined
              ? {}
              : { agentEntrypoint: ingress.executor.agentEntrypoint }),
            grant: {
              agentId: run.agentId,
              defaultModelId: prepared.model.modelId,
              maxSteps: prepared.model.maxSteps,
              models: [...prepared.model.model.grant.models].map(([id, policy]) => ({
                id,
                maxOutputTokens: policy.maxOutputTokens,
                providerToolNames: policy.providerTools.map((tool) => tool.name),
              })),
              allowedToolNames: [...prepared.tools.tools.catalog.keys()],
              hostToolFacadeIds: [],
              remoteToolSourceIds: ["project", ...prepared.tools.tools.sources.keys()],
              requiredCapabilities: ["project-steering", "conversation-user-text"],
              execution: {
                kind: "canonical",
                projectId: run.project.projectId,
                projectSlug: run.project.projectSlug,
                ...(run.project.runtimeTargetBranchId
                  ? { branchId: run.project.runtimeTargetBranchId }
                  : {}),
                userId: run.requestedByUserId,
                conversationId: run.conversationId,
                runId: run.runId,
                messageId: run.messageId,
                providerReplay: "required",
              },
            },
            capabilities: {
              persistence: {
                publishParentRunEvents: "canonical-parent-events",
                toolExposureCheckpoint: "canonical-tool-checkpoint",
                providerReplayCheckpoint: "canonical-provider-replay",
              },
              projectSteering: "canonical-project-steering",
              conversationUserText: "canonical-conversation-text",
            },
          },
          trustedRuntime: {
            projectToolNames,
            callerToolNames,
            sourceIntegrationPolicy: source.sourceIntegrationPolicy,
            // Keep source knowledge authority in the host, separate from run billing/persistence.
            hostedKnowledgeAuthToken: ingress.privateAuthority.sourceAuthToken ??
              ((ingress.executor.sourceProject ?? run.project).projectId === run.project.projectId
                ? ingress.privateAuthority.apiAuthToken
                : undefined),
            hostedKnowledgeApiUrl: apiUrl,
          },
          model: prepared.model.model,
          tools: prepared.tools.tools,
          prepare: {
            agentId: run.agentId,
            modelId: prepared.model.modelId,
            maxSteps: prepared.model.maxSteps,
            ...(prepared.model.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: prepared.model.maxOutputTokens }),
            ...(prepared.model.thinking === undefined ? {} : { thinking: prepared.model.thinking }),
            providerToolNames: prepared.model.providerToolNames,
            ...(invocationToolNames === undefined ? {} : { allowedToolNames: invocationToolNames }),
          },
        };
        const latestUserText = extractLatestUserText(ingress.executor.input.messages);
        return {
          start,
          messages,
          executionSignal,
          cleanup,
          latestConversationUserText: async (readSignal: AbortSignal) => {
            readSignal.throwIfAborted();
            return latestUserText;
          },
          initialCheckpoints: {
            initialToolExposureCheckpoint: checkpoint,
            initialProviderReplayCheckpoints: replay,
          },
        };
      } catch (error) {
        try {
          await cleanup();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Installed agent preparation failed");
        }
        throw error;
      }
    },
  });
  const capabilitySignal = AbortSignal.any([signal, broker.signal]);
  const capabilities = createCanonicalCapabilitiesHandler({
    ...ingressOptions,
    signal: capabilitySignal,
  });
  let closing: Promise<void> | undefined;
  return {
    capabilities,
    get ready() {
      return !capabilitySignal.aborted;
    },
    handle: service.handle,
    cancel: service.cancel,
    resume: service.resume,
    get active() {
      return service.active;
    },
    settled: broker.settled,
    close: () =>
      closing ??= (async () => {
        lifetime.abort();
        const results = await Promise.allSettled([
          service.close(),
          broker.shutdown(),
          broker.settled,
        ]);
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (
          results[1]?.status === "fulfilled" && results[1].value && "release" in results[1].value &&
          results[1].value.release === "reaper-required"
        ) errors.push(new Error("Installed agent service requires reaping"));
        if (errors.length) {
          throw new AggregateError(
            errors,
            "Installed agent service shutdown failed",
          );
        }
      })(),
  };
}
