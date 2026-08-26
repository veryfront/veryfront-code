import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";
import { useMemo } from "react";

/** Remove trailing slashes so hook routes contain one separator per segment. */
export function normalizeWorkflowApiBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

/** Encode an identifier that must remain one WHATWG URL path segment. */
export function encodeWorkflowPathSegment(value: string, label: string): string {
  if (value === "." || value === "..") {
    throw new TypeError(`${label} must not be a dot-only URL path segment`);
  }
  return encodeURIComponent(value);
}

/** Stabilize semantically equal inline header objects across hook renders. */
export function useStableWorkflowHeaders(headers?: HeadersInit): Headers {
  const key = JSON.stringify(
    [...new Headers(headers).entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  return useMemo(() => new Headers(JSON.parse(key) as Array<[string, string]>), [key]);
}

/** Add the double-submit token to browser workflow mutations in every environment. */
export function workflowMutationHeaders(requestUrl: string | URL, init?: HeadersInit): Headers {
  return csrfMutationHeaders(requestUrl, { headers: init });
}

/** Replace any caller media type with the JSON type used by workflow mutations. */
export function workflowJsonMutationHeaders(
  requestUrl: string | URL,
  init?: HeadersInit,
): Headers {
  const headers = new Headers(init);
  headers.set("Content-Type", "application/json");
  return workflowMutationHeaders(requestUrl, headers);
}
