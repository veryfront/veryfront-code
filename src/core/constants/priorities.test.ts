import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  PRIORITY_CRITICAL,
  PRIORITY_VERY_HIGH,
  PRIORITY_HIGH,
  PRIORITY_HIGH_CLIENT_LOG,
  PRIORITY_HIGH_DEV,
  PRIORITY_MEDIUM_DEV_FILES,
  PRIORITY_MEDIUM_STATIC,
  PRIORITY_MEDIUM_LIB_MODULES,
  PRIORITY_MEDIUM,
  PRIORITY_MEDIUM_API,
  PRIORITY_LOW,
  PRIORITY_FALLBACK,
  HANDLER_PRIORITIES,
} from "./priorities.ts";

describe("constants/priorities", () => {
  describe("individual priority constants", () => {
    it("should have correct priority values", () => {
      assertEquals(PRIORITY_CRITICAL, 0);
      assertEquals(PRIORITY_VERY_HIGH, 50);
      assertEquals(PRIORITY_HIGH, 100);
      assertEquals(PRIORITY_HIGH_CLIENT_LOG, 200);
      assertEquals(PRIORITY_HIGH_DEV, 300);
      assertEquals(PRIORITY_MEDIUM_DEV_FILES, 400);
      assertEquals(PRIORITY_MEDIUM_STATIC, 500);
      assertEquals(PRIORITY_MEDIUM_LIB_MODULES, 550);
      assertEquals(PRIORITY_MEDIUM, 600);
      assertEquals(PRIORITY_MEDIUM_API, 700);
      assertEquals(PRIORITY_LOW, 1000);
      assertEquals(PRIORITY_FALLBACK, 10000);
    });

    it("should be in ascending order", () => {
      assert(PRIORITY_VERY_HIGH > PRIORITY_CRITICAL);
      assert(PRIORITY_HIGH > PRIORITY_VERY_HIGH);
      assert(PRIORITY_HIGH_CLIENT_LOG > PRIORITY_HIGH);
      assert(PRIORITY_HIGH_DEV > PRIORITY_HIGH_CLIENT_LOG);
      assert(PRIORITY_MEDIUM_DEV_FILES > PRIORITY_HIGH_DEV);
      assert(PRIORITY_MEDIUM_STATIC > PRIORITY_MEDIUM_DEV_FILES);
      assert(PRIORITY_MEDIUM_LIB_MODULES > PRIORITY_MEDIUM_STATIC);
      assert(PRIORITY_MEDIUM > PRIORITY_MEDIUM_LIB_MODULES);
      assert(PRIORITY_MEDIUM_API > PRIORITY_MEDIUM);
      assert(PRIORITY_LOW > PRIORITY_MEDIUM_API);
      assert(PRIORITY_FALLBACK > PRIORITY_LOW);
    });

    it("should have critical as lowest value (highest priority)", () => {
      assertEquals(PRIORITY_CRITICAL, 0);
    });

    it("should have fallback as highest value (lowest priority)", () => {
      assertEquals(PRIORITY_FALLBACK, 10000);
    });
  });

  describe("HANDLER_PRIORITIES object", () => {
    it("should contain all priority constants", () => {
      assertEquals(HANDLER_PRIORITIES.CRITICAL, PRIORITY_CRITICAL);
      assertEquals(HANDLER_PRIORITIES.VERY_HIGH, PRIORITY_VERY_HIGH);
      assertEquals(HANDLER_PRIORITIES.HIGH, PRIORITY_HIGH);
      assertEquals(HANDLER_PRIORITIES.HIGH_CLIENT_LOG, PRIORITY_HIGH_CLIENT_LOG);
      assertEquals(HANDLER_PRIORITIES.HIGH_DEV, PRIORITY_HIGH_DEV);
      assertEquals(HANDLER_PRIORITIES.MEDIUM_DEV_FILES, PRIORITY_MEDIUM_DEV_FILES);
      assertEquals(HANDLER_PRIORITIES.MEDIUM_STATIC, PRIORITY_MEDIUM_STATIC);
      assertEquals(HANDLER_PRIORITIES.MEDIUM_LIB_MODULES, PRIORITY_MEDIUM_LIB_MODULES);
      assertEquals(HANDLER_PRIORITIES.MEDIUM, PRIORITY_MEDIUM);
      assertEquals(HANDLER_PRIORITIES.MEDIUM_API, PRIORITY_MEDIUM_API);
      assertEquals(HANDLER_PRIORITIES.LOW, PRIORITY_LOW);
      assertEquals(HANDLER_PRIORITIES.FALLBACK, PRIORITY_FALLBACK);
    });

    it("should have 12 priority levels", () => {
      const keys = Object.keys(HANDLER_PRIORITIES);
      assertEquals(keys.length, 12);
    });

    it("should have all numeric values", () => {
      for (const key in HANDLER_PRIORITIES) {
        const value = HANDLER_PRIORITIES[key as keyof typeof HANDLER_PRIORITIES];
        assertEquals(typeof value, "number");
        assert(Number.isInteger(value));
      }
    });
  });

  describe("priority ranges", () => {
    it("should have high priorities in 0-300 range", () => {
      assert(PRIORITY_CRITICAL >= 0 && PRIORITY_CRITICAL <= 300);
      assert(PRIORITY_VERY_HIGH >= 0 && PRIORITY_VERY_HIGH <= 300);
      assert(PRIORITY_HIGH >= 0 && PRIORITY_HIGH <= 300);
      assert(PRIORITY_HIGH_CLIENT_LOG >= 0 && PRIORITY_HIGH_CLIENT_LOG <= 300);
      assert(PRIORITY_HIGH_DEV >= 0 && PRIORITY_HIGH_DEV <= 300);
    });

    it("should have medium priorities in 400-700 range", () => {
      assert(PRIORITY_MEDIUM_DEV_FILES >= 400 && PRIORITY_MEDIUM_DEV_FILES <= 700);
      assert(PRIORITY_MEDIUM_STATIC >= 400 && PRIORITY_MEDIUM_STATIC <= 700);
      assert(PRIORITY_MEDIUM_LIB_MODULES >= 400 && PRIORITY_MEDIUM_LIB_MODULES <= 700);
      assert(PRIORITY_MEDIUM >= 400 && PRIORITY_MEDIUM <= 700);
      assert(PRIORITY_MEDIUM_API >= 400 && PRIORITY_MEDIUM_API <= 700);
    });

    it("should have low priority above 1000", () => {
      assert(PRIORITY_LOW >= 1000);
    });

    it("should have fallback priority significantly higher than others", () => {
      assert(PRIORITY_FALLBACK > PRIORITY_LOW * 5);
    });
  });

  describe("priority spacing", () => {
    it("should have consistent spacing in high range", () => {
      assertEquals(PRIORITY_HIGH - PRIORITY_VERY_HIGH, 50);
      assertEquals(PRIORITY_HIGH_CLIENT_LOG - PRIORITY_HIGH, 100);
      assertEquals(PRIORITY_HIGH_DEV - PRIORITY_HIGH_CLIENT_LOG, 100);
    });

    it("should have consistent spacing in medium range", () => {
      assertEquals(PRIORITY_MEDIUM_DEV_FILES - PRIORITY_HIGH_DEV, 100);
      assertEquals(PRIORITY_MEDIUM_STATIC - PRIORITY_MEDIUM_DEV_FILES, 100);
    });
  });
});
