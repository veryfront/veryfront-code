import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  CSSOptimizationEngineName,
  type CSSPurgingEngine,
  CSSPurgingEngineName,
} from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../../tests/_helpers/css-optimization-engine.ts";
import { createTestCSSPurgingEngine } from "../../../../tests/_helpers/css-purging-engine.ts";
import { extractCriticalCSS } from "./critical-css.ts";

describe("build/asset-pipeline/css-optimizer/critical-css", () => {
  let previousPurgingEngine: CSSPurgingEngine | undefined;
  beforeEach(() => {
    previousPurgingEngine = tryResolve<CSSPurgingEngine>(CSSPurgingEngineName);
    unregister(CSSPurgingEngineName);
    register(CSSPurgingEngineName, createTestCSSPurgingEngine());
  });
  afterEach(() => {
    unregister(CSSPurgingEngineName);
    if (previousPurgingEngine !== undefined) {
      register(CSSPurgingEngineName, previousPurgingEngine);
    }
  });

  describe("extractCriticalCSS", () => {
    it("should separate critical from non-critical CSS", async () => {
      const tmpDir = await Deno.makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      const cssContent = `.header { color: red; }
.footer { color: blue; }
.sidebar { color: green; }`;
      await Deno.writeTextFile(cssPath, cssContent);

      try {
        const html = `<div class="header"><p>Hello</p></div>`;
        const result = await extractCriticalCSS(cssPath, html, { minify: false });

        assertExists(result.critical);
        assertExists(result.remaining);
        assertEquals(result.critical.includes("header"), true);
        assertEquals(result.remaining.includes("footer"), true);
        assertEquals(result.remaining.includes("sidebar"), true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should apply minification when minify is true", async () => {
      await withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine(),
        async () => {
          const tmpDir = await Deno.makeTempDir();
          const cssPath = `${tmpDir}/style.css`;
          await Deno.writeTextFile(cssPath, `.header { color: red; }`);

          try {
            const html = `<div class="header">Hi</div>`;
            const result = await extractCriticalCSS(cssPath, html, { minify: true });

            assertExists(result.critical);
            assertEquals(typeof result.criticalSize, "number");
            assertEquals(typeof result.remainingSize, "number");
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );
    });

    it("should default minify to true when not specified", async () => {
      await withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine(),
        async () => {
          const tmpDir = await Deno.makeTempDir();
          const cssPath = `${tmpDir}/style.css`;
          await Deno.writeTextFile(cssPath, `.a { color: red; }`);

          try {
            const html = `<div class="a">Test</div>`;
            const result = await extractCriticalCSS(cssPath, html, {});

            assertExists(result.critical);
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );
    });

    it("should handle empty CSS file", async () => {
      const tmpDir = await Deno.makeTempDir();
      const cssPath = `${tmpDir}/empty.css`;
      await Deno.writeTextFile(cssPath, "");

      try {
        const result = await extractCriticalCSS(cssPath, "<div>hi</div>", { minify: false });
        assertEquals(result.criticalSize, 0);
        assertEquals(result.remainingSize, 0);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should handle HTML with tag selectors", async () => {
      const tmpDir = await Deno.makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await Deno.writeTextFile(
        cssPath,
        `p { font-size: 16px; }
h1 { font-size: 32px; }`,
      );

      try {
        const html = `<div><p>Hello</p></div>`;
        const result = await extractCriticalCSS(cssPath, html, { minify: false });
        assertEquals(result.critical.includes("p"), true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should report correct byte sizes", async () => {
      const tmpDir = await Deno.makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      const css = `.crit { color: red; }\n.noncrit { color: blue; }`;
      await Deno.writeTextFile(cssPath, css);

      try {
        const html = `<div class="crit">test</div>`;
        const result = await extractCriticalCSS(cssPath, html, { minify: false });
        assertEquals(result.criticalSize > 0, true);
        assertEquals(result.remainingSize > 0, true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("uses one captured engine for critical and remaining output", async () => {
      let firstEngineCalls = 0;
      let replacementEngineCalls = 0;
      const replacement = createTestCSSOptimizationEngine((request) => {
        replacementEngineCalls++;
        return { css: `${request.css}/*replacement*/` };
      }, "replacement@1");
      const first = createTestCSSOptimizationEngine((request) => {
        firstEngineCalls++;
        if (firstEngineCalls === 1) {
          unregister(CSSOptimizationEngineName);
          register(CSSOptimizationEngineName, replacement);
        }
        return { css: `${request.css}/*captured*/` };
      }, "captured@1");

      await withTestCSSOptimizationEngine(first, async () => {
        const tmpDir = await Deno.makeTempDir();
        const cssPath = `${tmpDir}/style.css`;
        await Deno.writeTextFile(
          cssPath,
          ".critical { color: red; } .remaining { color: blue; }",
        );
        try {
          const result = await extractCriticalCSS(
            cssPath,
            '<div class="critical">content</div>',
            { minify: true },
          );
          assertEquals(result.critical.endsWith("/*captured*/"), true);
          assertEquals(result.remaining.endsWith("/*captured*/"), true);
          assertEquals(firstEngineCalls, 2);
          assertEquals(replacementEngineCalls, 0);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });
    });
  });
});
