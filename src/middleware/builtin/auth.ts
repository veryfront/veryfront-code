import type { Context, MiddlewareHandler, Next } from "../core/types.ts";
import { HTTP_UNAUTHORIZED } from "@veryfront/utils/constants/http.ts";

function unauthorizedResponse(realm?: string): Response {
  const headers: HeadersInit = realm ? { "WWW-Authenticate": `Basic realm="${realm}"` } : {};
  return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED, headers });
}

export function basicAuth(
  options: { username: string; password: string; realm?: string },
): MiddlewareHandler {
  const { username, password, realm = "Secure Area" } = options;
  const expected = btoa(`${username}:${password}`);

  return (c: Context, next: Next) => {
    const authorization = c.req.headers.get("authorization");

    if (!authorization?.startsWith("Basic ")) {
      return unauthorizedResponse(realm);
    }

    const credentials = authorization.slice(6);
    if (credentials !== expected) {
      return unauthorizedResponse(realm);
    }

    return next();
  };
}

export function bearerAuth(options: {
  token?: string;
  verifyToken?: (token: string) => Promise<boolean> | boolean;
}): MiddlewareHandler {
  const { token, verifyToken } = options;

  return async (c: Context, next: Next) => {
    const authorization = c.req.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return unauthorizedResponse();
    }

    const bearerToken = authorization.slice(7);

    if (token && bearerToken !== token) {
      return unauthorizedResponse();
    }

    if (verifyToken && !(await verifyToken(bearerToken))) {
      return unauthorizedResponse();
    }

    c.var.token = bearerToken;

    return next();
  };
}
