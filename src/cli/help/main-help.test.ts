import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("main-help", () => {
  describe("showMainHelp", () => {
    it("should export showMainHelp function", async () => {
      const module = await import("./main-help.ts");
      assertExists(module.showMainHelp);
      assertEquals(typeof module.showMainHelp, "function");
    });
  });
});
