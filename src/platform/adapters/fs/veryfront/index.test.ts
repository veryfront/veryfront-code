import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("fs/veryfront/index.ts exports", () => {
  it("should export VeryfrontFSAdapter", async () => {
    const mod = await import("./index.ts");
    assertExists(mod.VeryfrontFSAdapter);
    assertEquals(typeof mod.VeryfrontFSAdapter, "function");
  });
});
