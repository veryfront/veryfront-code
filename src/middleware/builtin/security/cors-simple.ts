import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { CORSOptions } from "./types.ts";
import { isPreflightRequest } from "#veryfront/security/http/cors/preflight.ts";
import { validateOriginSync } from "#veryfront/security/http/cors/validators.ts";
import { HTTP_FORBIDDEN, HTTP_NO_CONTENT } from "#veryfront/utils/constants/http.ts";
import { isBoundedCorsOrigin } from "#veryfront/utils/cors-policy-limits.ts";

function addVaryOrigin(headers: Headers): void {
  const values = headers
    .get("Vary")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

  if (
    values.some((value) => value === "*" || value.toLowerCase() === "origin")
  ) {
    return;
  }
  headers.set("Vary", [...values, "Origin"].join(", "));
}

export function corsSimple(options: CORSOptions | string = "*"): Middleware {
  if (
    typeof options !== "string" &&
    (typeof options !== "object" || options === null || Array.isArray(options))
  ) {
    throw new TypeError("CORS options must be a string or options object");
  }
  const origin = typeof options === "string" ? options : options.origin ?? "*";
  if (!isBoundedCorsOrigin(origin)) {
    throw new TypeError(
      "CORS origin must be a bounded header-safe string",
    );
  }

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const validation = validateOriginSync(req.headers.get("origin"), { origin });

    if (isPreflightRequest(req)) {
      if (!validation.allowedOrigin) {
        return new Response(null, {
          status: HTTP_FORBIDDEN,
          headers: { "Cache-Control": "no-store" },
        });
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
      const responseHeaders = new Headers(headers);
      if (validation.allowedOrigin !== "*") addVaryOrigin(responseHeaders);
      return new Response(null, {
        status: HTTP_NO_CONTENT,
        headers: responseHeaders,
      });
    }

    const res = await next();
    if (!res) return res;

    if (!validation.allowedOrigin) return res;

    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
    if (validation.allowedOrigin !== "*") addVaryOrigin(headers);

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
