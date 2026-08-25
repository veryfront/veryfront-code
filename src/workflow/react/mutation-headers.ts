import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";
import { useMemo } from "react";

/** Remove trailing slashes so hook routes contain one separator per segment. */
export function normalizeWorkflowApiBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

/** Stabilize semantically equal inline header objects across hook renders. */
export function useStableWorkflowHeaders(headers?: HeadersInit): Headers {
  const key = JSON.stringify(
    [...new Headers(headers).entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  return useMemo(() => new Headers(JSON.parse(key) as Array<[string, string]>), [key]);
}

/** Add the production double-submit token to browser workflow mutations. */
export function workflowMutationHeaders(requestUrl: string | URL, init?: HeadersInit): Headers {
  return csrfMutationHeaders(requestUrl, { headers: init });
}
