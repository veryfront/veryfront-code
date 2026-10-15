import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { sanitizeProviderToolSchema } from "#veryfront/agent/runtime/provider-tool-compat.ts";

it("intersects large required lists in linear time", () => {
  const required = Array.from({ length: 49_000 }, (_, index) => `field${index}`);
  const originalHas = Set.prototype.has;
  const originalIncludes = Array.prototype.includes;
  let membershipChecks = 0;
  let linearScanEntries = 0;
  Set.prototype.has = function (value) {
    if (typeof value === "string" && value.startsWith("field")) membershipChecks++;
    return originalHas.call(this, value);
  };
  Array.prototype.includes = function (value, fromIndex) {
    if (typeof value === "string" && value.startsWith("field")) {
      linearScanEntries += this.length;
    }
    return originalIncludes.call(this, value, fromIndex);
  };
  try {
    const result = sanitizeProviderToolSchema(
      { type: "object", anyOf: [{ required }, { required: [...required].reverse() }] } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.required, required);
    // Count work instead of elapsed time: coverage and shared runners change timing.
    assertEquals(membershipChecks > 0 && membershipChecks <= 2 * required.length, true);
    assertEquals(linearScanEntries, 0);
  } finally {
    Set.prototype.has = originalHas;
    Array.prototype.includes = originalIncludes;
  }
});
