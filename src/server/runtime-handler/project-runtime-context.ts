import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import { isSameProcessProxyRequest } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import type { SecurityConfig } from "#veryfront/types";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { createRequestContext } from "../context/request-context.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { isProxyTrusted } from "../utils/proxy-trust.ts";
import { getEffectiveRequestHost } from "../utils/request-host.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { resolveEnvironment } from "./environment-resolution.ts";
import { buildHandlerContext } from "./handler-context-builder.ts";
import { extractRequestHeaders, resolveProject } from "./project-resolution.ts";
import { isLightweightPath, isWebSocketPath, shouldSkipEnrichedContext } from "./request-utils.ts";

type ProxyTrustVerifier = (
  req: Request,
) => Promise<boolean>;

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
  get(environmentId: string, token: string, projectSlug: string): Promise<Record<string, string>>;
};

type RuntimeContextProfiler = <T>(operation: () => Promise<T>) => Promise<T>;

export interface PreparedProjectRequest {
  url: URL;
  headers: ProjectRequestHeaders;
  requestContext: ProjectRequestContext;
  proxyTrust: {
    proxyTrusted: boolean | undefined;
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
  proxyTrust: {
    proxyTrusted: boolean | undefined;
  };
  securityConfig: SecurityConfig | null;
  cspUserHeader: string | null;
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
  const headers = extractRequestHeaders(req, url, proxyTrusted);
  const requestContext = createRequestContext(req, { proxyTrusted });

  const hostHeader = req.headers.get("host") ?? url.host;
  const domain = hostHeader.replace(/:\d+$/, "");

  return {
    url,
    headers,
    requestContext,
    proxyTrust: { proxyTrusted },
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
    proxyGuard: createProxyGuard(req, url, isProxyMode, headers, proxyTrusted),
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
          input.envVarCache.get(environmentId, reqCtx.token!, projectRes.projectSlug!)
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

  const host = getEffectiveRequestHost(
    input.req,
    input.url,
    input.proxyTrust.proxyTrusted ?? isProxyTopologyTrusted(),
  );
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

  const handlerContext = buildHandlerContext({
    projectDir: adapterRes.projectDir,
    adapter: adapterRes.adapter,
    securityConfig: input.securityConfig,
    cspUserHeader: input.cspUserHeader,
    debug: input.debug,
    config: adapterRes.config,
    parsedDomain: projectRes.parsedDomain,
    projectSlug: projectRes.projectSlug,
    projectId: projectRes.projectId,
    releaseId: envRes.releaseId,
    proxyToken: reqCtx.token,
    environmentName: projectRes.environmentName,
    resolvedEnvironment: envRes.resolvedEnvironment ?? "preview",
    requestContext: reqCtx,
    routeRegistry: input.routeRegistry,
    isLocalProject: adapterRes.isLocalProject,
    moduleServerUrl: input.moduleServerUrl,
    environmentId: input.environmentId ?? input.headers.environmentId,
    contentSourceId: input.headers.contentSourceId,
    publicOrigin: input.headers.publicOrigin,
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
      input.envVarCache.get(
        environmentId,
        reqCtx.token,
        projectSlug,
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

function createProxyGuard(
  req: Request,
  url: URL,
  isProxyMode: boolean,
  headers: ProjectRequestHeaders,
  proxyTrusted: boolean | undefined,
): ProxyGuardResult | undefined {
  if (!isProxyMode) return undefined;

  if (!proxyTrusted) {
    const body = {
      error: "Untrusted proxy topology",
      detail: "shared runtime requests require a trusted upstream proxy",
    };
    return {
      detail: body.detail,
      response: new Response(JSON.stringify(body), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  if (isLightweightPath(url.pathname) || isWebSocketPath(url.pathname)) return undefined;

  const token = req.headers.get("x-token");
  const trustedLocalProject = isSameProcessProxyRequest(req) && headers.projectPath !== undefined;
  const body = !headers.projectSlug
    ? {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    }
    : !token && !trustedLocalProject
    ? {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
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
