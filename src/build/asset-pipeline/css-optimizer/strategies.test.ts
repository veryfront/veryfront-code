import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { ensureDir } from "#veryfront/compat/std/fs.ts";
import { MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
import type { CSSOptimizationOptions } from "./types/index.ts";
import type { CSSOptimizationRequest } from "#veryfront/extensions/css/index.ts";
import { createTestCSSOptimizationEngine } from "../../../../tests/_helpers/css-optimization-engine.ts";
import { createTestCSSPurgingEngine } from "../../../../tests/_helpers/css-purging-engine.ts";

const TEST_DIR = "./.veryfront/test-strategies";

async function cleanupTestDir(): Promise<void> {
  try {
    await remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

async function setupTestSrcDir(): Promise<void> {
  await cleanupTestDir();
  await ensureDir(join(TEST_DIR, "src"));
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
const minificationEngine = createTestCSSOptimizationEngine((request) => ({
  css: request.css.includes("button") ? ".button{color:red}" : request.css,
}));

describe("MinificationStrategy", () => {
  it("canProcess returns true when enabled and minify is true", () => {
    const strategy = new MinificationStrategy(minificationEngine);

    assertEquals(strategy.canProcess({ enabled: true, minify: true }), true);
    assertEquals(strategy.canProcess({ enabled: false }), false);
    assertEquals(strategy.canProcess({ enabled: true, minify: false }), false);
  });

  it("process asks the engine to minify the given file", async () => {
    let received: CSSOptimizationRequest | undefined;
    const engine = createTestCSSOptimizationEngine((request) => {
      received = request;
      return { css: ".captured{}" };
    });
    const strategy = new MinificationStrategy(engine);
    const options: CSSOptimizationOptions = { enabled: true, minify: true };

    const result = await strategy.process(TEST_CSS, "test.css", options);

    assertEquals(
      received,
      { css: TEST_CSS, sourcePath: "test.css", minify: true, sourceMap: false },
      "strategy must ask the engine to minify the given file",
    );
    assertEquals(result.code, ".captured{}", "strategy returns the engine output verbatim");
    assertEquals(result.sourceMap, undefined, "minification emits no source map");
  });

  it("process removes whitespace", async () => {
    const strategy = new MinificationStrategy(minificationEngine);
    const options: CSSOptimizationOptions = { enabled: true, minify: true };

    const css = ".button   {   color:   red;   }";
    const result = await strategy.process(css, "test.css", options);

    assertEquals(result.code, ".button{color:red}");
  });
});

describe("PurgeStrategy", () => {
  it("canProcess returns true when enabled and purge is true", () => {
    const strategy = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine(),
    });

    assertEquals(strategy.canProcess({ enabled: true, purge: true }), true);
    assertEquals(strategy.canProcess({ enabled: true, purge: false }), false);
    assertEquals(strategy.canProcess({ enabled: false, purge: true }), false);
  });

  it("analyzeContent extracts selectors", async () => {
    await setupTestSrcDir();

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

  it("process routes analyzed content through the configured provider", async () => {
    await setupTestSrcDir();

    await writeTextFile(
      join(TEST_DIR, "src", "component.tsx"),
      '<div className="button">Test</div>',
    );

    const css = `
.button { color: blue; }
.unused { color: red; }
`;

    const strategy = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine(),
    });
    const options: CSSOptimizationOptions = {
      enabled: true,
      purge: true,
      purgeContent: [`${TEST_DIR}/src/**/*.tsx`],
    };

    const result = await strategy.process(css, "test.css", options);

    assertEquals(result.code.includes(".button"), true);

    await cleanupTestDir();
  });

  it("clearCache resets used selectors", async () => {
    await setupTestSrcDir();

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

describe("Legacy strategy metadata", () => {
  it("keeps priority values stable for direct strategy consumers", () => {
    const minification = new MinificationStrategy(minificationEngine);
    const purge = new PurgeStrategy();

    assertEquals(purge.priority > minification.priority, true);
  });
});
