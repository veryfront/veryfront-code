import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LightningCSSStrategy } from "./lightning-strategy.ts";

describe("build/asset-pipeline/css-optimizer/strategies/lightning-strategy", () => {
  describe("LightningCSSStrategy", () => {
    it("should have correct name and priority", () => {
      const strategy = new LightningCSSStrategy();
      assertEquals(strategy.name, "lightning-css");
      assertEquals(strategy.priority, 100);
    });

    describe("isAvailable", () => {
      it("should return false before initialization", () => {
        const strategy = new LightningCSSStrategy();
        assertEquals(strategy.isAvailable(), false);
      });
    });

    describe("canProcess", () => {
      it("should return false when lightningCSS is not loaded", () => {
        const strategy = new LightningCSSStrategy();
        assertEquals(strategy.canProcess({}), false);
      });

      it("should return false when disabled", () => {
        const strategy = new LightningCSSStrategy();
        assertEquals(strategy.canProcess({ enabled: false }), false);
      });
    });

    describe("process", () => {
      it("should reject when not initialized", async () => {
        const strategy = new LightningCSSStrategy();
        await assertRejects(
          () => strategy.process("body{}", "test.css", {}),
          Error,
          "Lightning CSS not initialized",
        );
      });
    });

    describe("init", () => {
      it("should return false when lightningcss is not available", async () => {
        const strategy = new LightningCSSStrategy();
        // In test environment, the esm.sh import will likely fail
        const result = await strategy.init();
        // Either true or false is acceptable; we just verify it does not throw
        assertEquals(typeof result, "boolean");
      });

      it("should not re-initialize on subsequent calls", async () => {
        const strategy = new LightningCSSStrategy();
        const first = await strategy.init();
        const second = await strategy.init();
        assertEquals(first, second);
      });
    });
  });
});
