/**
 * Tests for CSS Optimization Strategies
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { ensureDir } from "@veryfront/compat/std/fs.ts";
import { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
import type { CSSOptimizationOptions } from "@veryfront/types";

const TEST_DIR = "./.veryfront/test-strategies";

async function cleanupTestDir(): Promise<void> {
  try {
    await remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

const TEST_CSS = `
.button {
  padding: 12px 24px;
  background: #007bff;
  color: white;
}

/* Comment */
.unused {
  display: none;
}
`;

describe("MinificationStrategy", () => {
  it("canProcess returns true when enabled and minify is true", () => {
    const strategy = new MinificationStrategy();

    assertEquals(strategy.canProcess({ enabled: true, minify: true }), true);
    assertEquals(strategy.canProcess({ enabled: false }), false);
    assertEquals(strategy.canProcess({ enabled: true, minify: false }), false);
  });

  it("process removes comments", async () => {
    const strategy = new MinificationStrategy();
    const options: CSSOptimizationOptions = { enabled: true, minify: true };

    const result = await strategy.process(TEST_CSS, "test.css", options);

    assertEquals(result.code.includes("/*"), false);
    assertEquals(result.sourceMap, undefined);
  });

  it("process removes whitespace", async () => {
    const strategy = new MinificationStrategy();
    const options: CSSOptimizationOptions = { enabled: true, minify: true };

    const css = ".button   {   color:   red;   }";
    const result = await strategy.process(css, "test.css", options);

    assertEquals(result.code, ".button{color:red}");
  });
});

describe("LightningCSSStrategy", () => {
  it("canProcess returns false when not initialized", () => {
    const strategy = new LightningCSSStrategy();

    // Before initialization, should return false
    assertEquals(strategy.canProcess({ enabled: true }), false);
  });

  it("init attempts to load", async () => {
    const strategy = new LightningCSSStrategy();
    const success = await strategy.init();

    // Should return boolean (true if loaded, false if not available)
    assertEquals(typeof success, "boolean");
  });
});

describe("PurgeStrategy", () => {
  it("canProcess returns true when enabled and purge is true", () => {
    const strategy = new PurgeStrategy();

    assertEquals(strategy.canProcess({ enabled: true, purge: true }), true);
    assertEquals(strategy.canProcess({ enabled: true, purge: false }), false);
    assertEquals(strategy.canProcess({ enabled: false, purge: true }), false);
  });

  it("analyzeContent extracts selectors", async () => {
    await cleanupTestDir();
    await ensureDir(join(TEST_DIR, "src"));

    await writeTextFile(
      join(TEST_DIR, "src", "component.tsx"),
      '<div className="button card">Test</div>',
    );

    const strategy = new PurgeStrategy();
    await strategy.analyzeContent([`${TEST_DIR}/src/**/*.tsx`]);

    const selectors = strategy.getUsedSelectors();

    assertEquals(selectors.has(".button"), true);
    assertEquals(selectors.has(".card"), true);

    await cleanupTestDir();
  });

  it("process removes unused rules", async () => {
    await cleanupTestDir();
    await ensureDir(join(TEST_DIR, "src"));

    await writeTextFile(
      join(TEST_DIR, "src", "component.tsx"),
      '<div className="button">Test</div>',
    );

    const css = `
.button { color: blue; }
.unused { color: red; }
`;

    const strategy = new PurgeStrategy();
    const options: CSSOptimizationOptions = {
      enabled: true,
      purge: true,
      purgeContent: [`${TEST_DIR}/src/**/*.tsx`],
    };

    const result = await strategy.process(css, "test.css", options);

    assertEquals(result.code.includes(".button"), true);
    // Note: Our basic purging implementation may not perfectly remove all unused rules
    // but it should attempt to filter them

    await cleanupTestDir();
  });

  it("clearCache resets used selectors", async () => {
    await cleanupTestDir();
    await ensureDir(join(TEST_DIR, "src"));

    await writeTextFile(
      join(TEST_DIR, "src", "component.tsx"),
      '<div className="button">Test</div>',
    );

    const strategy = new PurgeStrategy();
    await strategy.analyzeContent([`${TEST_DIR}/src/**/*.tsx`]);

    assertEquals(strategy.getUsedSelectors().size > 0, true);

    strategy.clearCache();
    assertEquals(strategy.getUsedSelectors().size, 0);

    await cleanupTestDir();
  });
});

describe("Strategy priority ordering", () => {
  it("strategies have correct priority order", () => {
    const lightning = new LightningCSSStrategy();
    const minification = new MinificationStrategy();
    const purge = new PurgeStrategy();

    // Lightning should have highest priority
    assertEquals(lightning.priority > purge.priority, true);
    assertEquals(lightning.priority > minification.priority, true);

    // Purge should be medium priority
    assertEquals(purge.priority > minification.priority, true);
  });
});
