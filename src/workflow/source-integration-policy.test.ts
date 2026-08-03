import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { requireWorkflowSourceIntegrationPolicy } from "./source-integration-policy.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";

describe("workflow source integration policy snapshots", () => {
  it("returns a deterministic canonical copy of a valid snapshot", () => {
    const snapshot: SourceIntegrationPolicyManifest = {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        github: { allowedToolIds: null },
        confluence: { allowedToolIds: ["search_content", "get_page"] },
      },
    };

    assertEquals(
      requireWorkflowSourceIntegrationPolicy({
        id: "run-valid-policy",
        sourceIntegrationPolicy: snapshot,
      }),
      {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: {
          confluence: { allowedToolIds: ["get_page", "search_content"] },
          github: { allowedToolIds: null },
        },
      },
    );
  });

  it("rejects a malformed snapshot instead of normalizing it to deny-all", () => {
    const malformedSnapshot = {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        confluence: { allowedToolIds: ["get_page", "get_page"] },
      },
    } as unknown as SourceIntegrationPolicyManifest;

    assertThrows(
      () =>
        requireWorkflowSourceIntegrationPolicy({
          id: "run-malformed-policy",
          sourceIntegrationPolicy: malformedSnapshot,
        }),
      Error,
      "invalid source integration policy snapshot",
    );
  });
});
