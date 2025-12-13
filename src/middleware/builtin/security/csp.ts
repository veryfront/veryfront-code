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
      .map(([k, v]) => `${k} ${v}`)
      .join("; ");

    let csp = base;

    // Add nonce to script-src if specified
    if (options?.nonce) {
      const noncePart = ` 'nonce-${options.nonce}'`;
      const hasScriptSrc = /(script-src)([^;]*)/i.test(csp);

      if (hasScriptSrc) {
        csp = csp.replace(/(script-src)([^;]*)/i, (_m, a, b) => `${a}${b}${noncePart}`);
      } else {
        // If no script-src directive exists, append one with the nonce
        csp = `${csp}; script-src 'self'${noncePart}`;
      }
    }

    if (options?.merge) {
      csp = `${options.merge}; ${csp}`;
    }

    headers.set("Content-Security-Policy", csp);
    return new Response(res.body, { status: res.status, headers });
  };
}
