import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

describe("fs/veryfront/index.ts exports", () => {
  it("should export VeryfrontFSAdapter", async () => {
    const { VeryfrontFSAdapter } = await import("./index.ts");
    assertExists(VeryfrontFSAdapter);
    assertEquals(typeof VeryfrontFSAdapter, "function");
  });
});
