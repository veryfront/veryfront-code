import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Bun dynamic alias resolution", () => {
  it({ name: "settles repeated imports of the same project alias", timeout: 500 }, async () => {
    const first = await import("#veryfront/utils/constants/cdn.ts");
    const second = await import("#veryfront/utils/constants/cdn.ts");

    assertStrictEquals(second, first);
    assertEquals(first.ESM_CDN_BASE, "https://esm.sh");
  });
});
