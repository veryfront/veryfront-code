import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type IntegrationSelectedReadiness, isSelectedReadiness } from "./readiness.ts";

const expected = {
  projectId: "11111111-1111-4111-8111-111111111111",
  integration: "github",
  toolName: "github__get_current_user",
  connectionId: "22222222-2222-4222-8222-222222222222",
  generation: "33333333-3333-4333-8333-333333333333",
};

function recordedReadiness(scope: "user" | "project"): IntegrationSelectedReadiness {
  return {
    version: 1,
    selection: {
      project_id: expected.projectId,
      integration: expected.integration,
      tool_name: expected.toolName,
      requested_connection_id: expected.connectionId,
      state: "selected",
      mode: "oauth_connection",
      scope,
      connection_id: expected.connectionId,
      connection_generation_id: expected.generation,
    },
    connection: { state: "connected" },
    account: {
      state: "recorded",
      id: "synthetic-provider-account",
      display_name: "Test account",
      evidence: "stored_metadata",
    },
    credentials: { evidence: "connection_metadata", missing_keys: [] },
    local_eligibility: {
      state: "eligible",
      basis: "metadata_only",
      required_capability: "project.integrations.read",
      blockers: [],
      pending_checks: ["provider_authorization"],
    },
    provider_verification: { state: "not_checked" },
  };
}

describe("recorded readiness account validation", () => {
  for (const scope of ["user", "project"] as const) {
    it(`accepts stored account metadata bound to a ${scope} selection`, () => {
      assertEquals(isSelectedReadiness(recordedReadiness(scope), expected), true);
    });

    it(`rejects a recorded ${scope} account without stored provenance`, () => {
      const response = recordedReadiness(scope);
      response.account.evidence = "none";
      assertEquals(isSelectedReadiness(response, expected), false);
    });
  }

  it("rejects recorded identity when the selection has no account scope", () => {
    const response = recordedReadiness("user");
    response.selection.state = "unavailable";
    response.selection.mode = "unknown";
    response.selection.scope = null;
    response.selection.connection_id = null;
    response.selection.connection_generation_id = null;
    response.connection.state = "unknown";
    response.local_eligibility.state = "blocked";
    response.local_eligibility.blockers = ["connection_unavailable"];
    assertEquals(isSelectedReadiness(response, expected), false);

    response.account = { state: "unknown", id: null, display_name: null, evidence: "none" };
    assertEquals(isSelectedReadiness(response, expected), true);
  });
});
