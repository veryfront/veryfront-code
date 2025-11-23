import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import { HTTP_FORBIDDEN } from "@veryfront/utils/constants/http.ts";

const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export function csrfProtection(validate: (token: string) => boolean): Middleware {
  return (ctx, next) => {
    const req = getRequest(ctx);
    const method = req.method.toUpperCase();

    if (STATE_CHANGING_METHODS.includes(method as typeof STATE_CHANGING_METHODS[number])) {
      const token = req.headers.get("X-CSRF-Token") || "";

      if (!token || !validate(token)) {
        return new Response("Invalid CSRF token", { status: HTTP_FORBIDDEN });
      }
    }

    return next();
  };
}
