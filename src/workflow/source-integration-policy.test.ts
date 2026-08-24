import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureWorkflowSourceIntegrationPolicy,
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "./source-integration-policy.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";

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
      VeryfrontError,
      "invalid source integration policy snapshot",
    );
  });

  it("captures the default and active policies by value", () => {
    assertEquals(captureWorkflowSourceIntegrationPolicy(), {
      schemaVersion: 1,
      mode: "unrestricted",
    });

    const active = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    const captured = runWithExactSourceIntegrationPolicy(
      active,
      captureWorkflowSourceIntegrationPolicy,
    );
    assertEquals(captured, active);
    assertEquals(captured === active, false);
  });

  it("requires an explicit snapshot without invoking run accessors", () => {
    assertThrows(
      () =>
        requireWorkflowSourceIntegrationPolicy({
          id: "missing",
          sourceIntegrationPolicy: undefined,
        } as never),
      VeryfrontError,
      "missing its source integration policy snapshot",
    );

    let getterCalls = 0;
    const run = Object.defineProperty({ id: "accessor" }, "sourceIntegrationPolicy", {
      enumerable: true,
      get() {
        getterCalls++;
        return normalizeSourceIntegrationPolicy(undefined);
      },
    });
    assertThrows(
      () => requireWorkflowSourceIntegrationPolicy(run as never),
      VeryfrontError,
      "invalid source integration policy snapshot",
    );
    assertEquals(getterCalls, 0);
  });

  it("restores a run snapshot without widening an active restriction", () => {
    const active = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    const wider = normalizeSourceIntegrationPolicy({ allow: { github: {} } });

    const observed = runWithExactSourceIntegrationPolicy(
      active,
      () =>
        runWithWorkflowSourceIntegrationPolicy(
          { id: "run", sourceIntegrationPolicy: wider },
          getActiveSourceIntegrationPolicy,
        ),
    );

    assertEquals(observed, active);
  });
});
