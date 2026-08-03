import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getActiveSourceIntegrationPolicy,
  resolveEffectiveSourceIntegrationPolicy,
  runWithEffectiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "./source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "./source-policy.ts";

describe("source integration policy context", () => {
  it("isolates concurrent exact-source policies", async () => {
    const gmail = normalizeSourceIntegrationPolicy({ allow: { gmail: {} } });
    const github = normalizeSourceIntegrationPolicy({ allow: { github: {} } });

    const [left, right] = await Promise.all([
      runWithExactSourceIntegrationPolicy(gmail, async () => {
        await Promise.resolve();
        return getActiveSourceIntegrationPolicy();
      }),
      runWithExactSourceIntegrationPolicy(github, async () => {
        await Promise.resolve();
        return getActiveSourceIntegrationPolicy();
      }),
    ]);

    assertEquals(left, gmail);
    assertEquals(right, github);
    assertEquals(getActiveSourceIntegrationPolicy(), undefined);
  });

  it("lets an exact nested source replace its outer source while intersecting runtime policy", () => {
    const outer = normalizeSourceIntegrationPolicy({ allow: { gmail: {} } });
    const exactNested = normalizeSourceIntegrationPolicy(undefined);
    const runtimeBoundary = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });

    const effective = runWithExactSourceIntegrationPolicy(
      outer,
      () =>
        runWithExactSourceIntegrationPolicy(
          exactNested,
          () => resolveEffectiveSourceIntegrationPolicy(runtimeBoundary),
        ),
    );

    assertEquals(effective, runtimeBoundary);
  });

  it("fails malformed explicit boundary state closed before intersecting it", () => {
    const ambient = normalizeSourceIntegrationPolicy({ allow: { gmail: {} } });

    const effective = runWithExactSourceIntegrationPolicy(
      ambient,
      () => resolveEffectiveSourceIntegrationPolicy({ schemaVersion: 2 }),
    );

    assertEquals(effective, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {},
    });
  });

  it("never lets a nested source-bound operation widen the active restriction", () => {
    const ambient = normalizeSourceIntegrationPolicy({
      allow: { gmail: { allowedTools: ["list_emails"] } },
    });
    const widerBoundPolicy = normalizeSourceIntegrationPolicy({ allow: { gmail: {} } });

    const observed = runWithExactSourceIntegrationPolicy(
      ambient,
      () =>
        runWithEffectiveSourceIntegrationPolicy(
          widerBoundPolicy,
          getActiveSourceIntegrationPolicy,
        ),
    );

    assertEquals(observed, ambient);
  });
});
