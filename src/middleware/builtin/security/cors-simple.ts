import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { CORSOptions } from "./types.ts";
import { validateOriginSync } from "#veryfront/security/http/cors/validators.ts";
import { HTTP_FORBIDDEN, HTTP_NO_CONTENT } from "#veryfront/utils/constants/http.ts";

export function corsSimple(options: CORSOptions | string = "*"): Middleware {
  const origin = typeof options === "string" ? options : options.origin ?? "*";

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const validation = validateOriginSync(req.headers.get("origin"), { origin });

    if (req.method === "OPTIONS") {
      if (!validation.allowedOrigin) {
        return new Response(null, { status: HTTP_FORBIDDEN });
      }

      // Only echo Access-Control-Allow-Origin when the origin actually passed
      // validation. Falling back to the configured origin (e.g. "*") here would
      // grant a permissive preflight to an origin we just rejected.
      const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      };
      if (validation.allowedOrigin) {
        headers["Access-Control-Allow-Origin"] = validation.allowedOrigin;
      }
      return new Response(null, { status: HTTP_NO_CONTENT, headers });
    }

    const res = await next();
    if (!res) return res;

    if (!validation.allowedOrigin) return res;

    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

    return new Response(res.body, { status: res.status, headers });
  };
}
