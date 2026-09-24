import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createIntegrationCallbackHandler } from "./callback.ts";

const expected = {
  nonce: "synthetic-nonce",
  integration: "github",
  projectId: "project-1",
  scope: "user" as const,
};
function callback(query: Record<string, string>) {
  return new URL(
    `http://127.0.0.1:9876/callback?${new URLSearchParams({
      state: expected.nonce,
      integration: expected.integration,
      project_id: expected.projectId,
      scope: expected.scope,
      oauth_connected: expected.integration,
      ...query,
    })}`,
  );
}
describe("integration callback correlation", () => {
  it("matches nonce, integration, project, and scope before completing", () => {
    const handle = createIntegrationCallbackHandler(expected);
    assertEquals(handle(callback({}), new Headers()).result, { status: "received" });
    const mismatches: Record<string, string>[] = [
      { state: "old" },
      { integration: "slack" },
      { project_id: "foreign" },
      { scope: "project" },
      { oauth_connected: "slack" },
    ];
    for (const query of mismatches) {
      const result = handle(callback(query), new Headers());
      assertEquals(result.response.status, 400);
      assertEquals("result" in result, false);
    }
  });
  it("rejects duplicated correlation and cross-origin requests without consuming the attempt", () => {
    const handle = createIntegrationCallbackHandler(expected);
    const duplicate = callback({});
    duplicate.searchParams.append("state", expected.nonce);
    assertEquals("result" in handle(duplicate, new Headers()), false);
    assertEquals(
      "result" in handle(callback({}), new Headers({ origin: "https://foreign.example.test" })),
      false,
    );
  });
  it("maps denial without copying provider descriptions or URLs into diagnostics", () => {
    const handle = createIntegrationCallbackHandler(expected);
    const url = callback({
      oauth_error: "access_denied",
      error_description: "synthetic-private-token",
    });
    url.searchParams.delete("oauth_connected");
    const result = handle(url, new Headers());
    assertEquals(result.result, { status: "denied" });
    assertEquals(JSON.stringify(result).includes("synthetic-private-token"), false);
  });
});
