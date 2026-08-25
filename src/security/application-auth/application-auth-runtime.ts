import type { HandlerContext, HandlerResult } from "#veryfront/types";
import { createJwksCache, type JwksCache } from "./jwks-cache.ts";
import { createOidcMetadataCache, type OidcMetadataCache } from "./oidc-metadata.ts";
import { createOidcApplicationAuthRuntime } from "./oidc-runtime.ts";
import {
  createTrustedProxyApplicationAuthRuntime,
  markTrustedProxyApplicationAuthAdmittedRequest,
} from "./trusted-proxy.ts";
import type { ApplicationIdentity } from "./types.ts";

export interface ApplicationAuthHandlerResult extends HandlerResult {
  metadata?: {
    applicationIdentity?: ApplicationIdentity;
    applicationIdentityHeaderNames?: readonly string[];
  };
}

interface ApplicationAuthCaches {
  readonly metadata: OidcMetadataCache;
  readonly jwks: JwksCache;
}

type ApplicationAuthRequestHandler = (
  request: Request,
  ctx: HandlerContext,
) => Promise<ApplicationAuthHandlerResult | null>;

function unauthorized(): HandlerResult {
  return {
    response: new Response("Unauthorized", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  };
}

export async function handleApplicationAuthRequest(
  request: Request,
  ctx: HandlerContext,
): Promise<ApplicationAuthHandlerResult | null> {
  return await handleApplicationAuthRequestWithCaches(request, ctx, createApplicationAuthCaches());
}

export function createApplicationAuthRequestHandler(): ApplicationAuthRequestHandler {
  const caches = createApplicationAuthCaches();
  return (request, ctx) => handleApplicationAuthRequestWithCaches(request, ctx, caches);
}

function createApplicationAuthCaches(): ApplicationAuthCaches {
  return Object.freeze({
    metadata: createOidcMetadataCache(),
    jwks: createJwksCache(),
  });
}

async function handleApplicationAuthRequestWithCaches(
  request: Request,
  ctx: HandlerContext,
  caches: ApplicationAuthCaches,
): Promise<ApplicationAuthHandlerResult | null> {
  const auth = ctx.securityConfig?.auth;
  const oidc = auth?.oidc;
  const trustedProxy = auth?.trustedProxy;
  if (oidc === undefined && trustedProxy === undefined) return null;

  if (trustedProxy !== undefined) {
    if (ctx.isProxyMode === true || ctx.prepareHostedConfigContext !== undefined) {
      return unauthorized();
    }
    const runtime = createTrustedProxyApplicationAuthRuntime({
      config: trustedProxy,
    });
    const admission = await runtime.admitRequest(request);
    if (admission instanceof Response) return { response: admission };
    markTrustedProxyApplicationAuthAdmittedRequest(request);
    return {
      continue: true,
      metadata: {
        applicationIdentity: admission.identity,
        applicationIdentityHeaderNames: admission.identityHeaderNames,
      },
    };
  }

  if (oidc === undefined) return null;

  const runtime = createOidcApplicationAuthRuntime({
    config: oidc,
    env: ctx.adapter.env,
    metadataCache: caches.metadata,
    jwksCache: caches.jwks,
  });
  const routeResponse = await runtime.handleAuthRoute(request);
  if (routeResponse !== null) return { response: routeResponse };

  const admission = await runtime.admitRequest(request);
  if (admission instanceof Response) return { response: admission };
  return { continue: true, metadata: { applicationIdentity: admission } };
}
