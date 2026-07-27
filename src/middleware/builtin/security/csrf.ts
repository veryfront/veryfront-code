import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import { HTTP_FORBIDDEN } from "#veryfront/utils/constants/http.ts";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CsrfTokenValidator = (
  token: string,
) => boolean | Promise<boolean>;

export function csrfProtection(validate: CsrfTokenValidator): Middleware {
  if (typeof validate !== "function") {
    throw new TypeError("CSRF token validator must be a function");
  }

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const method = req.method.toUpperCase();

    if (!STATE_CHANGING_METHODS.has(method)) return next();

    const token = req.headers.get("X-CSRF-Token");
    if (!token || (await validate(token)) !== true) {
      return new Response("Invalid CSRF token", {
        status: HTTP_FORBIDDEN,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return next();
  };
}
