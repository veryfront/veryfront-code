import { resolveRuntimeModel } from "./model-resolution.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
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
const ObjectCreate = Object.create;
const NativeWeakMap = WeakMap;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;
const unboundedScopeSignal = new AbortController().signal;

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
  readonly signal: AbortSignal;
  readonly expiresAtMs?: number;
  active: boolean;
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

interface RetainedAdmissionScope {
  readonly admit: ApplicationInferenceAdmissionCallback;
  readonly signal: AbortSignal;
  readonly expiresAtMs?: number;
}

const scopes = new AsyncLocalStorage<ApplicationInferenceScope>();
const runtimeAdmissions = new NativeWeakMap<
  PrivateApplicationInferenceRuntime,
  RetainedAdmissionScope
>();
const AsyncLocalStorageRun = AsyncLocalStorage.prototype.run;
const AsyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal ? IntrinsicReflectApply(AbortSignalAbortedGetter, signal, []) as boolean : false;
}

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
    const aborted = isAbortSignalAborted(scope.signal);
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
  const runtimeOptions: AgentRuntimeInternalOptions = {
    resolveModelRuntime: transport.resolver,
    onStreamCompletion(completion) {
      // Producer settlement also occurs after an in-band error. The AG-UI
      // relay observes the terminal event and selects the durable status.
      void chainPrivatePromise(completion, () => {}, () => finish("failed"));
    },
  };
  const runtime = ObjectCreate(null) as PrivateApplicationInferenceRuntime & {
    readonly then?: undefined;
  };
  defineOwnDataProperty(runtime, "runId", admission.runId, { enumerable: true });
  defineOwnDataProperty(runtime, "signal", controller.signal, { enumerable: true });
  defineOwnDataProperty(runtime, "runtimeOptions", runtimeOptions, { enumerable: true });
  defineOwnDataProperty(runtime, "finish", finish, { enumerable: true });
  defineOwnDataProperty(runtime, "onAbandon", () => finish("failed"), { enumerable: true });
  defineOwnDataProperty(runtime, "prepareAgent", transport.prepareAgent, { enumerable: true });
  defineOwnDataProperty(runtime, "then", undefined);
  return runtime;
}

function createApplicationInferenceScope(
  admissionScope: RetainedAdmissionScope,
  active = true,
): ApplicationInferenceScope & { readonly then?: undefined } {
  const scope = ObjectCreate(null) as ApplicationInferenceScope & { readonly then?: undefined };
  defineOwnDataProperty(scope, "admit", admissionScope.admit, { enumerable: true });
  defineOwnDataProperty(scope, "signal", admissionScope.signal, { enumerable: true });
  if (admissionScope.expiresAtMs !== undefined) {
    defineOwnDataProperty(scope, "expiresAtMs", admissionScope.expiresAtMs, { enumerable: true });
  }
  defineOwnDataProperty(scope, "active", active, { enumerable: true, writable: true });
  defineOwnDataProperty(scope, "then", undefined);
  return scope;
}

function isApplicationInferenceScopeActive(
  scope: ApplicationInferenceScope | undefined,
): scope is ApplicationInferenceScope {
  if (!scope?.active || isAbortSignalAborted(scope.signal)) return false;
  const expiresAtMs = scope.expiresAtMs;
  return expiresAtMs === undefined || (Number.isFinite(expiresAtMs) && expiresAtMs > DateNow());
}

export async function runWithApplicationInferenceAdmission<T>(
  admit: ApplicationInferenceAdmissionCallback,
  fn: () => Promise<T> | T,
  signal: AbortSignal = unboundedScopeSignal,
): Promise<T> {
  const scope = createApplicationInferenceScope({ admit, signal });
  try {
    return await (IntrinsicReflectApply(AsyncLocalStorageRun, scopes, [
      scope,
      fn,
    ]) as Promise<T>);
  } finally {
    scope.active = false;
  }
}

function createInactiveApplicationInferenceScope(): ApplicationInferenceScope {
  return createApplicationInferenceScope(
    {
      admit: () => Promise.reject(new TypeError("Application inference admission is inactive")),
      signal: unboundedScopeSignal,
    },
    false,
  );
}

export function runWithRetainedApplicationInferenceAdmission<T>(
  runtime: PrivateApplicationInferenceRuntime,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const admissionScope = IntrinsicReflectApply(WeakMapGet, runtimeAdmissions, [runtime]) as
    | RetainedAdmissionScope
    | undefined;
  let scope = createInactiveApplicationInferenceScope();
  if (admissionScope) {
    const candidate = createApplicationInferenceScope(admissionScope);
    if (isApplicationInferenceScopeActive(candidate)) scope = candidate;
  }
  return IntrinsicReflectApply(AsyncLocalStorageRun, scopes, [scope, fn]) as Promise<T> | T;
}

export function hasApplicationInferenceAdmission(): boolean {
  const scope = IntrinsicReflectApply(AsyncLocalStorageGetStore, scopes, []) as
    | ApplicationInferenceScope
    | undefined;
  return isApplicationInferenceScopeActive(scope);
}

function retainAdmissionForRuntime(
  runtime: PrivateApplicationInferenceRuntime,
  admit: ApplicationInferenceAdmissionCallback,
  expiresAtMs: number,
): void {
  IntrinsicReflectApply(WeakMapSet, runtimeAdmissions, [
    runtime,
    { admit, signal: runtime.signal, expiresAtMs },
  ]);
}

function closeLateAdmission(admission: ApplicationInferenceAdmission): void {
  try {
    const completion = admission.finalize("cancelled");
    if (completion) void chainPrivatePromise(completion, () => {}, () => {});
  } catch {
    // Reconciliation owns cleanup if the host finalizer cannot be reached.
  }
}

async function admitPrivateApplicationInferenceRuntime(
  admissionScope: ApplicationInferenceScope,
  agentId: string,
  signal: AbortSignal | undefined,
): Promise<PrivateApplicationInferenceRuntime | undefined> {
  if (
    !isApplicationInferenceScopeActive(admissionScope) || isAbortSignalAborted(signal)
  ) {
    return undefined;
  }
  return await chainPrivatePromise(admissionScope.admit(agentId), (admission) => {
    if (
      !isApplicationInferenceScopeActive(admissionScope) || isAbortSignalAborted(signal)
    ) {
      closeLateAdmission(admission);
      return undefined;
    }
    const runtime = createPrivateRuntime(admission);
    const runtimeExpiresAtMs = IntrinsicReflectApply(DateParse, Date, [
      admission.expiresAt,
    ]) as number;
    retainAdmissionForRuntime(runtime, admissionScope.admit, runtimeExpiresAtMs);
    if (signal) {
      const cancel = () => runtime.finish("cancelled");
      if (isAbortSignalAborted(signal)) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
    return runtime;
  });
}

export async function getPrivateApplicationInferenceRuntimeOptions(
  agentId: string,
  signal?: AbortSignal,
): Promise<PrivateApplicationInferenceRuntime | undefined> {
  const scope = IntrinsicReflectApply(AsyncLocalStorageGetStore, scopes, []) as
    | ApplicationInferenceScope
    | undefined;
  if (!isApplicationInferenceScopeActive(scope)) return undefined;
  return await admitPrivateApplicationInferenceRuntime(scope, agentId, signal);
}

export function shouldUseApplicationInferenceRuntime(model: string | undefined): boolean {
  if (!hasApplicationInferenceAdmission()) return false;
  if (model?.startsWith("veryfront-cloud/")) return true;
  const resolved = resolveRuntimeModel(model);
  return !resolved.includes("/") || resolved.startsWith("veryfront-cloud/");
}
