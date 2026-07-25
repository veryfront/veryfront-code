import type { VeryfrontConfig } from "#veryfront/config";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import type { SecurityConfig } from "#veryfront/types";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { isConfigOptionalControlPlaneRunRequest } from "#veryfront/channels/control-plane.ts";
import { API_CLIENT_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import { createRequestContext } from "../context/request-context.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { getEffectiveRequestHost } from "../utils/request-host.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import {
  filterRuntimeProjectEnv,
  type HostedProxyEnvironmentSelector,
  type HostedProxyRoutingBindingCache,
} from "../project-env/index.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { resolveEnvironment } from "./environment-resolution.ts";
import { buildHandlerContext } from "./handler-context-builder.ts";
import { extractRequestHeaders, resolveProject } from "./project-resolution.ts";
import { isLightweightPath, isWebSocketPath, shouldSkipEnrichedContext } from "./request-utils.ts";

export interface PrepareProjectRequestInput {
  req: Request;
  url: URL;
  isProxyMode: boolean;
  /** Test seam; production reads the operator-owned process capability once. */
  proxyTopologyTrusted?: boolean;
}

type ProjectRequestHeaders = ReturnType<typeof extractRequestHeaders>;
type ProjectRequestContext = ReturnType<typeof createRequestContext>;
type ProjectIdentityResolution = Awaited<ReturnType<typeof resolveProject>>;
type ProjectAdapterResolution = Awaited<ReturnType<typeof resolveAdapter>>;
type ProjectEnvironmentResolution = ReturnType<typeof resolveEnvironment>;
type SourceIntegrationPolicy = ReturnType<typeof normalizeSourceIntegrationPolicy>;

type ProjectEnvVarCacheLike = {
  get(
    environmentId: string,
    token: string,
    projectSlug: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, string>>>;
};

type RuntimeContextProfiler = <T>(operation: () => Promise<T>) => Promise<T>;
type HostedSourceBindingCacheLike = Pick<HostedProxyRoutingBindingCache, "resolve">;

export interface PreparedProjectRequest {
  url: URL;
  headers: ProjectRequestHeaders;
  requestContext: ProjectRequestContext;
  proxyTopologyTrusted: boolean;
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
  proxyTopologyTrusted: boolean;
}

export interface PrepareProjectRuntimeSourceInput {
  req: Request;
  url: URL;
  isProxyMode: boolean;
  proxyTopologyTrusted: boolean;
  projectIdentity: ProjectIdentityResolution;
}

export interface ProjectRuntimeSourcePlan {
  readonly configIntentionallyDeferred: boolean;
  readonly sourceHost: string;
  readonly hostedSource:
    | {
      readonly mode: "preview" | "production";
      readonly branch: string | null;
      readonly selector: HostedProxyEnvironmentSelector;
      readonly parsedDomain: ReturnType<typeof parseProjectDomain>;
    }
    | undefined;
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
  proxyTopologyTrusted: boolean;
  sourcePlan: ProjectRuntimeSourcePlan;
  securityConfig: SecurityConfig | null;
  cspUserHeader: string | null;
  debug: boolean | undefined;
  routeRegistry: RouteRegistry;
  moduleServerUrl: string | undefined;
  environmentId?: string;
  defaultEnvironment?: "preview" | "production";
  skipEnrichedContext?: boolean;
  envVarCache: ProjectEnvVarCacheLike;
  hostedSourceBindingCache: HostedSourceBindingCacheLike;
  profileAdapter?: RuntimeContextProfiler;
  profileHostedSource?: RuntimeContextProfiler;
  profileEnvVars?: RuntimeContextProfiler;
  onEnvironmentResolved?: (environment: ProjectEnvironmentResolution) => void;
  logDebug?: (message: string, extra?: Record<string, unknown>) => void;
}

export interface ProjectRuntimeContextResolution {
  adapter: ProjectAdapterResolution;
  environment: ProjectEnvironmentResolution;
  handlerContext: HandlerContext | undefined;
  rawEnvVars: Readonly<Record<string, string>>;
  sourceIntegrationPolicy: SourceIntegrationPolicy;
}

interface HostedRuntimeConfigLoad {
  readonly sourceContext: VirtualConfigSourceContext;
  readonly preparedContext: Awaited<ReturnType<typeof prepareDeclarativeConfigContext>>;
  readonly environment: Readonly<Record<string, string>>;
  readonly environmentId: string | undefined;
  readonly environmentName: string;
}

interface RequestContextFacts {
  domain: string;
  projectSlug: string | undefined;
  projectId: string | undefined;
  releaseId: string | undefined;
  branchId: string | undefined;
  branchName: string | undefined;
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
  const proxyTopologyTrusted = isProxyMode &&
    (input.proxyTopologyTrusted ?? isProxyTopologyTrusted());
  const headers = extractRequestHeaders(req, url, proxyTopologyTrusted);
  const requestContext = createRequestContext(req, { proxyTopologyTrusted });

  const hostHeader = req.headers.get("host") ?? url.host;
  const domain = hostHeader.replace(/:\d+$/, "");

  return {
    url,
    headers,
    requestContext,
    proxyTopologyTrusted,
    loggerFacts: {
      domain,
      projectSlug: headers.projectSlug,
      projectId: headers.projectId,
      releaseId: headers.releaseId,
      branchId: headers.branchId,
      branchName: headers.branchName,
      pathname: url.pathname,
    },
    trackingFacts: {
      projectSlug: headers.projectSlug,
      pathname: url.pathname,
      method: req.method,
      environment: headers.environment,
      releaseId: headers.releaseId,
    },
    proxyGuard: createProxyGuard(req, url, isProxyMode, headers, proxyTopologyTrusted),
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
    proxyTopologyTrusted: input.proxyTopologyTrusted,
  });
}

/**
 * Resolve and validate the hosted source before any special Projects UI route
 * can short-circuit the normal runtime-context pipeline.
 */
export function prepareProjectRuntimeSource(
  input: PrepareProjectRuntimeSourceInput,
): ProjectRuntimeSourcePlan {
  const sourceHost = getEffectiveRequestHost(
    input.req,
    input.url,
    input.proxyTopologyTrusted,
  );

  return {
    configIntentionallyDeferred: isConfigOptionalControlPlaneRunRequest(
      input.req.method,
      input.url.pathname,
    ),
    sourceHost,
    hostedSource: input.isProxyMode
      ? resolveHostedSourceSelector(sourceHost, input.projectIdentity.projectSlug)
      : undefined,
  };
}

export async function resolveProjectRuntimeContext(
  input: ResolveProjectRuntimeContextInput,
): Promise<ProjectRuntimeContextResolution> {
  const projectRes = input.projectIdentity;
  const reqCtx = input.requestContext;
  const sourcePlan = input.sourcePlan;
  const profileAdapter = input.profileAdapter ?? ((operation) => operation());
  const profileHostedSource = input.profileHostedSource ?? ((operation) => operation());
  const profileEnvVars = input.profileEnvVars ?? ((operation) => operation());

  let localHostedLoadPromise: Promise<HostedRuntimeConfigLoad> | undefined;
  let remoteHostedLoadPromise: Promise<HostedRuntimeConfigLoad> | undefined;
  const prepareHostedConfigContext = (
    isLocalProject: boolean,
  ): Promise<HostedRuntimeConfigLoad> => {
    const hostedSource = sourcePlan.hostedSource;
    if (!hostedSource) {
      return Promise.reject(
        INVALID_ARGUMENT.create({
          detail: "Hosted source preparation requires proxy mode",
        }),
      );
    }

    if (isLocalProject) {
      localHostedLoadPromise ??= (async () => {
        const environment = filterRuntimeProjectEnv({});
        const environmentName = hostedSource.mode === "preview"
          ? "preview"
          : hostedSource.selector.kind === "name"
          ? hostedSource.selector.name
          : "production";
        const sourceContext: VirtualConfigSourceContext = hostedSource.mode === "production"
          ? {
            productionMode: true,
            releaseId: projectRes.releaseId ?? null,
            environmentName,
          }
          : {
            productionMode: false,
            branch: hostedSource.branch,
          };

        return {
          sourceContext,
          preparedContext: await prepareDeclarativeConfigContext({
            environmentName,
            environment,
          }),
          environment,
          environmentId: undefined,
          environmentName,
        };
      })();
      return localHostedLoadPromise;
    }

    remoteHostedLoadPromise ??= (async () => {
      const projectSlug = projectRes.projectSlug;
      if (!projectSlug) {
        throw INVALID_ARGUMENT.create({
          detail: "Hosted proxy request is missing its project slug",
        });
      }

      const binding = await profileHostedSource(() =>
        input.hostedSourceBindingCache.resolve({
          projectSlug,
          projectId: projectRes.projectId,
          environmentId: input.environmentId ?? input.headers.environmentId,
          selector: hostedSource.selector,
          mode: hostedSource.mode,
          releaseId: hostedSource.mode === "production" ? projectRes.releaseId : undefined,
          branch: hostedSource.branch,
          token: reqCtx.token,
          signal: input.req.signal,
        })
      );
      const environment = await profileEnvVars(() =>
        input.envVarCache.get(
          binding.environmentId,
          reqCtx.token,
          binding.projectSlug,
          input.req.signal,
        )
      );
      const filteredEnvironment = filterRuntimeProjectEnv(environment);

      input.logDebug?.("[runtime-handler] Project env vars fetched", {
        projectSlug: binding.projectSlug,
        environmentId: binding.environmentId,
        environmentName: binding.environmentName,
        count: Object.keys(filteredEnvironment).length,
      });

      return {
        sourceContext: binding.sourceContext,
        preparedContext: await prepareDeclarativeConfigContext({
          environmentName: binding.environmentName,
          environment: filteredEnvironment,
        }),
        environment: filteredEnvironment,
        environmentId: binding.environmentId,
        environmentName: binding.environmentName,
      };
    })();
    return remoteHostedLoadPromise;
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
      tokenProvenance: reqCtx.tokenProvenance,
      releaseId: projectRes.releaseId,
      proxyEnv: projectRes.proxyEnv,
      branch: reqCtx.branch,
      environmentName: projectRes.environmentName,
      parsedDomain: projectRes.parsedDomain,
      pathname: input.url.pathname,
      isProxyMode: input.isProxyMode,
      proxyTopologyTrusted: input.proxyTopologyTrusted,
      ...(input.isProxyMode ? { prepareHostedConfigContext } : {}),
    })
  );

  const preparedHostedLoadPromise = adapterRes.isLocalProject
    ? localHostedLoadPromise
    : remoteHostedLoadPromise;
  const shouldInitiateHostedSourceLoad = input.isProxyMode &&
    !sourcePlan.configIntentionallyDeferred &&
    !isLightweightPath(input.url.pathname) &&
    !isWebSocketPath(input.url.pathname);
  // Adapter resolution can consume the memoized source while evaluating
  // configuration. Once consumed, that source remains authoritative even for
  // lightweight and WebSocket requests; eligibility controls only initiation.
  const hostedLoadPromise = preparedHostedLoadPromise ??
    (shouldInitiateHostedSourceLoad
      ? prepareHostedConfigContext(adapterRes.isLocalProject)
      : undefined);
  const hostedLoad = hostedLoadPromise ? await hostedLoadPromise : undefined;
  const effectiveProxyEnv = hostedLoad
    ? hostedLoad.sourceContext.productionMode ? "production" : "preview"
    : projectRes.proxyEnv;
  const effectiveReleaseId = hostedLoad?.sourceContext.productionMode
    ? hostedLoad.sourceContext.releaseId ?? undefined
    : projectRes.releaseId;
  const effectiveEnvironmentName = hostedLoad?.environmentName ??
    projectRes.environmentName;
  const effectiveParsedDomain = input.isProxyMode && sourcePlan.hostedSource
    ? sourcePlan.hostedSource.parsedDomain
    : projectRes.parsedDomain;
  const effectiveRequestContext: ProjectRequestContext = hostedLoad
    ? {
      ...reqCtx,
      mode: effectiveProxyEnv ?? reqCtx.mode,
      branch: hostedLoad.sourceContext.productionMode
        ? null
        : hostedLoad.sourceContext.branch ?? null,
    }
    : reqCtx;

  const envRes = resolveEnvironment({
    proxyEnv: effectiveProxyEnv,
    reqCtxMode: effectiveRequestContext.mode,
    releaseId: effectiveReleaseId,
    projectSlug: projectRes.projectSlug,
    projectId: projectRes.projectId,
    environmentName: effectiveEnvironmentName,
    host: sourcePlan.sourceHost,
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

  if (
    input.isProxyMode &&
    !adapterRes.config &&
    !sourcePlan.configIntentionallyDeferred
  ) {
    throw new Error("Proxy project config is unavailable for request security");
  }

  const requestSecurity = input.isProxyMode && adapterRes.config
    ? deriveSecurityContext(adapterRes.config, {
      // Hosted preview and production projects share a remote trust boundary.
      // Only an actually local project keeps development defaults; process-wide
      // environment flags cannot classify an individual proxy request.
      productionDefaults: !adapterRes.isLocalProject,
    })
    : input.isProxyMode
    ? {
      // Config-optional control-plane routes authenticate their exact source in
      // the signed handler, before project configuration is available.
      securityConfig: null,
      cspUserHeader: null,
    }
    : {
      securityConfig: input.securityConfig,
      cspUserHeader: input.cspUserHeader,
    };

  const handlerContext = buildHandlerContext({
    projectDir: adapterRes.projectDir,
    adapter: adapterRes.adapter,
    securityConfig: requestSecurity.securityConfig,
    cspUserHeader: requestSecurity.cspUserHeader,
    debug: input.debug,
    config: adapterRes.config,
    parsedDomain: effectiveParsedDomain,
    projectSlug: projectRes.projectSlug,
    projectId: projectRes.projectId,
    releaseId: envRes.releaseId,
    proxyToken: reqCtx.token,
    environmentName: effectiveEnvironmentName,
    resolvedEnvironment: envRes.resolvedEnvironment ?? "preview",
    requestContext: effectiveRequestContext,
    routeRegistry: input.routeRegistry,
    isLocalProject: adapterRes.isLocalProject,
    moduleServerUrl: input.moduleServerUrl,
    environmentId: hostedLoad?.environmentId ??
      input.environmentId ??
      input.headers.environmentId,
    skipEnrichedContext: input.skipEnrichedContext ?? shouldSkipEnrichedContext(input.url.pathname),
  });

  let rawEnvVars: Readonly<Record<string, string>> = {};
  const environmentId = input.environmentId ?? input.headers.environmentId;
  if (hostedLoad) {
    rawEnvVars = hostedLoad.environment;
  } else if (
    !adapterRes.isLocalProject &&
    environmentId &&
    reqCtx.token &&
    projectRes.projectSlug &&
    !(input.isProxyMode && sourcePlan.configIntentionallyDeferred)
  ) {
    const projectSlug = projectRes.projectSlug;
    rawEnvVars = await profileEnvVars(() =>
      input.envVarCache.get(
        environmentId,
        reqCtx.token,
        projectSlug,
        input.req.signal,
      )
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

function resolveHostedSourceSelector(
  sourceHost: string,
  projectSlug: string | undefined,
): NonNullable<ProjectRuntimeSourcePlan["hostedSource"]> {
  const parsed = parseProjectDomain(sourceHost);
  if (parsed.environment === "preview") {
    if (
      parsed.slug &&
      projectSlug &&
      parsed.slug.toLowerCase() !== projectSlug.toLowerCase()
    ) {
      throw API_CLIENT_ERROR.create({
        status: 502,
        detail: "Proxy project context did not match the source host",
        context: { code: "proxy-context-mismatch", reason: "project-slug" },
      });
    }
    return {
      mode: "preview",
      branch: parsed.branch,
      selector: { kind: "name", name: "preview" },
      parsedDomain: parsed,
    };
  }

  if (parsed.isVeryfrontDomain) {
    if (
      parsed.slug &&
      projectSlug &&
      parsed.slug.toLowerCase() !== projectSlug.toLowerCase()
    ) {
      throw API_CLIENT_ERROR.create({
        status: 502,
        detail: "Proxy project context did not match the source host",
        context: { code: "proxy-context-mismatch", reason: "project-slug" },
      });
    }
    if (parsed.environment !== "production" && parsed.environment !== "staging") {
      throw INVALID_ARGUMENT.create({
        detail: "Hosted proxy request did not identify a supported source environment",
      });
    }
    return {
      mode: "production",
      branch: null,
      selector: { kind: "name", name: parsed.environment },
      parsedDomain: parsed,
    };
  }

  return {
    mode: "production",
    branch: null,
    selector: { kind: "domain", domain: sourceHost },
    parsedDomain: parsed,
  };
}

function createProxyGuard(
  req: Request,
  url: URL,
  isProxyMode: boolean,
  headers: ProjectRequestHeaders,
  proxyTopologyTrusted: boolean,
): ProxyGuardResult | undefined {
  if (!isProxyMode || isLightweightPath(url.pathname) || isWebSocketPath(url.pathname)) {
    return undefined;
  }

  const token = req.headers.get("x-token");
  const body = !headers.projectSlug
    ? {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    }
    : !token
    ? {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    }
    : req.headers.get("x-project-path") && !proxyTopologyTrusted
    ? {
      error: "Untrusted proxy context",
      detail: "proxy context headers require a trusted upstream proxy",
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
