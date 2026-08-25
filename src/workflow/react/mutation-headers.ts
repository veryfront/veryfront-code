import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";

/** Add the production double-submit token to browser workflow mutations. */
export function workflowMutationHeaders(requestUrl: string | URL, init?: HeadersInit): Headers {
  return csrfMutationHeaders(requestUrl, { headers: init });
}
