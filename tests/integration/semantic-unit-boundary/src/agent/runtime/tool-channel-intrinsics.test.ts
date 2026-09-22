// Mutates Set.prototype, so it belongs in the semantic integration suite
// rather than a hermetic unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getToolChannelProfile } from "#veryfront/agent/runtime/tool-channel.ts";

describe("tool-channel provider policy intrinsic boundary", () => {
  it("uses the captured Set intrinsic for provider policy lookups", () => {
    const originalHas = Set.prototype.has;
    Object.defineProperty(Set.prototype, "has", {
      configurable: true,
      value: () => true,
    });
    try {
      const profile = getToolChannelProfile("deepseek/deepseek-v3");
      assertEquals(profile.forceByDefault, false);
      assertEquals(profile.recoverTextToolCalls, false);
    } finally {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: originalHas,
      });
    }
  });
});
