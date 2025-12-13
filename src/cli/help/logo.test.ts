import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("logo", () => {
  describe("showAsciiLogo", () => {
    it("should export showAsciiLogo function", async () => {
      const module = await import("./logo.ts");
      assertExists(module.showAsciiLogo);
      assertEquals(typeof module.showAsciiLogo, "function");
    });
  });
});
