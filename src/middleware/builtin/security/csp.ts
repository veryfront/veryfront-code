import type { Middleware } from "../types.ts";
import type { CSPDirectives, CSPOptions } from "./types.ts";

export function contentSecurityPolicy(
  policies: CSPDirectives,
  options?: CSPOptions,
): Middleware {
  return async (_ctx, next) => {
    const res = await next();
    if (!res) return res;

    const headers = new Headers(res.headers);

    const base = Object.entries(policies)
      .map(([key, value]) => `${key} ${value}`)
      .join("; ");

    const nonce = options?.nonce;
    const noncePart = nonce ? ` 'nonce-${nonce}'` : "";

    let csp = base.replace(
      /(script-src)([^;]*)/i,
      (_m, a, b) => `${a}${b}${noncePart}`,
    );

    const merge = options?.merge;
    if (merge) csp = `${merge}; ${csp}`;

    headers.set("Content-Security-Policy", csp);
    return new Response(res.body, { status: res.status, headers });
  };
}
