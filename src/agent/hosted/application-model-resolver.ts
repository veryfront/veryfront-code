import { runWithoutRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { requireProviderCredential } from "#veryfront/provider/runtime-loader/provider-request-init.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import {
  runWithVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { createVeryfrontCloudModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverRevoker,
} from "../runtime/model-transport.ts";
import type { HostedExecutorModelScope } from "./executor-model-dispatch.ts";
import { executorModelIds } from "./executor-model-schema.ts";
import {
  type ApplicationModelCallScope,
  scopeApplicationModelStream,
} from "./application-model-stream.ts";

function gatewayBaseUrl(value: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new TypeError("Hosted application inference requires an explicit gateway URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Hosted application inference requires a valid gateway URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search ||
    url.hash
  ) {
    throw new TypeError("Hosted application inference requires a valid gateway URL");
  }
  return value;
}

function contextLabel(value: string | null | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 256 || !/^[\x21-\x7e]*$/.test(value)) {
    throw new TypeError("Hosted application inference context is invalid");
  }
  return value;
}

/**
 * Broker-owned ordinary application authority. Explicit endpoint/token scope
 * and an empty project label suppress ambient host/request identity fallbacks.
 * Construction and every provider/stream operation stay inside that scope.
 */
export function createHostedApplicationModelResolver(input: {
  authToken: string | undefined;
  apiBaseUrl: string;
  allowedModelIds: ReadonlySet<string>;
  scope: HostedExecutorModelScope;
  projectSlug?: string | null;
  billingGroupId?: string | null;
}): AgentModelRuntimeResolver {
  const apiToken = requireProviderCredential(input.authToken, "Hosted application token");
  const allowed = executorModelIds(input.allowedModelIds);
  const context: VeryfrontCloudContext = {
    apiBaseUrl: gatewayBaseUrl(input.apiBaseUrl),
    apiToken,
    projectSlug: contextLabel(input.projectSlug),
    billingGroupId: contextLabel(input.billingGroupId),
    serviceLayer: "cloud",
  };
  const scopeSignal = input.scope.signal;
  const assertScopeActive = input.scope.assertActive;
  if (!(scopeSignal instanceof AbortSignal) || typeof assertScopeActive !== "function") {
    throw new TypeError("Hosted application inference requires invocation authority");
  }
  const authority = new AbortController();
  const lifetime = AbortSignal.any([scopeSignal, authority.signal]);
  let revoked = false;
  const assertActive = () => {
    if (revoked) throw new TypeError("Hosted application model authority is revoked");
    assertScopeActive();
    lifetime.throwIfAborted();
  };
  const scoped = <T>(operation: () => T): T =>
    runWithoutRequestContext(() => runWithVeryfrontCloudContext(context, operation));
  const callScope = (signal?: AbortSignal): ApplicationModelCallScope => {
    assertActive();
    const controller = new AbortController();
    const sources = [...new Set([scopeSignal, authority.signal, ...(signal ? [signal] : [])])];
    const abort = () =>
      scoped(() => controller.abort(new Error("Hosted application inference cancelled")));
    for (const source of sources) source.addEventListener("abort", abort, { once: true });
    const dispose = () => {
      for (const source of sources) source.removeEventListener("abort", abort);
    };
    if (sources.some((source) => source.aborted)) abort();
    if (controller.signal.aborted) {
      dispose();
      controller.signal.throwIfAborted();
    }
    return { signal: controller.signal, dispose };
  };
  const run = async <T>(
    control: ApplicationModelCallScope,
    operation: (signal: AbortSignal) => T | PromiseLike<T>,
  ): Promise<T> => {
    try {
      assertActive();
      control.signal.throwIfAborted();
      const value = await scoped(() => operation(control.signal));
      assertActive();
      control.signal.throwIfAborted();
      return value;
    } finally {
      control.dispose();
    }
  };
  const models = new Map<string, ModelRuntime>();
  const resolver: AgentModelRuntimeResolver = (id) => {
    if (!id.startsWith("veryfront-cloud/")) return undefined;
    assertActive();
    if (!allowed.has(id)) throw new TypeError("Hosted application model is not allowed");
    const cached = models.get(id);
    if (cached) return cached;
    const model = scoped(() =>
      createVeryfrontCloudModel(id.slice("veryfront-cloud/".length), {
        credentialSource: "application",
        providerSelection: "first-party",
        assertCredentialActive: assertActive,
      })
    );
    const reconcile = model._reconcileProviderMetadata;
    const proxy: ModelRuntime<ModelRuntimeCallOptions> = Object.freeze({
      specificationVersion: model.specificationVersion,
      provider: model.provider,
      modelProvider: model.modelProvider,
      modelId: model.modelId,
      executionMode: model.executionMode,
      runtimeCapabilities: model.runtimeCapabilities,
      _generateViaStream: model._generateViaStream,
      async prepare(abortSignal?: AbortSignal) {
        await run(callScope(abortSignal), (signal) => model.prepare?.(signal));
      },
      async doGenerate(options: ModelRuntimeCallOptions) {
        return await run(
          callScope(options.abortSignal),
          (signal) => model.doGenerate({ ...options, abortSignal: signal }),
        );
      },
      async doStream(options: ModelRuntimeCallOptions) {
        const control = callScope(options.abortSignal);
        try {
          const result = await scoped(() =>
            model.doStream({ ...options, abortSignal: control.signal })
          );
          try {
            assertActive();
            control.signal.throwIfAborted();
          } catch (error) {
            await scoped(() => result.stream.cancel()).catch(() => {});
            throw error;
          }
          return {
            ...result,
            stream: scopeApplicationModelStream(result.stream, control, assertActive, scoped),
          };
        } catch (error) {
          control.dispose();
          throw error;
        }
      },
      ...(typeof reconcile === "function"
        ? {
          async _reconcileProviderMetadata(options: {
            providerMetadata: Record<string, unknown>;
            suppressedToolCalls: readonly { id: string; name: string }[];
            abortSignal?: AbortSignal;
          }) {
            return await run(callScope(options.abortSignal), (signal) =>
              reconcile.call(model, { ...options, abortSignal: signal }));
          },
        }
        : {}),
    });
    models.set(id, proxy);
    return proxy;
  };
  registerModelRuntimeResolverRevoker(resolver, () => {
    revoked = true;
    scoped(() => authority.abort());
  });
  return resolver;
}
