import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { CORSOptions } from "./types.ts";
import { validateOriginSync } from "@veryfront/security/http/cors/validators.ts";
import { HTTP_NO_CONTENT } from "@veryfront/utils/constants/http.ts";

/**
 * Simple CORS middleware using consolidated validation
 *
 * Uses the consolidated CORS validators from the security module
 * to eliminate duplicate validation logic.
 *
 * @param options - CORS options with optional origin configuration
 * @returns Middleware compatible with builtin middleware system
 */
export function corsSimple(options: CORSOptions | string = "*"): Middleware {
  const origin = typeof options === "string" ? options : (options.origin ?? "*");

  return async (ctx, next) => {
    const req = getRequest(ctx);

    if (req.method.toUpperCase() === "OPTIONS") {
      // Use consolidated validator for origin determination
      const validation = validateOriginSync(req.headers.get("origin"), {
        origin,
      });

      return new Response(null, {
        status: HTTP_NO_CONTENT,
        headers: {
          "Access-Control-Allow-Origin": validation.allowedOrigin || origin,
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
      });
    }

    const res = await next();
    if (!res) return res;

    // Use consolidated validator for response headers
    const validation = validateOriginSync(req.headers.get("origin"), {
      origin,
    });

    const headers = new Headers(res.headers);
    if (validation.allowedOrigin) {
      headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
    }

    return new Response(res.body, { status: res.status, headers });
  };
}
