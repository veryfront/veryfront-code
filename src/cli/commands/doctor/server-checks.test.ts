import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("server-checks", () => {
  describe("checkRSCFlag", () => {
    it("should export checkRSCFlag function", async () => {
      const module = await import("./server-checks.ts");
      assertExists(module.checkRSCFlag);
      assertEquals(typeof module.checkRSCFlag, "function");
    });
  });

  describe("checkRSCEndpoints", () => {
    it("should export checkRSCEndpoints function", async () => {
      const module = await import("./server-checks.ts");
      assertExists(module.checkRSCEndpoints);
      assertEquals(typeof module.checkRSCEndpoints, "function");
    });
  });

  describe("checkRSCCounters", () => {
    it("should export checkRSCCounters function", async () => {
      const module = await import("./server-checks.ts");
      assertExists(module.checkRSCCounters);
      assertEquals(typeof module.checkRSCCounters, "function");
    });
  });

  describe("check functions return types", () => {
    it("checkRSCFlag should return DiagnosticResult", async () => {
      const module = await import("./server-checks.ts");
      const result = await module.checkRSCFlag();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
    });

    it("checkRSCCounters should return DiagnosticResult", async () => {
      const module = await import("./server-checks.ts");
      const result = await module.checkRSCCounters();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
    });
  });
});
