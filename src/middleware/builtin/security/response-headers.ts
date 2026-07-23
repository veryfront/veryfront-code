import { isWebSocketUpgradeResponse } from "#veryfront/platform/adapters/base.ts";
import type { CSPDirectives } from "./types.ts";

const CSP_DIRECTIVE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const MAX_HEADER_VALUE_LENGTH = 8_192;
const MAX_CSP_DIRECTIVES = 64;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function assertSafeHeaderValue(name: string, value: string): void {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_HEADER_VALUE_LENGTH || hasControlCharacters(value)
  ) {
    throw new TypeError(
      `${name} must contain 1 to ${MAX_HEADER_VALUE_LENGTH} characters without control characters`,
    );
  }
  try {
    new Headers([[name, value]]);
  } catch {
    throw new TypeError(`${name} contains an invalid HTTP header value`);
  }
}

export function buildCSPHeader(csp: CSPDirectives): string {
  if (typeof csp !== "object" || csp === null || Array.isArray(csp)) {
    throw new TypeError("CSP directives must be an object");
  }
  const entries = Object.entries(csp);
  if (entries.length === 0 || entries.length > MAX_CSP_DIRECTIVES) {
    throw new TypeError(`CSP must contain 1 to ${MAX_CSP_DIRECTIVES} directives`);
  }
  const value = entries.map(([key, directiveValue]) => {
    if (!CSP_DIRECTIVE_NAME.test(key)) {
      throw new TypeError(`Invalid CSP directive name: ${key}`);
    }
    if (typeof directiveValue !== "string") {
      throw new TypeError(`CSP directive ${key} must be a string`);
    }
    if (hasControlCharacters(directiveValue)) {
      throw new TypeError(`CSP directive ${key} contains control characters`);
    }
    return directiveValue.length > 0 ? `${key} ${directiveValue}` : key;
  }).join("; ");
  assertSafeHeaderValue("Content-Security-Policy", value);
  return value;
}

export function updateResponseHeaders(
  response: Response,
  update: (headers: Headers) => void,
): Response {
  if (isWebSocketUpgradeResponse(response) || response.status === 101) return response;
  const headers = new Headers(response.headers);
  update(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
