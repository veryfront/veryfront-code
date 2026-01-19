import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

describe("fs/veryfront/index.ts exports", () => {
  it("should export VeryfrontFSAdapter", async () => {
    const { VeryfrontFSAdapter } = await import("./index.ts");
    assertExists(VeryfrontFSAdapter);
    assertEquals(typeof VeryfrontFSAdapter, "function");
  });
});
