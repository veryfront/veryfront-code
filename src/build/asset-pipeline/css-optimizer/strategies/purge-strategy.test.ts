import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type CSSPurgingEngine, CSSPurgingEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { createTestCSSPurgingEngine } from "../../../../../tests/_helpers/css-purging-engine.ts";
import { PurgeStrategy } from "./purge-strategy.ts";

describe("build/asset-pipeline/css-optimizer/strategies/purge-strategy", () => {
  let previous: CSSPurgingEngine | undefined;
  beforeEach(() => {
    previous = tryResolve<CSSPurgingEngine>(CSSPurgingEngineName);
    unregister(CSSPurgingEngineName);
    register(CSSPurgingEngineName, createTestCSSPurgingEngine());
  });
  afterEach(() => {
    unregister(CSSPurgingEngineName);
    if (previous !== undefined) register(CSSPurgingEngineName, previous);
  });

  describe("PurgeStrategy", () => {
    it("should have correct name and priority", () => {
      const strategy = new PurgeStrategy();
      assertEquals(strategy.name, "purge-css");
      assertEquals(strategy.priority, 50);
    });

    describe("canProcess", () => {
      it("should return true when enabled and purge is true", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.canProcess({ enabled: true, purge: true }), true);
      });

      it("should return true when purge is true and enabled is not set", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.canProcess({ purge: true }), true);
      });

      it("should return false when purge is false", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.canProcess({ purge: false }), false);
      });

      it("should return false when disabled", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.canProcess({ enabled: false, purge: true }), false);
      });

      it("should return false when purge is not set", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.canProcess({}), false);
      });
    });

    describe("getUsedSelectors / clearCache", () => {
      it("should start with empty used selectors", () => {
        const strategy = new PurgeStrategy();
        assertEquals(strategy.getUsedSelectors().size, 0);
      });

      it("should clear used selectors cache", () => {
        const strategy = new PurgeStrategy();
        strategy.getUsedSelectors().add(".test-class");

        assertEquals(strategy.getUsedSelectors().size, 1);

        strategy.clearCache();

        assertEquals(strategy.getUsedSelectors().size, 0);
      });
    });

    describe("process", () => {
      it("should process CSS when used selectors are pre-populated", async () => {
        const strategy = new PurgeStrategy();
        strategy.getUsedSelectors().add(".used-class");

        const css = `.used-class { color: red; }
.unused-class { color: blue; }`;

        const result = await strategy.process(css, "test.css", {});

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

        const result = await strategy.process(css, "test.css", {});

        assertEquals(result.code.includes("body"), true);
        assertEquals(result.code.includes(".keep"), true);
        assertEquals(result.code.includes(".remove"), false);
      });

      it("should preserve nested at-rules while removing unused rules", async () => {
        const strategy = new PurgeStrategy();
        strategy.getUsedSelectors().add(".keep");
        const result = await strategy.process(
          "@media (min-width: 40rem) { .keep { display: block; } .remove { display: none; } }",
          "test.css",
          {},
        );
        assertEquals(result.code.includes("@media"), true);
        assertEquals(result.code.includes(".keep"), true);
        assertEquals(result.code.includes(".remove"), false);
      });

      it("normalizes selector-form safelist entries", async () => {
        const strategy = new PurgeStrategy();
        strategy.getUsedSelectors().add(".used");
        const result = await strategy.process(
          ".used { color: green; } .dynamic { color: blue; } .remove { color: red; }",
          "test.css",
          { purgeSafelist: [".dynamic"] },
        );
        assertEquals(result.code.includes(".dynamic"), true);
        assertEquals(result.code.includes(".remove"), false);
      });

      it("should reject missing purge evidence", async () => {
        const strategy = new PurgeStrategy();
        await assertRejects(
          () => strategy.process(".x {}", "test.css", {}),
          TypeError,
          "requires non-empty",
        );
      });

      it("fails clearly when no CSS purging extension is registered", async () => {
        unregister(CSSPurgingEngineName);
        const strategy = new PurgeStrategy();
        strategy.getUsedSelectors().add(".used");
        await assertRejects(
          () => strategy.process(".used {}", "test.css", {}),
          Error,
          'Missing extension for contract "CSSPurgingEngine"',
        );
      });

      it("validates injected content and mutable selector evidence", async () => {
        const malformedContent = new PurgeStrategy({
          collectContent: () =>
            Promise.resolve([{
              path: "page.tsx",
              raw: "<div />",
              extension: "../tsx",
            }]),
        });
        await assertRejects(
          () => malformedContent.analyzeContent(["app/**/*.tsx"]),
          TypeError,
          "source is malformed",
        );

        const mutatedSelectors = new PurgeStrategy();
        mutatedSelectors.getUsedSelectors().add("bad\nselector");
        await assertRejects(
          () => mutatedSelectors.process(".bad {}", "test.css", {}),
          TypeError,
          "unsafe token",
        );
      });
    });
  });
});
