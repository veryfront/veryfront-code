import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createRequestContext } from "../context/request-context.ts";
import { isProxyTrusted } from "../utils/proxy-trust.ts";
import { extractRequestHeaders, resolveProject } from "./project-resolution.ts";
import { isLightweightPath, isWebSocketPath } from "./request-utils.ts";

type AdapterEnvLike = {
  get(key: string): string | undefined;
};

type ProxyTrustVerifier = (
  req: Request,
  options: { publicKeyPem?: string },
) => Promise<boolean>;

export interface PrepareProjectRequestInput {
  req: Request;
  url: URL;
  isProxyMode: boolean;
  adapterEnv?: AdapterEnvLike;
  trustProxy?: ProxyTrustVerifier;
}

type ProjectRequestHeaders = ReturnType<typeof extractRequestHeaders>;
type ProjectRequestContext = ReturnType<typeof createRequestContext>;
type ProjectIdentityResolution = Awaited<ReturnType<typeof resolveProject>>;

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
  const proxyTrusted = isProxyMode
    ? await (input.trustProxy ?? isProxyTrusted)(req, {
      publicKeyPem: input.adapterEnv?.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") ??
        getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY"),
    })
    : undefined;
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

function createProxyGuard(
  req: Request,
  url: URL,
  isProxyMode: boolean,
  headers: ProjectRequestHeaders,
  proxyTrusted: boolean | undefined,
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
    : req.headers.get("x-project-path") && !proxyTrusted
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
