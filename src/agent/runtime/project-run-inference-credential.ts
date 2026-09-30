import { AsyncLocalStorage } from "node:async_hooks";
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
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverCatalog,
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
/** Same bound as the ambient catalog warm-up, so a slow catalog never stalls a call longer. */
const CATALOG_LOAD_MAX_WAIT_MS = 3_000;

type ProjectRunInferenceScope = {
  readonly credential: string;
  /** Where the credential may be sent, fixed from host configuration at entry. */
  readonly apiBaseUrl: string;
  active: boolean;
};

/**
 * The inference origin, from the host's boot-time environment only (see
 * {@link resolveVeryfrontInferenceApiBaseUrlFromHostEnv}): neither the Veryfront
 * Cloud request context, a project `.env` file, nor a later `Deno.env.set`
 * can move it, and it receives the credential. Validated per execution, so a
 * bad host value fails the run rather than the import.
 */
function resolveTrustedInferenceApiBaseUrl(): string {
  const apiBaseUrl = resolveVeryfrontInferenceApiBaseUrlFromHostEnv();
  requireSecureInferenceApiBaseUrl(apiBaseUrl);
  return apiBaseUrl;
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
  // The served catalog as this credential sees it, from the trusted origin and
  // keyed exactly as the models this resolver builds key theirs, so the
  // default-model and served-model decisions and the call agree.
  const catalogScope = () => {
    const bootstrap = requireVeryfrontCloudBootstrap(readActiveCredential(), scope.apiBaseUrl);
    return {
      apiBaseUrl: bootstrap.apiBaseUrl,
      apiToken: bootstrap.apiToken,
      ...(bootstrap.projectSlug ? { projectSlug: bootstrap.projectSlug } : {}),
    };
  };
  registerModelRuntimeResolverCatalog(resolver, {
    async load() {
      await loadVeryfrontCloudCatalog({
        ...catalogScope(),
        fresh: true,
        maxWaitMs: CATALOG_LOAD_MAX_WAIT_MS,
        assertCredentialActive: () => void readActiveCredential(),
      });
    },
    read: (fn) => withVeryfrontCloudCatalogScope(catalogScope(), fn),
  });
  registerModelRuntimeResolverRevoker(resolver, () => {
    active = false;
  });
  return resolver;
}
