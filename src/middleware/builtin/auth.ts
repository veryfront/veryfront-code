import type { Context, MiddlewareHandler, Next } from "../core/types.ts";
import { HTTP_UNAUTHORIZED } from "@veryfront/utils/constants/http.ts";

/**
 * Performs constant-time string comparison to prevent timing attacks.
 * Both strings are compared character by character, taking the same amount
 * of time regardless of where a mismatch occurs.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still compare all characters to maintain constant time for same-length check
    let result = 1;
    const maxLength = Math.max(a.length, b.length);
    for (let i = 0; i < maxLength; i++) {
      const charA = i < a.length ? a.charCodeAt(i) : 0;
      const charB = i < b.length ? b.charCodeAt(i) : 0;
      result |= charA ^ charB;
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

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
    if (!secureCompare(credentials, expected)) {
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
