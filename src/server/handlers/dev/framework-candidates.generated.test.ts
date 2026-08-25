import "#veryfront/schemas/_test-setup.ts";
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

  it("includes adapter-backed UI state and surface candidates", () => {
    const candidates = new Set(FRAMEWORK_CANDIDATES);

    assertEquals(candidates.has("data-[state=on]:bg-[var(--secondary)]"), true);
    assertEquals(candidates.has("pointer-events-none"), true);
    assertEquals(candidates.has("divide-[var(--separator)]"), true);
    assertEquals(candidates.has("w-[calc(100%_-_3rem)]"), true);
    assertEquals(candidates.has("w-[calc(100%-3rem)]"), false);
  });
});
