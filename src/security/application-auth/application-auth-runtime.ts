import type { HandlerContext, HandlerResult } from "#veryfront/types";
import { createOidcApplicationAuthRuntime } from "./oidc-runtime.ts";
import { createTrustedProxyApplicationAuthRuntime } from "./trusted-proxy.ts";

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
): Promise<HandlerResult | null> {
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
  });
  const routeResponse = await runtime.handleAuthRoute(request);
  if (routeResponse !== null) return { response: routeResponse };

  const admission = await runtime.admitRequest(request);
  if (admission instanceof Response) return { response: admission };
  return { continue: true, metadata: { applicationIdentity: admission } };
}
