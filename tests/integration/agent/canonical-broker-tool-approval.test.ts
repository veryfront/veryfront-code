import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { canonicalId, fixture } from "../../fixtures/canonical-managed-broker.ts";

describe("canonical broker approval transport", () => {
  for (const approvalOverride of [false, true]) {
    it(`uses the canonical run and configured private approval transport (override=${approvalOverride})`, async () => {
      await withMockFetch(
        () => Promise.reject(new Error("Unexpected ambient approval transport")),
        async () => {
          const f = await fixture({ probeApproval: true, approvalOverride });
          try {
            const approvals = f.calls.filter((call) =>
              call.url.pathname.endsWith("/input-requests")
            );
            assertEquals(approvals.map((call) => [String(call.url), call.authorization]), [[
              `https://${
                approvalOverride ? "approval" : "api"
              }.example.test/runs/${canonicalId}/input-requests`,
              "Bearer api-auth-token",
            ]]);
          } finally {
            await f.close();
          }
        },
      );
    });
  }
});
