import { describe, it, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { clearConfigCache } from "./loader.ts";

describe("config/loader", () => {
  afterEach(() => {
    clearConfigCache();
  });

  describe("clearConfigCache", () => {
    it("should be callable without errors", () => {
      clearConfigCache();
      clearConfigCache(); // Should be idempotent
      assertExists(clearConfigCache);
    });

    it("should be a function", () => {
      assertEquals(typeof clearConfigCache, "function");
    });
  });
});
