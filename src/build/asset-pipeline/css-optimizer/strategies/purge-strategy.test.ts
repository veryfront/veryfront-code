import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PurgeStrategy } from "./purge-strategy.ts";
import type { CSSOptimizationOptions } from "../types/index.ts";

describe("build/asset-pipeline/css-optimizer/strategies/purge-strategy", () => {
  describe("PurgeStrategy", () => {
    it("should have correct name and priority", () => {
      const strategy = new PurgeStrategy();
      assertEquals(strategy.name, "purge-css");
      assertEquals(strategy.priority, 50);
    });

    describe("canProcess", () => {
      it("should return true when enabled and purge is true", () => {
        const strategy = new PurgeStrategy();
        assertEquals(
          strategy.canProcess({ enabled: true, purge: true } as CSSOptimizationOptions),
          true,
        );
      });

      it("should return true when purge is true and enabled is not set", () => {
        const strategy = new PurgeStrategy();
        assertEquals(
          strategy.canProcess({ purge: true } as CSSOptimizationOptions),
          true,
        );
      });

      it("should return false when purge is false", () => {
        const strategy = new PurgeStrategy();
        assertEquals(
          strategy.canProcess({ purge: false } as CSSOptimizationOptions),
          false,
        );
      });

      it("should return false when disabled", () => {
        const strategy = new PurgeStrategy();
        assertEquals(
          strategy.canProcess({ enabled: false, purge: true } as CSSOptimizationOptions),
          false,
        );
      });

      it("should return false when purge is not set", () => {
        const strategy = new PurgeStrategy();
        assertEquals(
          strategy.canProcess({} as CSSOptimizationOptions),
          false,
        );
      });
    });

    describe("getUsedSelectors / clearCache", () => {
      it("should start with empty used selectors", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.getUsedSelectors().size, 0);
      });

      it("should clear used selectors cache", () => {
        const strategy = new PurgeStrategy();
        // Manually add some selectors to test clearCache
        strategy.getUsedSelectors().add(".test-class");
        assertEquals(strategy.getUsedSelectors().size, 1);
        strategy.clearCache();
        assertEquals(strategy.getUsedSelectors().size, 0);
      });
    });

    describe("process", () => {
      it("should process CSS when used selectors are pre-populated", async () => {
        const strategy = new PurgeStrategy();
        // Manually populate used selectors
        strategy.getUsedSelectors().add(".used-class");

        const css = `.used-class { color: red; }
.unused-class { color: blue; }`;

        const result = await strategy.process(
          css,
          "test.css",
          {} as CSSOptimizationOptions,
        );

        assertEquals(typeof result.code, "string");
        assertEquals(result.code.includes(".used-class"), true);
        assertEquals(result.code.includes(".unused-class"), false);
        assertEquals(result.sourceMap, undefined);
      });

      it("should keep rules that match any used selector", async () => {
        const strategy = new PurgeStrategy();
        strategy.getUsedSelectors().add("body");
        strategy.getUsedSelectors().add(".keep");

        const css = `body { margin: 0; }
.keep { display: block; }
.remove { display: none; }`;

        const result = await strategy.process(
          css,
          "test.css",
          {} as CSSOptimizationOptions,
        );

        assertEquals(result.code.includes("body"), true);
        assertEquals(result.code.includes(".keep"), true);
        assertEquals(result.code.includes(".remove"), false);
      });
    });
  });
});
