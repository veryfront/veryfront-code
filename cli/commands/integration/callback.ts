import type { LoopbackCallbackResponse } from "../../shared/loopback-callback-server.ts";

export type IntegrationCallback = { status: "received" | "denied" | "provider_error" };
export interface IntegrationCallbackIdentity {
  nonce: string;
  integration: string;
  projectId: string;
  scope: "user" | "project";
}
function one(url: URL, key: string, expected: string): boolean {
  const values = url.searchParams.getAll(key);
  return values.length === 1 && values[0] === expected;
}
function reply(valid: boolean): Response {
  return new Response(
    valid
      ? "Connection callback received. Return to the terminal for verification."
      : "This callback does not match the current connection attempt.",
    { status: valid ? 200 : 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
export function createIntegrationCallbackHandler(
  expected: IntegrationCallbackIdentity,
): (url: URL, headers: Headers) => LoopbackCallbackResponse<IntegrationCallback> {
  return (url, headers) => {
    const origin = headers.get("origin");
    if (
      (origin && origin !== url.origin) || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !one(url, "state", expected.nonce) || !one(url, "integration", expected.integration) ||
      !one(url, "project_id", expected.projectId) || !one(url, "scope", expected.scope)
    ) return { response: reply(false) };
    const errors = url.searchParams.getAll("oauth_error");
    if (errors.length === 1 && !url.searchParams.has("oauth_connected")) {
      return {
        response: reply(true),
        result: { status: errors[0] === "access_denied" ? "denied" : "provider_error" },
      };
    }
    if (errors.length === 0 && one(url, "oauth_connected", expected.integration)) {
      return { response: reply(true), result: { status: "received" } };
    }
    return { response: reply(false) };
  };
}
