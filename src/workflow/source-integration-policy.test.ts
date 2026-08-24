import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "./source-integration-policy.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { WorkflowRun } from "./types.ts";

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

  it("refuses a run whose policy snapshot is missing rather than defaulting to unrestricted", () => {
    const runWithoutPolicy = { id: "run-no-policy" } as unknown as Pick<
      WorkflowRun,
      "id" | "sourceIntegrationPolicy"
    >;

    assertThrows(
      () => requireWorkflowSourceIntegrationPolicy(runWithoutPolicy),
      Error,
      "missing its source integration policy snapshot",
    );

    let ran = false;
    assertThrows(
      () =>
        runWithWorkflowSourceIntegrationPolicy(runWithoutPolicy, () => {
          ran = true;
        }),
      Error,
      "missing its source integration policy snapshot",
    );
    assertEquals(ran, false, "a run with no policy snapshot must not execute");
  });
});
