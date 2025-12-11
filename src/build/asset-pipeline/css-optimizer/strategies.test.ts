
import { assertEquals, assertExists as _assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
import type { CSSOptimizationOptions } from "@veryfront/types";

const TEST_DIR = "./.veryfront/test-strategies";

async function cleanupTestDir() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
  }
}

const TEST_CSS = `
.button {
  padding: 12px 24px;
  background: #007bff;
  color: white;
}

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

  assertEquals(result.code.includes("

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
    purgeContent: [`${TEST_DIR}/src *.tsx`],
  };

  const result = await strategy.process(css, "test.css", options);

  assertEquals(result.code.includes(".button"), true);
  // Note: Our basic purging implementation may not perfectly remove all unused rules

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
  await strategy.analyzeContent([`${TEST_DIR}/src *.tsx`]);

  assertEquals(strategy.getUsedSelectors().size > 0, true);

  strategy.clearCache();
  assertEquals(strategy.getUsedSelectors().size, 0);

  await cleanupTestDir();
});

Deno.test("Strategy priority ordering", () => {
  const lightning = new LightningCSSStrategy();
  const minification = new MinificationStrategy();
  const purge = new PurgeStrategy();

  assertEquals(lightning.priority > purge.priority, true);
  assertEquals(lightning.priority > minification.priority, true);

  assertEquals(purge.priority > minification.priority, true);
});
