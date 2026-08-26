import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";

/** Add the double-submit token to browser workflow mutations in every environment. */
export function workflowMutationHeaders(requestUrl: string | URL, init?: HeadersInit): Headers {
  return csrfMutationHeaders(requestUrl, { headers: init });
}
