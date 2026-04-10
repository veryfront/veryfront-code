import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FRAMEWORK_CANDIDATES } from "./framework-candidates.generated.ts";

describe("server/handlers/dev/framework-candidates.generated", () => {
  it("includes chat framework candidates required for preview styling", () => {
    const candidates = new Set(FRAMEWORK_CANDIDATES);

    assertEquals(candidates.has("size-4"), true);
    assertEquals(candidates.has("size-8"), true);
    assertEquals(candidates.has("bg-[#181818]"), true);
  });
});
