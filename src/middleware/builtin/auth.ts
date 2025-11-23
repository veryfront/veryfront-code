import type { Context, MiddlewareHandler, Next } from "../core/types.ts";
import { HTTP_UNAUTHORIZED } from "@veryfront/utils/constants/http.ts";

export function basicAuth(
  options: { username: string; password: string; realm?: string },
): MiddlewareHandler {
  const { username, password, realm = "Secure Area" } = options;
  const expected = btoa(`${username}:${password}`);

  return (c: Context, next: Next) => {
    const authorization = c.req.headers.get("authorization");

    if (!authorization || !authorization.startsWith("Basic ")) {
      return new Response("Unauthorized", {
        status: HTTP_UNAUTHORIZED,
        headers: {
          "WWW-Authenticate": `Basic realm="${realm}"`,
        },
      });
    }

    const credentials = authorization.slice(6);
    if (credentials !== expected) {
      return new Response("Unauthorized", {
        status: HTTP_UNAUTHORIZED,
        headers: {
          "WWW-Authenticate": `Basic realm="${realm}"`,
        },
      });
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

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
    }

    const bearerToken = authorization.slice(7);

    if (token && bearerToken !== token) {
      return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
    }

    if (verifyToken) {
      const isValid = await verifyToken(bearerToken);
      if (!isValid) {
        return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
      }
    }

    c.var.token = bearerToken;

    return next();
  };
}
