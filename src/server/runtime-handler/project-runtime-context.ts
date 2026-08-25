import { getBaseLogger } from "#veryfront/utils";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import type { SecurityConfig } from "#veryfront/types";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import { getDerivedCspOrigins } from "#veryfront/security/http/derived-csp-cache.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/index.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { createRequestContext } from "../context/request-context.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { isProxyTrusted } from "../utils/proxy-trust.ts";
import { getEffectiveRequestHost, getEffectiveRequestOrigin } from "../utils/request-host.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { resolveEnvironment } from "./environment-resolution.ts";
import { buildHandlerContext } from "./handler-context-builder.ts";
import { extractRequestHeaders, resolveProject } from "./project-resolution.ts";
import { shouldSkipEnrichedContext } from "./request-utils.ts";

const logger = getBaseLogger("SERVER").component("project-runtime-context");

type ProxyTrustVerifier = (req: Request) => Promise<boolean>;

export interface PrepareProjectRequestInput {
  req: Request;
  url: URL;
  isProxyMode: boolean;
  trustProxy?: ProxyTrustVerifier;
}

type ProjectRequestHeaders = ReturnType<typeof extractRequestHeaders>;
type ProjectRequestContext = ReturnType<typeof createRequestContext>;
type ProjectIdentityResolution = Awaited<ReturnType<typeof resolveProject>>;
type ProjectAdapterResolution = Awaited<ReturnType<typeof resolveAdapter>>;
type ProjectEnvironmentResolution = ReturnType<typeof resolveEnvironment>;
type SourceIntegrationPolicy = ReturnType<typeof normalizeSourceIntegrationPolicy>;

type ProjectEnvVarCacheLike = {
  get(scope: {
    environmentId: string;
    token: string;
    projectSlug: string;
    projectId?: string;
  }): Promise<Record<string, string>>;
};

type RuntimeContextProfiler = <T>(operation: () => Promise<T>) => Promise<T>;

export interface PreparedProjectRequest {
  url: URL;
  headers: ProjectRequestHeaders;
  requestContext: ProjectRequestContext;
  proxyTrust: {
    proxyTrusted: boolean | undefined;
    identityHeadersTrusted: boolean;
  };
  loggerFacts: RequestContextFacts;
  trackingFacts: RequestTrackingFacts;
  proxyGuard?: ProxyGuardResult;
}

export interface ResolveProjectIdentityInput {
  operation?: string;
  req: Request;
  url: URL;
  headers: ProjectRequestHeaders;
  requestContext: ProjectRequestContext;
  config: VeryfrontConfig | undefined;
  defaultProjectSlug: string | undefined;
  defaultProjectId: string | undefined;
  defaultReleaseId: string | undefined;
  wsSlugOverride: string | undefined;
  proxyTrust: {
    proxyTrusted: boolean | undefined;
  };
}

export interface ResolveProjectRuntimeContextInput {
  req: Request;
  url: URL;
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig | undefined;
  projectIdentity: ProjectIdentityResolution;
  headers: ProjectRequestHeaders;
  requestContext: ProjectRequestContext;
  isProxyMode: boolean;
  /** Host-owned capability for dedicated single-project runtime execution. */
  allowHostProjectCodeExecution?: boolean;
  proxyTrust: {
    proxyTrusted: boolean | undefined;
  };
  securityConfig: SecurityConfig | null;
  debug: boolean | undefined;
  routeRegistry: RouteRegistry;
  moduleServerUrl: string | undefined;
  environmentId?: string;
  defaultEnvironment?: "preview" | "production";
  skipEnrichedContext?: boolean;
  envVarCache: ProjectEnvVarCacheLike;
  profileAdapter?: RuntimeContextProfiler;
  profileEnvVars?: RuntimeContextProfiler;
  onEnvironmentResolved?: (environment: ProjectEnvironmentResolution) => void;
  logDebug?: (message: string, extra?: Record<string, unknown>) => void;
}

export interface ProjectRuntimeContextResolution {
  adapter: ProjectAdapterResolution;
  environment: ProjectEnvironmentResolution;
  handlerContext: HandlerContext | undefined;
  rawEnvVars: Record<string, string>;
  sourceIntegrationPolicy: SourceIntegrationPolicy;
}

interface RequestContextFacts {
  domain: string;
  projectSlug: string | undefined;
  projectId: string | undefined;
  releaseId: string | undefined;
  branchId: string | undefined;
  branchName: string | undefined;
  defaultBranchName: string | undefined;
  pathname: string;
}

interface RequestTrackingFacts {
  projectSlug: string | undefined;
  pathname: string;
  method: string;
  environment: string | undefined;
  releaseId: string | undefined;
}

interface ProxyGuardResult {
  detail: string;
  response: Response;
}

export async function prepareProjectRequest(
  input: PrepareProjectRequestInput,
): Promise<PreparedProjectRequest> {
  const { req, url, isProxyMode } = input;
  const proxyTrusted = isProxyMode ? await (input.trustProxy ?? isProxyTrusted)(req) : undefined;
  // In shared mode, only the same operator-owned proxy decision that admits
  // the request may authorize canonical cache and secret-fetch identity.
  // Standalone runtimes retain their existing direct-header contract.
  const identityHeadersTrusted = !isProxyMode || proxyTrusted === true;
  const headers = extractRequestHeaders(req, url, proxyTrusted, identityHeadersTrusted);
  const requestContext = createRequestContext(req, {
    proxyTrusted,
    allowHostTokenFallback: !isProxyMode,
  });

  const hostHeader = req.headers.get("host") ?? url.host;
  const domain = hostHeader.replace(/:\d+$/, "");

  return {
    url,
    headers,
    requestContext,
    proxyTrust: { proxyTrusted, identityHeadersTrusted },
    loggerFacts: {
      domain,
      projectSlug: headers.projectSlug,
      projectId: headers.projectId,
      releaseId: headers.releaseId,
      branchId: headers.branchId,
      branchName: headers.branchName,
      defaultBranchName: headers.defaultBranchName,
      pathname: url.pathname,
    },
    trackingFacts: {
      projectSlug: headers.projectSlug,
      pathname: url.pathname,
      method: req.method,
      environment: headers.environment,
      releaseId: headers.releaseId,
    },
    proxyGuard: createProxyGuard(
      req,
      isProxyMode,
      headers,
      proxyTrusted,
      identityHeadersTrusted,
    ),
  };
}

export async function resolveProjectIdentity(
  input: ResolveProjectIdentityInput,
): Promise<ProjectIdentityResolution> {
  if (input.operation && input.operation !== "identity") {
    throw new Error(`Unsupported project runtime context operation: ${input.operation}`);
  }

  return await resolveProject(input.req, input.url, input.headers, {
    config: input.config,
    reqCtx: input.requestContext,
    defaultProjectSlug: input.defaultProjectSlug,
    defaultProjectId: input.defaultProjectId,
    defaultReleaseId: input.defaultReleaseId,
    wsSlugOverride: input.wsSlugOverride,
    proxyTrusted: input.proxyTrust.proxyTrusted,
  });
}

export async function resolveProjectRuntimeContext(
  input: ResolveProjectRuntimeContextInput,
): Promise<ProjectRuntimeContextResolution> {
  const projectRes = input.projectIdentity;
  const reqCtx = input.requestContext;
  const profileAdapter = input.profileAdapter ?? ((operation) => operation());
  const profileEnvVars = input.profileEnvVars ?? ((operation) => operation());

  type HostedConfigLoad = {
    readonly sourceContext: VirtualConfigSourceContext;
    readonly preparedContext: Awaited<ReturnType<typeof prepareDeclarativeConfigContext>>;
    readonly environment: Record<string, string>;
  };
  let hostedConfigLoadPromise: Promise<HostedConfigLoad> | undefined;
  const prepareHostedConfigContext = (isLocalProject: boolean): Promise<HostedConfigLoad> => {
    hostedConfigLoadPromise ??= (async () => {
      const productionMode = projectRes.proxyEnv === "production";
      const environmentName = productionMode ? projectRes.environmentName ?? "release" : "preview";
      const sourceContext: VirtualConfigSourceContext = productionMode
        ? {
          productionMode: true,
          releaseId: projectRes.releaseId ?? null,
          environmentName: projectRes.environmentName,
        }
        : {
          productionMode: false,
          branch: reqCtx.branch ?? projectRes.parsedDomain.branch ?? "main",
        };

      const environmentId = input.environmentId ?? input.headers.environmentId;
      const mayLoadEnvironment = !isLocalProject &&
        (!productionMode || projectRes.environmentName !== undefined);
      const environment = mayLoadEnvironment && environmentId && reqCtx.token &&
          projectRes.projectSlug
        ? await profileEnvVars(() =>
          input.envVarCache.get({
            environmentId,
            token: reqCtx.token!,
            projectSlug: projectRes.projectSlug!,
            projectId: projectRes.projectId,
          })
        )
        : {};

      return {
        sourceContext,
        preparedContext: await prepareDeclarativeConfigContext({
          environmentName,
          environment,
        }),
        environment,
      };
    })();
    return hostedConfigLoadPromise;
  };

  const adapterRes = await profileAdapter(() =>
    resolveAdapter({
      req: input.req,
      projectDir: input.projectDir,
      adapter: input.adapter,
      config: input.config,
      projectSlug: projectRes.projectSlug,
      projectId: projectRes.projectId,
      proxyToken: reqCtx.token,
      releaseId: projectRes.releaseId,
      proxyEnv: projectRes.proxyEnv,
      branch: reqCtx.branch,
      environmentName: projectRes.environmentName,
      parsedDomain: projectRes.parsedDomain,
      pathname: input.url.pathname,
      isProxyMode: input.isProxyMode,
      proxyTrusted: input.proxyTrust.proxyTrusted,
      ...(input.isProxyMode ? { prepareHostedConfigContext } : {}),
    })
  );

  const trustProxyHeaders = input.proxyTrust.proxyTrusted ??
    getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1";
  const host = getEffectiveRequestHost(
    input.req,
    input.url,
    trustProxyHeaders,
  );
  const requestOrigin = getEffectiveRequestOrigin(input.req, input.url, trustProxyHeaders);
  const envRes = resolveEnvironment({
    proxyEnv: projectRes.proxyEnv,
    reqCtxMode: reqCtx.mode,
    releaseId: projectRes.releaseId,
    projectSlug: projectRes.projectSlug,
    projectId: projectRes.projectId,
    environmentName: projectRes.environmentName,
    host,
    isLocalProject: adapterRes.isLocalProject,
    isProxyMode: input.isProxyMode,
    pathname: input.url.pathname,
    defaultEnvironment: input.defaultEnvironment,
  });
  input.onEnvironmentResolved?.(envRes);

  if (envRes.errorResponse) {
    return {
      adapter: adapterRes,
      environment: envRes,
      handlerContext: undefined,
      rawEnvVars: {},
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
    };
  }

  // The process-wide SecurityConfigLoader is valid only for a standalone
  // project. A shared proxy loads one authenticated, source-qualified config
  // snapshot per request above; derive security from that exact snapshot so a
  // tenant cannot inherit another tenant's auth/CORS/CSRF/CSP state. Keep the
  // deliberately config-less control-plane path config-less: those endpoints
  // authenticate their signed operation envelope and do not expose an
  // application/browser surface.
  // Origins the project's own source references, so a project that never wrote
  // a `security.csp` still loads its own images, video and fonts. Only passive
  // directives are derived; see security/http/derived-csp-origins.ts for why
  // script-src is not.
  //
  // Runs inside runWithContext, not after it. MultiProjectFSAdapter resolves
  // the tenant from AsyncLocalStorage, and outside that context it either
  // throws -- swallowed by getAllSourceFiles into an empty list that would then
  // be cached forever -- or falls back to a default adapter, which would derive
  // one project's origins from another's source.
  //
  // Derived for config-less projects too. Those are the ones this exists for:
  // a project with no veryfront.config.* is exactly the project that never
  // declared a policy, and gating on config would leave it on the bare floor.
  //
  // Excluded on the deferred path. Those control-plane endpoints authenticate a
  // signed operation envelope, expose no browser surface, and deliberately read
  // no outer source -- deriving there would both serve nothing and break that
  // guarantee.
  const derivedCsp = input.isProxyMode && projectRes.projectSlug && reqCtx.token &&
      adapterRes.configOutcome !== "deferred"
    ? await deriveProjectCspOrigins({
      adapter: adapterRes.adapter,
      projectSlug: projectRes.projectSlug,
      projectId: projectRes.projectId,
      token: reqCtx.token,
      releaseId: envRes.releaseId,
      // Same precedence as the hosted config source context above. If the two
      // disagree, derivation reads a different branch than the one that
      // produced the config, and the origins describe content other than the
      // page being served.
      branch: reqCtx.branch ?? projectRes.parsedDomain?.branch,
      environmentName: projectRes.environmentName,
    })
    : undefined;

  const requestSecurity = input.isProxyMode && adapterRes.config !== undefined
    ? deriveSecurityContext(adapterRes.config, {
      productionDefaults: envRes.resolvedEnvironment === "production",
      derivedCsp,
    })
    // A hosted project with no config file still gets its own security context
    // rather than the process-wide one: defaults plus whatever its source
    // implies. `deferred` control-plane requests keep the config-less shape.
    : input.isProxyMode && projectRes.projectSlug && adapterRes.configOutcome === "hosted-absent"
    ? deriveSecurityContext(undefined, {
      productionDefaults: envRes.resolvedEnvironment === "production",
      derivedCsp,
    })
    : undefined;

  // Falling back here substitutes the process-wide security config for the
  // project's, which serves a 200 whose CSP is the platform floor rather than
  // the project's policy. The response looks correct, so nothing downstream
  // can notice. Record it where the substitution happens, with the branch that
  // produced the absent config, so an intermittent config-resolution failure
  // is legible from logs instead of only from diffing served headers.
  //
  // `deferred` is excluded: those control-plane endpoints authenticate a
  // signed operation envelope and expose no browser surface, so a config-less
  // security context is their intended shape, not a degradation.
  if (
    input.isProxyMode && requestSecurity === undefined &&
    adapterRes.configOutcome !== "deferred"
  ) {
    logger.warn("No project config for this request; serving platform-default security headers", {
      projectSlug: projectRes.projectSlug,
      projectId: projectRes.projectId,
      configOutcome: adapterRes.configOutcome,
      releaseId: envRes.releaseId ?? null,
      branch: reqCtx.branch ?? null,
      environmentName: projectRes.environmentName ?? null,
      resolvedEnvironment: envRes.resolvedEnvironment ?? null,
      pathname: input.url.pathname,
    });
  }

  const handlerContext = buildHandlerContext({
    projectDir: adapterRes.projectDir,
    adapter: adapterRes.adapter,
    securityConfig: requestSecurity?.securityConfig ?? input.securityConfig,
    requestOrigin,
    debug: input.debug,
    config: adapterRes.config,
    parsedDomain: projectRes.parsedDomain,
    projectSlug: projectRes.projectSlug,
    projectId: projectRes.projectId,
    releaseId: envRes.releaseId,
    branchId: input.headers.branchId,
    branchName: input.headers.branchName,
    defaultBranchName: input.headers.defaultBranchName,
    proxyToken: reqCtx.token,
    environmentName: projectRes.environmentName,
    resolvedEnvironment: envRes.resolvedEnvironment ?? "preview",
    requestContext: reqCtx,
    routeRegistry: input.routeRegistry,
    isLocalProject: adapterRes.isLocalProject,
    allowHostProjectCodeExecution: input.allowHostProjectCodeExecution,
    isProxyMode: input.isProxyMode,
    moduleServerUrl: input.moduleServerUrl,
    environmentId: input.environmentId ?? input.headers.environmentId,
    skipEnrichedContext: input.skipEnrichedContext ?? shouldSkipEnrichedContext(input.url.pathname),
    // Handlers that load config themselves reuse this request's identity
    // instead of deriving their own.
    ...(input.isProxyMode
      ? {
        prepareHostedConfigContext: () => prepareHostedConfigContext(adapterRes.isLocalProject),
      }
      : {}),
  });

  let rawEnvVars: Record<string, string> = hostedConfigLoadPromise
    ? (await hostedConfigLoadPromise).environment
    : {};
  const environmentId = input.environmentId ?? input.headers.environmentId;
  if (
    !hostedConfigLoadPromise &&
    !adapterRes.isLocalProject &&
    environmentId &&
    reqCtx.token &&
    projectRes.projectSlug
  ) {
    const projectSlug = projectRes.projectSlug;
    rawEnvVars = await profileEnvVars(() =>
      input.envVarCache.get({
        environmentId,
        token: reqCtx.token,
        projectSlug,
        projectId: projectRes.projectId,
      })
    );

    input.logDebug?.("[runtime-handler] Project env vars fetched", {
      projectSlug,
      environmentId,
      count: Object.keys(rawEnvVars).length,
    });
  }

  const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy(
    adapterRes.config?.integrations,
  );

  return {
    adapter: adapterRes,
    environment: envRes,
    handlerContext,
    rawEnvVars,
    sourceIntegrationPolicy,
  };
}

function createProxyGuard(
  req: Request,
  isProxyMode: boolean,
  headers: ProjectRequestHeaders,
  proxyTrusted: boolean | undefined,
  identityHeadersTrusted: boolean,
): ProxyGuardResult | undefined {
  if (!isProxyMode) return undefined;

  const token = req.headers.get("x-token");
  const hasUntrustedIdentityHeaders = !identityHeadersTrusted &&
    (
      req.headers.has("x-project-id") ||
      req.headers.has("x-environment-id") ||
      req.headers.has("x-environment-name") ||
      req.headers.has("x-branch-id") ||
      req.headers.has("x-branch-name") ||
      req.headers.has("x-default-branch-name")
    );
  const hasIncompleteEnvironmentIdentity = identityHeadersTrusted &&
    Boolean(headers.environmentId) !== Boolean(headers.environmentName);
  const hasIncompleteBranchIdentity = identityHeadersTrusted &&
    Boolean(headers.branchId) !== Boolean(headers.branchName);
  const hasConflictingBranchIdentity = identityHeadersTrusted &&
    Boolean(headers.defaultBranchName) &&
    (Boolean(headers.branchId) || Boolean(headers.branchName));
  const body = hasUntrustedIdentityHeaders
    ? {
      error: "Untrusted identity context",
      detail:
        "project, environment, and branch identity headers require an operator-authenticated proxy boundary",
    }
    : !headers.projectSlug
    ? {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    }
    : !token
    ? {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    }
    : hasIncompleteEnvironmentIdentity
    ? {
      error: "Incomplete environment identity",
      detail: "x-environment-id and x-environment-name must be supplied together",
    }
    : hasIncompleteBranchIdentity || hasConflictingBranchIdentity
    ? {
      error: "Invalid branch identity",
      detail:
        "x-branch-id and x-branch-name must be supplied together and cannot be combined with x-default-branch-name",
    }
    : !proxyTrusted
    ? {
      error: "Untrusted proxy context",
      detail: "proxy mode requires an operator-trusted upstream proxy",
    }
    : undefined;

  if (!body) return undefined;

  return {
    detail: body.detail,
    response: new Response(JSON.stringify(body), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

/**
 * Derive a project's passive CSP origins inside its own adapter context.
 *
 * The source read and the snapshot identity are both taken under
 * `runWithContext`, because the multi-project adapter selects the tenant from
 * AsyncLocalStorage and silently yields nothing -- or the wrong project --
 * without it.
 */
/**
 * Derive a project's CSP origins from the source its release pins.
 *
 * Exported because this seam had no test at all: the extractor was covered and
 * the header merge was covered, but nothing exercised the part that actually
 * reads an adapter -- which is where it was broken in production for every
 * hosted project while both neighbours stayed green.
 */
export async function deriveProjectCspOrigins(args: {
  adapter: RuntimeAdapter;
  projectSlug: string;
  projectId: string | undefined;
  token: string;
  releaseId: string | undefined;
  branch: string | null | undefined;
  environmentName: string | undefined;
}): Promise<SecurityConfig["derivedCsp"]> {
  // Each early return below is indistinguishable, from the served header, from
  // a project that references no external origins. Naming which one fired is
  // the difference between diagnosing this from logs and needing a live probe.
  if (!isExtendedFSAdapter(args.adapter.fs) || !args.adapter.fs.runWithContext) {
    logger.warn("CSP derivation skipped: adapter cannot run in a tenant context", {
      projectSlug: args.projectSlug,
    });
    return undefined;
  }
  const fs = args.adapter.fs;

  const run = async (): Promise<SecurityConfig["derivedCsp"]> => {
    // Read through the same door the config load uses. `getAllSourceFiles`
    // needs a content context, and `ensureSourceSnapshotFresh` is what
    // establishes one -- it awaits `ensureInitialized` before deciding whether
    // a refresh is due. Without it the adapter answers with an empty list and,
    // because its warmup is itself gated on being initialized, never fills in
    // afterwards. That is not a cold cache that warms a moment later; it never
    // warms, which is why hosted production projects derived nothing on every
    // request while preview, whose adapter was already initialized by then,
    // looked correct.
    await fs.ensureSourceSnapshotFresh?.("csp-derivation");

    const underlying = typeof fs.getUnderlyingAdapter === "function"
      ? fs.getUnderlyingAdapter() as {
        getAllSourceFiles?: (
          options?: { waitForWarmup?: boolean },
        ) => Promise<Array<{ path: string; content?: string }>>;
        getContentContext?: () => ResolvedContentContext | null;
        getSourceSnapshotVersion?: () => number | Promise<number | undefined>;
        ensureSourceSnapshotFresh?: (reason?: string) => Promise<void>;
      }
      : undefined;
    if (!underlying || typeof underlying.getAllSourceFiles !== "function") {
      logger.warn("CSP derivation skipped: adapter exposes no source listing", {
        projectSlug: args.projectSlug,
        hasUnderlying: Boolean(underlying),
      });
      return undefined;
    }

    // The wrapper may delegate without exposing the hook, so ask the adapter
    // that actually owns the file list too.
    await underlying.ensureSourceSnapshotFresh?.("csp-derivation");

    // Branch and environment content versions are stable while the content
    // under them changes, so the adapter's snapshot generation is what actually
    // moves when a preview is pushed to. Without it a preview would serve a
    // derivation from before the push until the entry is evicted.
    // Awaited: the multi-project wrapper's version of this is async, and
    // template-stringifying the promise put the literal "[object Promise]" in
    // every key, collapsing all snapshots to one value.
    const snapshot = typeof underlying.getSourceSnapshotVersion === "function"
      ? await underlying.getSourceSnapshotVersion()
      : 0;
    const contentVersion = `${
      resolveStyleContentVersion(underlying.getContentContext?.() ?? null, {
        releaseId: args.releaseId,
        branch: args.branch,
        environmentName: args.environmentName,
      })
    }@${snapshot}`;

    return await getDerivedCspOrigins({
      projectScope: args.projectSlug,
      contentVersion,
      // Nothing else populates the file list for a release-backed context, so
      // this read must wait for the fetch rather than answer empty forever.
      loadSourceFiles: () => underlying.getAllSourceFiles!({ waitForWarmup: true }),
    });
  };

  try {
    return await fs.runWithContext(
      args.projectSlug,
      args.token,
      run as () => Promise<unknown>,
      args.projectId,
      {
        productionMode: Boolean(args.releaseId),
        releaseId: args.releaseId ?? null,
        branch: args.branch ?? null,
        environmentName: args.environmentName ?? null,
      },
    ) as SecurityConfig["derivedCsp"];
  } catch (error) {
    // Never fail a response over a CSP nicety, but do not swallow it either.
    logger.warn("CSP derivation failed", {
      projectSlug: args.projectSlug,
      releaseId: args.releaseId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
