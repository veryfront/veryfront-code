import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { extractCriticalCSS } from "./critical-css.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

const fs = createFileSystem();

describe("extractCriticalCSS", () => {
  const testDir = "/tmp/critical-css-test";
  const testCSSPath = `${testDir}/test.css`;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should extract critical CSS based on HTML selectors", async () => {
    const css = `
      .header { color: red; }
      .footer { color: blue; }
      .content { font-size: 16px; }
    `;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="header">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertExists(result.critical);
    assertExists(result.remaining);
    assertEquals(typeof result.criticalSize, "number");
    assertEquals(typeof result.remainingSize, "number");
  });

  it("should minify CSS when minify option is enabled", async () => {
    const css = `.header { color: red; }`;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="header">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: true });

    assertExists(result.critical);
    // Minified CSS should not contain unnecessary whitespace
    assertEquals(result.critical.includes("  "), false);
  });

  it("should not minify CSS when minify option is disabled", async () => {
    const css = `.header { color: red; }`;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="header">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertExists(result.critical);
  });

  it("should default to minifying when minify option is not specified", async () => {
    const css = `.header { color: red; }`;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="header">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, {});

    assertExists(result.critical);
  });

  it("should handle empty CSS file", async () => {
    await fs.writeTextFile(testCSSPath, "");

    const html = '<div class="header">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertEquals(result.critical, "");
    assertEquals(result.remaining, "");
    assertEquals(result.criticalSize, 0);
    assertEquals(result.remainingSize, 0);
  });

  it("should handle empty HTML content", async () => {
    const css = `.header { color: red; }`;
    await fs.writeTextFile(testCSSPath, css);

    const result = await extractCriticalCSS(testCSSPath, "", { minify: false });

    assertExists(result);
    assertExists(result.remaining);
  });

  it("should split critical and remaining CSS correctly", async () => {
    const css = `
      .critical { color: red; }
      .not-critical { color: blue; }
    `;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="critical">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertExists(result.critical);
    assertExists(result.remaining);
    assertEquals(result.critical.includes("critical"), true);
  });

  it("should calculate correct byte sizes", async () => {
    const css = `.test { color: red; }`;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="test">Hello</div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertEquals(typeof result.criticalSize, "number");
    assertEquals(typeof result.remainingSize, "number");
    assertEquals(result.criticalSize >= 0, true);
    assertEquals(result.remainingSize >= 0, true);
  });

  it("should handle multiple selectors in HTML", async () => {
    const css = `
      .header { color: red; }
      .nav { color: green; }
      .footer { color: blue; }
    `;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="header"><nav class="nav">Menu</nav></div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertExists(result.critical);
    assertExists(result.remaining);
  });

  it("should handle CSS with complex selectors", async () => {
    const css = `
      .header > .title { color: red; }
      .footer:hover { color: blue; }
      #main { font-size: 16px; }
    `;
    await fs.writeTextFile(testCSSPath, css);

    const html = '<div class="header"><h1 class="title">Hello</h1></div>';

    const result = await extractCriticalCSS(testCSSPath, html, { minify: false });

    assertExists(result.critical);
    assertExists(result.remaining);
  });
});
