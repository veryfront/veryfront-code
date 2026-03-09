import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractCriticalCSS } from "./critical-css.ts";

describe("build/asset-pipeline/css-optimizer/critical-css", () => {
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
      const tmpDir = await Deno.makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await Deno.writeTextFile(cssPath, `.header { color: red; }`);

      try {
        const html = `<div class="header">Hi</div>`;
        const result = await extractCriticalCSS(cssPath, html, { minify: true });

        // Minified result should have less whitespace
        assertExists(result.critical);
        assertEquals(typeof result.criticalSize, "number");
        assertEquals(typeof result.remainingSize, "number");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should default minify to true when not specified", async () => {
      const tmpDir = await Deno.makeTempDir();
      const cssPath = `${tmpDir}/style.css`;
      await Deno.writeTextFile(cssPath, `.a { color: red; }`);

      try {
        const html = `<div class="a">Test</div>`;
        const result = await extractCriticalCSS(cssPath, html, {});

        // Should not throw, minify defaults to true
        assertExists(result.critical);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
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
  });
});
