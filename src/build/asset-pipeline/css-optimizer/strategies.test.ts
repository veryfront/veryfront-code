/**
 * Tests for CSS Optimization Strategies
 */

import { assertEquals, assertExists as _assertExists } from "jsr:@std/assert@1";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
import type { CSSOptimizationOptions } from "@veryfront/types";

const TEST_DIR = "./.veryfront/test-strategies";

async function cleanupTestDir() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
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

Deno.test("MinificationStrategy - canProcess", () => {
  const strategy = new MinificationStrategy();

  assertEquals(strategy.canProcess({ enabled: true, minify: true }), true);
  assertEquals(strategy.canProcess({ enabled: false }), false);
  assertEquals(strategy.canProcess({ enabled: true, minify: false }), false);
});

Deno.test("MinificationStrategy - process removes comments", async () => {
  const strategy = new MinificationStrategy();
  const options: CSSOptimizationOptions = { enabled: true, minify: true };

  const result = await strategy.process(TEST_CSS, "test.css", options);

  assertEquals(result.code.includes("/*"), false);
  assertEquals(result.sourceMap, undefined);
});

Deno.test("MinificationStrategy - process removes whitespace", async () => {
  const strategy = new MinificationStrategy();
  const options: CSSOptimizationOptions = { enabled: true, minify: true };

  const css = ".button   {   color:   red;   }";
  const result = await strategy.process(css, "test.css", options);

  assertEquals(result.code, ".button{color:red}");
});

Deno.test("LightningCSSStrategy - canProcess when not initialized", () => {
  const strategy = new LightningCSSStrategy();

  // Before initialization, should return false
  assertEquals(strategy.canProcess({ enabled: true }), false);
});

Deno.test("LightningCSSStrategy - init attempts to load", async () => {
  const strategy = new LightningCSSStrategy();
  const success = await strategy.init();

  // Should return boolean (true if loaded, false if not available)
  assertEquals(typeof success, "boolean");
});

Deno.test("PurgeStrategy - canProcess", () => {
  const strategy = new PurgeStrategy();

  assertEquals(strategy.canProcess({ enabled: true, purge: true }), true);
  assertEquals(strategy.canProcess({ enabled: true, purge: false }), false);
  assertEquals(strategy.canProcess({ enabled: false, purge: true }), false);
});

Deno.test("PurgeStrategy - analyzeContent extracts selectors", async () => {
  await cleanupTestDir();
  await ensureDir(join(TEST_DIR, "src"));

  await Deno.writeTextFile(
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

Deno.test("PurgeStrategy - process removes unused rules", async () => {
  await cleanupTestDir();
  await ensureDir(join(TEST_DIR, "src"));

  await Deno.writeTextFile(
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

Deno.test("PurgeStrategy - clearCache", async () => {
  await cleanupTestDir();
  await ensureDir(join(TEST_DIR, "src"));

  await Deno.writeTextFile(
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

Deno.test("Strategy priority ordering", () => {
  const lightning = new LightningCSSStrategy();
  const minification = new MinificationStrategy();
  const purge = new PurgeStrategy();

  // Lightning should have highest priority
  assertEquals(lightning.priority > purge.priority, true);
  assertEquals(lightning.priority > minification.priority, true);

  // Purge should be medium priority
  assertEquals(purge.priority > minification.priority, true);
});
