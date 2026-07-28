import "#veryfront/schemas/_test-setup.ts";
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
      it("should load the required pinned compiler", async () => {
        const strategy = new LightningCSSStrategy();
        const result = await strategy.init();
        assertEquals(result, true);
        assertEquals(strategy.isAvailable(), true);
      });

      it("should not re-initialize on subsequent calls", async () => {
        const strategy = new LightningCSSStrategy();
        const first = await strategy.init();
        const second = await strategy.init();
        assertEquals(first, second);
      });

      it("should fail closed and coalesce a missing dependency", async () => {
        let attempts = 0;
        const strategy = new LightningCSSStrategy(() => {
          attempts++;
          return Promise.reject(new Error("unavailable"));
        });
        const [first, second] = await Promise.allSettled([
          strategy.init(),
          strategy.init(),
        ]);
        assertEquals(first.status, "rejected");
        assertEquals(second.status, "rejected");
        assertEquals(attempts, 1);
        await assertRejects(() => strategy.init());
        assertEquals(attempts, 2);
      });
    });

    it("should generate the requested source map", async () => {
      const strategy = new LightningCSSStrategy();
      await strategy.init();
      const result = await strategy.process(
        ".field { user-select: none; }",
        "field.css",
        {
          browsers: ["ie 11"],
          autoprefixer: true,
          sourceMap: true,
        },
      );
      assertEquals(result.code.includes("-ms-user-select"), true);
      assertEquals(JSON.parse(result.sourceMap!).version, 3);
    });
  });
});
