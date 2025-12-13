import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("command-help", () => {
  describe("showCommandHelp", () => {
    it("should export showCommandHelp function", async () => {
      const module = await import("./command-help.ts");
      assertExists(module.showCommandHelp);
      assertEquals(typeof module.showCommandHelp, "function");
    });
  });
});
