import { AsyncLocalStorage } from "node:async_hooks";
import { chainPrivatePromise } from "#veryfront/security/private-promise.ts";
import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import {
  requireSecureInferenceApiBaseUrl,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import {
  loadVeryfrontCloudCatalog,
  withVeryfrontCloudCatalogScope,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveVeryfrontInferenceApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import type { AgentRuntimeInternalOptions } from "./index.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverCatalog,
  registerModelRuntimeResolverRevoker,
} from "./model-transport.ts";

const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";
const CATALOG_LOAD_MAX_WAIT_MS = 3_000;
const IntrinsicReflectApply = Reflect.apply;
const StringStartsWith = String.prototype.startsWith;
const StringSlice = String.prototype.slice;
const DateNow = Date.now;
const DateParse = Date.parse;
const NativeSetTimeout = globalThis.setTimeout;
const NativeClearTimeout = globalThis.clearTimeout;
const AbortControllerAbort = AbortController.prototype.abort;
const AbortSignalAbortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!
  .get!;

export type ApplicationInferenceFinalizeStatus = "completed" | "failed" | "cancelled";

export interface ApplicationInferenceAdmission {
  runId: string;
  inferenceToken: string;
  expiresAt: string;
  finalize: (status: ApplicationInferenceFinalizeStatus) => Promise<void> | void;
}

export type ApplicationInferenceAdmissionCallback = (
  agentId: string,
) => Promise<ApplicationInferenceAdmission>;

interface ApplicationInferenceScope {
  readonly admit: ApplicationInferenceAdmissionCallback;
}

export interface PrivateApplicationInferenceRuntime {
  runId: string;
  signal: AbortSignal;
  runtimeOptions: AgentRuntimeInternalOptions;
  finish: (status: ApplicationInferenceFinalizeStatus) => void;
  onAbandon: () => void;
  prepareAgent<T>(fn: () => T): Promise<T>;
}

interface RetainedCredentialScope {
  readonly credential: string;
  readonly apiBaseUrl: string;
  readonly signal: AbortSignal;
  active: boolean;
}

const scopes = new AsyncLocalStorage<ApplicationInferenceScope>();
const AsyncLocalStorageRun = AsyncLocalStorage.prototype.run;
const AsyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;

function resolveTrustedInferenceApiBaseUrl(): string {
  const apiBaseUrl = resolveVeryfrontInferenceApiBaseUrlFromHostEnv();
  requireSecureInferenceApiBaseUrl(apiBaseUrl);
  return apiBaseUrl;
}

function createRetainedResolver(input: {
  credential: string;
  expiresAt: string;
  signal: AbortSignal;
  expire: () => void;
}): {
  resolver: AgentModelRuntimeResolver;
  prepareAgent<T>(fn: () => T): Promise<T>;
} {
  const expiresAtMs = IntrinsicReflectApply(DateParse, Date, [input.expiresAt]) as number;
  const scope: RetainedCredentialScope = {
    credential: input.credential,
    apiBaseUrl: resolveTrustedInferenceApiBaseUrl(),
    signal: input.signal,
    active: true,
  };
  const readActiveCredential = (): string => {
    const aborted = IntrinsicReflectApply(AbortSignalAbortedGetter, scope.signal, []) as boolean;
    if (!scope.active || aborted || Number.isNaN(expiresAtMs) || expiresAtMs <= DateNow()) {
      input.expire();
      throw new TypeError("Application inference credential is no longer active");
    }
    return scope.credential;
  };
  const resolver: AgentModelRuntimeResolver = (modelId) => {
    if (!IntrinsicReflectApply(StringStartsWith, modelId, [VERYFRONT_CLOUD_MODEL_PREFIX])) {
      return undefined;
    }
    return createVeryfrontCloudInferenceModel(
      IntrinsicReflectApply(StringSlice, modelId, [VERYFRONT_CLOUD_MODEL_PREFIX.length]) as string,
      readActiveCredential(),
      {
        apiBaseUrl: scope.apiBaseUrl,
        assertInferenceCredentialActive() {
          readActiveCredential();
        },
      },
    );
  };
  const catalogScope = () => {
    const bootstrap = requireVeryfrontCloudBootstrap(readActiveCredential(), scope.apiBaseUrl);
    return {
      apiBaseUrl: bootstrap.apiBaseUrl,
      apiToken: bootstrap.apiToken,
      ...(bootstrap.projectSlug ? { projectSlug: bootstrap.projectSlug } : {}),
    };
  };
  const catalog = {
    async load() {
      await loadVeryfrontCloudCatalog({
        ...catalogScope(),
        fresh: true,
        maxWaitMs: CATALOG_LOAD_MAX_WAIT_MS,
        assertCredentialActive: () => {
          readActiveCredential();
        },
      });
    },
    read: <T>(fn: () => T): T => withVeryfrontCloudCatalogScope(catalogScope(), fn),
  };
  registerModelRuntimeResolverCatalog(resolver, catalog);
  registerModelRuntimeResolverRevoker(resolver, () => {
    scope.active = false;
  });
  return {
    resolver,
    async prepareAgent(fn) {
      await catalog.load();
      return catalog.read(fn);
    },
  };
}

function createPrivateRuntime(
  admission: ApplicationInferenceAdmission,
): PrivateApplicationInferenceRuntime {
  const controller = new AbortController();
  let finalized = false;
  let closed = false;
  const expiresAtMs = IntrinsicReflectApply(DateParse, Date, [admission.expiresAt]) as number;
  const close = () => {
    if (closed) return;
    closed = true;
    IntrinsicReflectApply(AbortControllerAbort, controller, [
      new DOMException("Application inference credential expired", "TimeoutError"),
    ]);
  };
  const timer = NativeSetTimeout(
    () => finish("cancelled"),
    Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - DateNow()) : 0,
  );
  const finish = (status: ApplicationInferenceFinalizeStatus) => {
    if (finalized) return;
    finalized = true;
    NativeClearTimeout(timer);
    close();
    try {
      const completion = admission.finalize(status);
      if (completion) void chainPrivatePromise(completion, () => {}, () => {});
    } catch {
      // Reconciliation owns cleanup if the host finalizer cannot be reached.
    }
  };
  const transport = createRetainedResolver({
    credential: admission.inferenceToken,
    expiresAt: admission.expiresAt,
    signal: controller.signal,
    expire: close,
  });
  return {
    runId: admission.runId,
    signal: controller.signal,
    runtimeOptions: {
      resolveModelRuntime: transport.resolver,
      onStreamCompletion(completion) {
        // Producer settlement also occurs after an in-band error. The AG-UI
        // relay observes the terminal event and selects the durable status.
        void chainPrivatePromise(completion, () => {}, () => finish("failed"));
      },
    },
    finish,
    onAbandon: () => finish("failed"),
    prepareAgent: transport.prepareAgent,
  };
}

export async function runWithApplicationInferenceAdmission<T>(
  admit: ApplicationInferenceAdmissionCallback,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await (IntrinsicReflectApply(AsyncLocalStorageRun, scopes, [
    { admit },
    fn,
  ]) as Promise<T>);
}

export function hasApplicationInferenceAdmission(): boolean {
  return IntrinsicReflectApply(AsyncLocalStorageGetStore, scopes, []) !== undefined;
}

export async function getPrivateApplicationInferenceRuntimeOptions(
  agentId: string,
  signal?: AbortSignal,
): Promise<PrivateApplicationInferenceRuntime | undefined> {
  const scope = IntrinsicReflectApply(AsyncLocalStorageGetStore, scopes, []) as
    | ApplicationInferenceScope
    | undefined;
  if (!scope) return undefined;
  return await chainPrivatePromise(scope.admit(agentId), (admission) => {
    const runtime = createPrivateRuntime(admission);
    if (signal) {
      const cancel = () => runtime.finish("cancelled");
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
    return runtime;
  });
}
