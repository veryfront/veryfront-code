// Mutates global String.prototype methods, so it belongs in the semantic
// integration suite rather than a hermetic unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isInternalEgressOverrideEnabled } from "#veryfront/security/sandbox/worker-egress-guard.ts";

describe("worker-egress-guard isInternalEgressOverrideEnabled prototype-poisoning boundary", () => {
  it(
    "is not fooled by a poisoned String.prototype.trim into treating a non-enabling value as enabled",
    () => {
      const originalTrim = String.prototype.trim;
      // deno-lint-ignore no-explicit-any
      (String.prototype as any).trim = function () {
        return "true";
      };
      try {
        assertEquals(isInternalEgressOverrideEnabled("false"), false);
      } finally {
        String.prototype.trim = originalTrim;
      }
    },
  );

  it(
    "is not fooled by a poisoned String.prototype.toLowerCase into treating a non-enabling value as enabled",
    () => {
      const originalToLowerCase = String.prototype.toLowerCase;
      // deno-lint-ignore no-explicit-any
      (String.prototype as any).toLowerCase = function () {
        return "true";
      };
      try {
        assertEquals(isInternalEgressOverrideEnabled("FALSE"), false);
      } finally {
        String.prototype.toLowerCase = originalToLowerCase;
      }
    },
  );
});
