import type { HandlerContext, HandlerResult } from "#veryfront/types";
import { createOidcApplicationAuthRuntime } from "./oidc-runtime.ts";

export async function handleApplicationAuthRequest(
  request: Request,
  ctx: HandlerContext,
): Promise<HandlerResult | null> {
  const oidc = ctx.securityConfig?.auth?.oidc;
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
