import { AsyncLocalStorage } from "node:async_hooks";
import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
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
  active: boolean;
};

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
 * in it, stops working once `fn` settles.
 */
export async function runWithProjectRunInferenceCredential<T>(
  credential: string,
  fn: () => Promise<T>,
): Promise<T> {
  const scope: ProjectRunInferenceScope = { credential, active: true };
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
  const resolver: AgentModelRuntimeResolver = (modelId) => {
    if (!IntrinsicReflectApply(StringStartsWith, modelId, [VERYFRONT_CLOUD_MODEL_PREFIX])) {
      return undefined;
    }

    return createVeryfrontCloudInferenceModel(
      IntrinsicReflectApply(StringSlice, modelId, [VERYFRONT_CLOUD_MODEL_PREFIX.length]) as string,
      scope.credential,
      {
        assertInferenceCredentialActive() {
          if (!active || !scope.active) {
            throw new TypeError("Project run inference credential is no longer active");
          }
        },
      },
    );
  };
  registerModelRuntimeResolverRevoker(resolver, () => {
    active = false;
  });
  return resolver;
}
