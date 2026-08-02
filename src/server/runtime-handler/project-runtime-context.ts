import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import type { SecurityConfig } from "#veryfront/types";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { createRequestContext } from "../context/request-context.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { isProxyTrusted } from "../utils/proxy-trust.ts";
import { getEffectiveRequestHost } from "../utils/request-host.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { resolveEnvironment } from "./environment-resolution.ts";
import { buildHandlerContext } from "./handler-context-builder.ts";
import { extractRequestHeaders, resolveProject } from "./project-resolution.ts";
import { shouldSkipEnrichedContext } from "./request-utils.ts";

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

  const host = getEffectiveRequestHost(
    input.req,
    input.url,
    input.proxyTrust.proxyTrusted ?? getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1",
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

  // The process-wide SecurityConfigLoader is valid only for a standalone
  // project. A shared proxy loads one authenticated, source-qualified config
  // snapshot per request above; derive security from that exact snapshot so a
  // tenant cannot inherit another tenant's auth/CORS/CSRF/CSP state. Keep the
  // deliberately config-less control-plane path config-less: those endpoints
  // authenticate their signed operation envelope and do not expose an
  // application/browser surface.
  const requestSecurity = input.isProxyMode && adapterRes.config !== undefined
    ? deriveSecurityContext(adapterRes.config, {
      productionDefaults: envRes.resolvedEnvironment === "production",
    })
    : undefined;

  const handlerContext = buildHandlerContext({
    projectDir: adapterRes.projectDir,
    adapter: adapterRes.adapter,
    securityConfig: requestSecurity?.securityConfig ?? input.securityConfig,
    cspUserHeader: requestSecurity?.cspUserHeader ?? input.cspUserHeader,
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
      req.headers.has("x-branch-name")
    );
  const hasIncompleteEnvironmentIdentity = identityHeadersTrusted &&
    Boolean(headers.environmentId) !== Boolean(headers.environmentName);
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
