import { readCanonicalSourceDefinition } from "./canonical-source-definition.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { BrokerRuntimeAgentIngress } from "./broker-ingress.ts";
import { BrokerIngressError } from "./broker-ingress.ts";
import {
  loadVeryfrontCloudCatalog,
  veryfrontCloudCatalogScopeKey,
  withVeryfrontCloudCatalogScope,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { requireSecureInferenceApiBaseUrl } from "#veryfront/provider/veryfront-cloud/shared.ts";
import {
  isVeryfrontCloudAnthropicSurfaceModel,
  resolveVeryfrontCloudDefaultModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { createVeryfrontCloudInferenceModelResolver } from "../hosted/inference-credential.ts";
import { resolveHostedRuntimeRequestConfig } from "../hosted/runtime-request-config.ts";
import { convertToolsToRuntimeTools } from "../runtime/model-tool-converter.ts";
import {
  getExecutorModelOptionsSchema,
  parseExecutorModelData,
} from "../hosted/executor-model-schema.ts";
import { getExecutorModelAdditiveReasoningTokens } from "../hosted/executor-model-grant.ts";
import { createModelRuntimeResolverAbortGuard } from "../runtime/model-transport.ts";
import type { ManagedExecutorStartInput } from "../hosted/managed-executor-broker.ts";

/** Resolve model policy using the consuming run's catalog and private inference authority. */
export async function prepareCanonicalBrokerModel<T>(input: {
  ingress: BrokerRuntimeAgentIngress<T>;
  /** Definition read over the authenticated source channel; API structured metadata may be absent for code agents. */
  sourceDefinition: RuntimeAgentMarkdownDefinition;
  apiBaseUrl: string;
  signal: AbortSignal;
  /** Explicit deployment ceilings; this adapter does not grant an implicit quota. */
  limits: {
    maxCalls: number;
    maxConcurrentCalls: number;
    maxOutputTokens: number;
    maxSteps: number;
  };
}) {
  input.signal.throwIfAborted();
  const definition = readCanonicalSourceDefinition(input.ingress.executor, input.sourceDefinition);
  requireSecureInferenceApiBaseUrl(input.apiBaseUrl);
  const limits = { ...input.limits };
  if (
    Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    limits.maxConcurrentCalls > limits.maxCalls
  ) throw new TypeError("Invalid canonical model limits");
  const credential = input.ingress.privateAuthority.inferenceAuthToken;
  if (!credential) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  const scope = {
    apiBaseUrl: input.apiBaseUrl,
    apiToken: credential,
    projectSlug: input.ingress.executor.run.project.projectSlug,
  };
  const catalog = await loadVeryfrontCloudCatalog({
    ...scope,
    signal: input.signal,
    maxWaitMs: 3000,
    fresh: true,
    assertCredentialActive: () => input.signal.throwIfAborted(),
  });
  input.signal.throwIfAborted();
  if (!catalog) throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
  const scoped = <R>(work: () => R): R =>
    withVeryfrontCloudCatalogScope(veryfrontCloudCatalogScopeKey(scope), work);
  const config = scoped(() =>
    resolveHostedRuntimeRequestConfig({
      request: { forwardedProps: input.ingress.executor.input.forwardedProps },
      agentConfig: definition,
      resolveModelId: (model) => model,
      resolveModelThinking: resolveVeryfrontCloudModelThinking,
    })
  );
  const selected = config.requestedModel ?? catalog.defaultModelId ??
    scoped(resolveVeryfrontCloudDefaultModelId);
  const bare = selected.replace(/^veryfront-cloud\//, "");
  const matches = catalog.models.filter((row) =>
    [row.id, row.modelId, ...row.aliases].includes(bare)
  );
  if (matches.length !== 1) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  const row = matches[0]!;
  const modelId = `veryfront-cloud/${row.modelId}`;
  const output = Math.min(
    limits.maxOutputTokens,
    row.limit?.output ?? limits.maxOutputTokens,
  );
  const runtimeTools = scoped(() =>
    convertToolsToRuntimeTools([], {
      model: modelId,
      providerTools: config.requestedAllowedProviderTools,
    })
  );
  const toolData = Object.entries(runtimeTools ?? {}).map(([name, value]) => {
    const tool = value as { type?: unknown; id?: unknown; args?: unknown };
    return { type: tool.type, name, id: tool.id, args: tool.args };
  });
  const providerTools =
    parseExecutorModelData(getExecutorModelOptionsSchema(), { prompt: [], tools: toolData })
      .tools ?? [];
  const maxSteps = Math.min(limits.maxSteps, config.requestedMaxSteps ?? limits.maxSteps);
  if (
    !Number.isSafeInteger(output) || output < 1 || !Number.isSafeInteger(maxSteps) || maxSteps < 1
  ) throw new TypeError("Invalid canonical model budget");
  // The grant covers total provider output; preparation receives only the
  // answer allowance, leaving additive reasoning inside that same ceiling.
  const maxOutputTokens = scoped(() => {
    const thinking = config.requestedThinking ?? resolveVeryfrontCloudModelThinking(modelId);
    const reasoning = isVeryfrontCloudAnthropicSurfaceModel(modelId)
      ? getExecutorModelAdditiveReasoningTokens({
        model: { id: modelId, modelId, provider: "anthropic" },
        options: {
          reasoning: resolveVeryfrontCloudReasoningOption(modelId, thinking),
          providerOptions: resolveVeryfrontCloudThinkingProviderOptions(modelId, thinking),
        },
      })
      : 0;
    const available = output - reasoning;
    if (!Number.isSafeInteger(available) || available < 1) {
      throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
    }
    return config.requestedMaxOutputTokens === undefined
      ? undefined
      : Math.min(config.requestedMaxOutputTokens, available);
  });
  const resolver = createVeryfrontCloudInferenceModelResolver(credential, {
    apiBaseUrl: input.apiBaseUrl,
    projectSlug: scope.projectSlug,
    assertParentActive: () => input.signal.throwIfAborted(),
  });
  const guard = createModelRuntimeResolverAbortGuard(resolver, input.signal);
  const model: ManagedExecutorStartInput["model"] = {
    resolver: (id) => id === modelId ? resolver(id) : undefined,
    grant: {
      maxCalls: limits.maxCalls,
      maxConcurrentCalls: limits.maxConcurrentCalls,
      models: new Map([[modelId, {
        maxOutputTokens: output,
        providerTools: providerTools.filter((tool) => tool.type === "provider"),
      }]]),
    },
  };
  return {
    model,
    modelId,
    provider: row.provider,
    providerToolNames: providerTools.map((tool) => tool.name),
    maxSteps,
    maxOutputTokens,
    thinking: config.requestedThinking,
    cleanup: () => guard.dispose(),
  };
}
