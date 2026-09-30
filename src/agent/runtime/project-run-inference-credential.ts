import { AsyncLocalStorage } from "node:async_hooks";
import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import { requireSecureInferenceApiBaseUrl } from "#veryfront/provider/veryfront-cloud/shared.ts";
import { normalizeVeryfrontApiBaseUrl } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process/env.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverRevoker,
} from "./model-transport.ts";

/**
 * Header a control-plane project-run execute request (task, workflow, eval)
 * carries its gateway-only inference credential in. It rides beside the
 * run's `x-token` API credential, which stays in use for every other call.
 */
export const PROJECT_RUN_INFERENCE_TOKEN_HEADER = "X-Veryfront-Inference-Token";

const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";
const IntrinsicReflectApply = Reflect.apply;
const StringStartsWith = String.prototype.startsWith;
const StringSlice = String.prototype.slice;

type ProjectRunInferenceScope = {
  readonly credential: string;
  /** Where the credential may be sent, fixed from host configuration at entry. */
  readonly apiBaseUrl: string;
  active: boolean;
};

const DEFAULT_INFERENCE_API_BASE_URL = "https://api.veryfront.com";

/**
 * The inference origin, read once when the framework loads this module, before
 * any project module runs. It is never re-read: project code can change the
 * live process environment (`Deno.env.set`), the Veryfront Cloud request
 * context and its `.env` file, and the origin chosen here receives the
 * credential. Values that came from a project `.env` file are excluded.
 */
const HOST_INFERENCE_API_BASE_URL: string = (() => {
  const fromHost = (key: string) => normalizeVeryfrontApiBaseUrl(getHostEnvExcludingEnvFile(key));
  return fromHost("VERYFRONT_PUBLIC_API_BASE_URL") ?? fromHost("VERYFRONT_API_URL") ??
    fromHost("VERYFRONT_API_BASE_URL") ?? DEFAULT_INFERENCE_API_BASE_URL;
})();

/** The load-time origin, validated where it is used so a bad value fails the run, not the import. */
function resolveTrustedInferenceApiBaseUrl(): string {
  requireSecureInferenceApiBaseUrl(HOST_INFERENCE_API_BASE_URL);
  return HOST_INFERENCE_API_BASE_URL;
}

// Module-private: the credential is reachable only through the resolvers this
// module builds, never through a getter project code could call. The storage
// methods are captured at load so a project that replaces
// `AsyncLocalStorage.prototype.run` or `.getStore` cannot observe the scope.
const projectRunInferenceScopes = new AsyncLocalStorage<ProjectRunInferenceScope>();
const AsyncLocalStorageRun = AsyncLocalStorage.prototype.run;
const AsyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;

/**
 * @internal Run a project-run execution with its signed inference credential in
 * scope. Agents called anywhere inside `fn` resolve `veryfront-cloud/*` models
 * with that credential over first-party transports, exactly as a hosted run's
 * `credentials.inferenceAuthToken` does. The scope, and every model resolved
 * in it, stops working once `fn` settles: no new request, catalog load or
 * retry sends the credential after that. A response stream whose request was
 * already sent inside the scope may finish; it carries no further credential.
 */
export async function runWithProjectRunInferenceCredential<T>(
  credential: string,
  fn: () => Promise<T>,
): Promise<T> {
  const scope: ProjectRunInferenceScope = {
    credential,
    apiBaseUrl: resolveTrustedInferenceApiBaseUrl(),
    active: true,
  };
  try {
    return await (IntrinsicReflectApply(AsyncLocalStorageRun, projectRunInferenceScopes, [
      scope,
      fn,
    ]) as Promise<T>);
  } finally {
    scope.active = false;
  }
}

/**
 * @internal A single-call model resolver for the project-run inference
 * credential in scope, or `undefined` outside one. The caller owns it like any
 * private resolver: it is consumed by one call and revoked when that call ends.
 */
export function createProjectRunInferenceModelResolver(): AgentModelRuntimeResolver | undefined {
  const scope = IntrinsicReflectApply(AsyncLocalStorageGetStore, projectRunInferenceScopes, []) as
    | ProjectRunInferenceScope
    | undefined;
  if (!scope?.active) return undefined;

  let active = true;
  // The only read of the credential. It throws once this resolver is revoked or
  // the execution has settled, and the provider calls it (as its activity
  // check) before every step that can send the credential.
  const readActiveCredential = (): string => {
    if (!active || !scope.active) {
      throw new TypeError("Project run inference credential is no longer active");
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
  registerModelRuntimeResolverRevoker(resolver, () => {
    active = false;
  });
  return resolver;
}
