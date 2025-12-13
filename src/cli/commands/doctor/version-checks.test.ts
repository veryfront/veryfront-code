import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("version-checks", () => {
  describe("checkDenoVersion", () => {
    it("should export checkDenoVersion function", async () => {
      const module = await import("./version-checks.ts");
      assertExists(module.checkDenoVersion);
      assertEquals(typeof module.checkDenoVersion, "function");
    });

    it("should return a diagnostic result", async () => {
      const module = await import("./version-checks.ts");
      const result = await module.checkDenoVersion();

      assertExists(result);
      assertEquals(result.name, "Runtime Version");
      assertExists(result.status);
      assertExists(result.message);
    });

    it("should detect runtime version", async () => {
      const module = await import("./version-checks.ts");
      const result = await module.checkDenoVersion();

      // Should detect Deno, Node.js, or Bun
      const validStatuses: Array<"pass" | "warn" | "fail"> = ["pass", "warn", "fail"];
      assertEquals(validStatuses.includes(result.status), true);
    });
  });

  describe("checkReactCompatibility", () => {
    it("should export checkReactCompatibility function", async () => {
      const module = await import("./version-checks.ts");
      assertExists(module.checkReactCompatibility);
      assertEquals(typeof module.checkReactCompatibility, "function");
    });

    it("should return a diagnostic result", async () => {
      const module = await import("./version-checks.ts");
      const result = await module.checkReactCompatibility();

      assertExists(result);
      assertEquals(result.name, "React Compatibility");
      assertExists(result.status);
      assertExists(result.message);
    });
  });
});
