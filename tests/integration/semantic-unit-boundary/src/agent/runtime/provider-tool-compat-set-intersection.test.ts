import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { sanitizeProviderToolSchema } from "#veryfront/agent/runtime/provider-tool-compat.ts";

it("intersects large required lists with one Set lookup per name", () => {
  const required = Array.from({ length: 49_000 }, (_, index) => `field${index}`);
  const NativeSet = globalThis.Set;
  let membershipChecks = 0;
  class ObservedSet<T> extends NativeSet<T> {
    override has(value: T): boolean {
      if (this.size === required.length) membershipChecks++;
      return super.has(value);
    }
  }
  try {
    globalThis.Set = ObservedSet;
    const result = sanitizeProviderToolSchema(
      { type: "object", anyOf: [{ required }, { required: [...required].reverse() }] } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.required, required);
    // The reverse-ordered intersection must perform exactly one constant-time
    // lookup per name. Timing the full bounded snapshot also measured machine load.
    assertEquals(membershipChecks, required.length);
  } finally {
    globalThis.Set = NativeSet;
  }
});
