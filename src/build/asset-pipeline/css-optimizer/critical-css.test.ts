import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { createTestCSSOptimizationEngine } from "../../../../tests/_helpers/css-optimization-engine.ts";
import { createTestCSSPurgingEngine } from "../../../../tests/_helpers/css-purging-engine.ts";
import type { CSSPurgingRequest } from "#veryfront/extensions/css/index.ts";
import { extractCriticalCSS } from "./critical-css.ts";
import { createCSSPurgingSession } from "./purging-engine.ts";

function purgingSession(critical?: string, remaining = "") {
  return createCSSPurgingSession(
    createTestCSSPurgingEngine((request) =>
      Promise.resolve({
        css: critical ?? request.css,
        rejectedCSS: remaining,
      })
    ),
  );
}

const optimizationEngine = createTestCSSOptimizationEngine((request) => ({
  css: request.css.replaceAll(" ", ""),
}));

describe("build/asset-pipeline/css-optimizer/critical-css", () => {
  describe("extractCriticalCSS", () => {
    it("should separate critical from non-critical CSS", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      const cssContent = `.header { color: red; }
.footer { color: blue; }
.sidebar { color: green; }`;
      await writeTextFile(cssPath, cssContent);

      try {
        const html = `<div class="header"><p>Hello</p></div>`;
        const result = await extractCriticalCSS(
          cssPath,
          html,
          { minify: false },
          {
            purgingSession: purgingSession(
              ".header { color: red; }",
              ".footer { color: blue; } .sidebar { color: green; }",
            ),
          },
        );

        assertExists(result.critical);
        assertExists(result.remaining);
        assertEquals(result.critical.includes("header"), true);
        assertEquals(result.remaining.includes("footer"), true);
        assertEquals(result.remaining.includes("sidebar"), true);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should apply minification when minify is true", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await writeTextFile(cssPath, `.header { color: red; }`);

      try {
        const html = `<div class="header">Hi</div>`;
        const result = await extractCriticalCSS(
          cssPath,
          html,
          { minify: true },
          { optimizationEngine, purgingSession: purgingSession() },
        );

        assertEquals(
          result.critical,
          ".header{color:red;}",
          "minify: true must run the optimization engine over the critical CSS",
        );
        assertEquals(
          result.criticalSize,
          ".header{color:red;}".length,
          "criticalSize measures the minified critical CSS",
        );
        assertEquals(result.remainingSize, 0, "no CSS remains outside the critical set");
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should return the CSS untouched when minify is false", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await writeTextFile(cssPath, `.header { color: red; }`);

      try {
        const html = `<div class="header">Hi</div>`;
        const result = await extractCriticalCSS(
          cssPath,
          html,
          { minify: false },
          { optimizationEngine, purgingSession: purgingSession() },
        );

        assertEquals(
          result.critical,
          ".header { color: red; }",
          "minify: false must return the CSS untouched",
        );
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should default minify to true when not specified", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await writeTextFile(cssPath, `.a { color: red; }`);

      try {
        const html = `<div class="a">Test</div>`;
        const result = await extractCriticalCSS(
          cssPath,
          html,
          {},
          { optimizationEngine, purgingSession: purgingSession() },
        );

        assertEquals(result.critical, ".a{color:red;}", "minify defaults to true");
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should handle empty CSS file", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/empty.css`;
      await writeTextFile(cssPath, "");

      try {
        const result = await extractCriticalCSS(
          cssPath,
          "<div>hi</div>",
          { minify: false },
          { purgingSession: purgingSession() },
        );
        assertEquals(result.criticalSize, 0);
        assertEquals(result.remainingSize, 0);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should handle HTML with tag selectors", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await writeTextFile(
        cssPath,
        `p { font-size: 16px; }
h1 { font-size: 32px; }`,
      );

      try {
        const html = `<div><p>Hello</p></div>`;
        const result = await extractCriticalCSS(
          cssPath,
          html,
          { minify: false },
          { purgingSession: purgingSession() },
        );
        assertEquals(result.critical.includes("p"), true);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should report correct byte sizes", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      const css = `.crit { color: red; }\n.noncrit { color: blue; }`;
      await writeTextFile(cssPath, css);

      try {
        const html = `<div class="crit">test</div>`;
        const result = await extractCriticalCSS(
          cssPath,
          html,
          { minify: false },
          {
            purgingSession: purgingSession(
              ".crit { color: red; }",
              ".noncrit { color: blue; }",
            ),
          },
        );
        assertEquals(result.criticalSize > 0, true);
        assertEquals(result.remainingSize > 0, true);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("does not invoke custom safelist iterators", async () => {
      let iteratorCalls = 0;
      const safelist = ["dynamic"];
      Object.defineProperty(safelist, Symbol.iterator, {
        get() {
          iteratorCalls++;
          return Array.prototype[Symbol.iterator];
        },
      });
      await assertRejects(
        () =>
          extractCriticalCSS(
            "style.css",
            "<div></div>",
            { purgeSafelist: safelist },
            { optimizationEngine, purgingSession: purgingSession() },
          ),
        TypeError,
        "dense data-property array",
      );
      assertEquals(iteratorCalls, 0);
    });

    it("forwards the validated safelist and requests rejected CSS", async () => {
      const tmpDir = await makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      const cssContent = `.dynamic { color: red; }`;
      await writeTextFile(cssPath, cssContent);
      let captured: CSSPurgingRequest | undefined;

      try {
        const html = `<div class="dynamic">Hi</div>`;
        await extractCriticalCSS(
          cssPath,
          html,
          { minify: false, purgeSafelist: [".dynamic", "#hero", "plain"] },
          {
            purgingSession: createCSSPurgingSession(
              createTestCSSPurgingEngine((request) => {
                captured = request;
                return Promise.resolve({ css: request.css, rejectedCSS: "" });
              }),
            ),
          },
        );

        assertExists(captured, "the purging session must be invoked");
        assertEquals(
          [...captured.safelist],
          ["dynamic", "hero", "plain"],
          "leading . and # are stripped from safelist tokens",
        );
        assertEquals(captured.includeRejectedCSS, true, "purging must return rejected CSS");
        assertEquals(captured.css, cssContent, "the file contents are handed to the purger");
        assertEquals(
          [...captured.content],
          [{ raw: html, extension: "html" }],
          "HTML is passed as raw html content",
        );
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });
  });
});
