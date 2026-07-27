import type { Middleware } from "../types.ts";
import type { CSPDirectives, CSPOptions } from "./types.ts";

const CSP_DIRECTIVE_NAME = /^[a-z][a-z0-9-]*$/i;
const CSP_NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const MAX_CSP_NONCE_LENGTH = 256;

export function serializeCSPDirectives(
  policies: CSPDirectives,
  nonce?: string,
): string {
  if (
    typeof policies !== "object" ||
    policies === null ||
    Array.isArray(policies)
  ) {
    throw new TypeError("CSP policies must be a directives object");
  }
  if (
    nonce !== undefined &&
    (nonce.length === 0 ||
      nonce.length > MAX_CSP_NONCE_LENGTH ||
      !CSP_NONCE.test(nonce))
  ) {
    throw new TypeError("CSP nonce must be a bounded base64 value");
  }

  return Object.entries(policies)
    .map(([key, value]) => {
      if (!CSP_DIRECTIVE_NAME.test(key)) {
        throw new TypeError(`Invalid CSP directive name: ${key}`);
      }
      if (typeof value !== "string") {
        throw new TypeError(`CSP directive ${key} must be a string`);
      }
      const noncePart = nonce && key.toLowerCase() === "script-src" ? ` 'nonce-${nonce}'` : "";
      return `${key} ${value}${noncePart}`;
    })
    .join("; ");
}

export function contentSecurityPolicy(
  policies: CSPDirectives,
  options?: CSPOptions,
): Middleware {
  if (
    options !== undefined &&
    (typeof options !== "object" || options === null || Array.isArray(options))
  ) {
    throw new TypeError("CSP options must be an object");
  }
  if (options?.nonce !== undefined && typeof options.nonce !== "string") {
    throw new TypeError("CSP nonce must be a string");
  }
  if (options?.merge !== undefined && typeof options.merge !== "string") {
    throw new TypeError("CSP merge must be a string");
  }

  const base = serializeCSPDirectives(policies, options?.nonce);
  const csp = [options?.merge, base].filter((value) => value).join("; ");
  const validatedHeaders = new Headers({
    "Content-Security-Policy": csp,
  });
  const headerValue = validatedHeaders.get("Content-Security-Policy") ?? "";

  return async (_ctx, next) => {
    const res = await next();
    if (!res) return res;

    const headers = new Headers(res.headers);
    headers.set("Content-Security-Policy", headerValue);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
