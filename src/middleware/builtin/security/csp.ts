import type { Middleware } from "../types.ts";
import type { CSPDirectives, CSPOptions } from "./types.ts";
import {
  assertSafeHeaderValue,
  buildCSPHeader,
  updateResponseHeaders,
} from "./response-headers.ts";

const CSP_NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const MAX_NONCE_LENGTH = 256;

export function contentSecurityPolicy(
  policies: CSPDirectives,
  options?: CSPOptions,
): Middleware {
  if (typeof policies !== "object" || policies === null || Array.isArray(policies)) {
    throw new TypeError("CSP directives must be an object");
  }
  if (
    options !== undefined &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    throw new TypeError("CSP options must be an object");
  }
  const policySnapshot = Object.fromEntries(Object.entries(policies));
  const nonce = options?.nonce;
  if (
    nonce !== undefined &&
    (typeof nonce !== "string" || nonce.length === 0 || nonce.length > MAX_NONCE_LENGTH ||
      !CSP_NONCE.test(nonce))
  ) {
    throw new TypeError(
      `CSP nonce must contain 1 to ${MAX_NONCE_LENGTH} base64 or base64url characters`,
    );
  }

  if (nonce) {
    const scriptKey = Object.keys(policySnapshot).find((key) => key.toLowerCase() === "script-src");
    if (scriptKey) {
      policySnapshot[scriptKey] = `${policySnapshot[scriptKey]} 'nonce-${nonce}'`.trim();
    } else {
      policySnapshot["script-src"] = `'nonce-${nonce}'`;
    }
  }

  const base = buildCSPHeader(policySnapshot);
  const merge = options?.merge;
  if (merge !== undefined) assertSafeHeaderValue("Content-Security-Policy", merge);
  const csp = merge ? `${merge}; ${base}` : base;
  assertSafeHeaderValue("Content-Security-Policy", csp);

  return async (_ctx, next) => {
    const res = await next();
    if (!res) return res;
    return updateResponseHeaders(res, (headers) => {
      headers.set("Content-Security-Policy", csp);
    });
  };
}
