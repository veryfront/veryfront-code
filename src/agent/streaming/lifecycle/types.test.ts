import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { resolveStreamLifecyclePolicy } from "./policy.ts";

describe("stream lifecycle contract", () => {
  it("preserves the approved timeout budgets", () => {
    const policy = resolveStreamLifecyclePolicy();
    assertEquals(policy.firstProgressTimeoutMs, 60_000);
    assertEquals(policy.semanticIdleTimeoutMs, 15_000);
    assertEquals(policy.toolInputIdleTimeoutMs, 15_000);
    assertEquals(policy.toolCommitGraceMs, 250);
    assertEquals(policy.statusIntervalMs, 5_000);
    assertEquals(policy.attemptTimeoutMs, 300_000);
  });

  it("uses a typed error for a second frame consumer", () => {
    assertInstanceOf(
      new StreamAlreadyConsumedError(),
      StreamAlreadyConsumedError,
    );
  });
});
