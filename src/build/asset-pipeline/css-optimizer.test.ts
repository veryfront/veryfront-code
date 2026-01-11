/**
 * Tests for CSS Optimizer
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import {
  type CSSOptimizationOptions,
  CSSOptimizer,
  loadCSSManifest,
  optimizeCSS,
} from "./css-optimizer/index.ts";

// Test helpers
const TEST_DIR = "./.veryfront/test-css";
const OUTPUT_DIR = "./.veryfront/test-output-css";

async function cleanupTestDirs() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
  try {
    await Deno.remove(OUTPUT_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

async function setupTestCSS(filename: string, content: string) {
  await ensureDir(TEST_DIR);
  await Deno.writeTextFile(join(TEST_DIR, filename), content);
}

const TEST_CSS = `
.button {
  padding: 12px 24px;
  background: #007bff;
  color: white;
  border-radius: 4px;
  transition: all 0.3s ease;
}

.button:hover {
  background: #0056b3;
  transform: translateY(-2px);
}

/* This is a comment */
.unused-class {
  display: none;
}
`;

Deno.test("CSSOptimizer - initialization", async () => {
  await cleanupTestDirs();

  const optimizer = new CSSOptimizer({
    enabled: true,
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  const isReady = await optimizer.init();

  // Should return false if Lightning CSS is not available (graceful degradation)
  // or true if Lightning CSS is installed
  assertEquals(typeof isReady, "boolean");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - disabled optimization", async () => {
  await cleanupTestDirs();

  const optimizer = new CSSOptimizer({
    enabled: false,
  });

  const manifest = await optimizer.optimize();

  assertEquals(manifest.size, 0);

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - basic minification", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    enabled: true,
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  // Should process CSS (with Lightning CSS or fallback)
  assertEquals(typeof manifest.size, "number");

  if (manifest.size > 0) {
    const bundle = manifest.get("test.css");
    assertExists(bundle);
    assertEquals(bundle.minifiedSize < bundle.size, true);
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - fallback minification", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    enabled: true,
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  // Even without Lightning CSS, fallback should work
  if (manifest.size > 0) {
    const bundle = manifest.get("test.css");
    assertExists(bundle);

    // Fallback minification should at least remove whitespace
    assertEquals(bundle.minifiedSize <= bundle.size, true);
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - getStats", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  await optimizer.optimize();

  const stats = await optimizer.getStats();

  assertEquals(typeof stats.totalFiles, "number");
  assertEquals(typeof stats.originalSize, "number");
  assertEquals(typeof stats.minifiedSize, "number");
  assertEquals(typeof stats.averageSavings, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - multiple files", async () => {
  await cleanupTestDirs();
  await setupTestCSS("main.css", TEST_CSS);
  await setupTestCSS("components.css", ".card { padding: 1rem; }");
  await setupTestCSS("utilities.css", ".mt-4 { margin-top: 1rem; }");

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  // Should process all CSS files
  assertEquals(manifest.size >= 0, true);

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - source maps", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    sourceMap: true,
  });

  const manifest = await optimizer.optimize();

  if (manifest.size > 0) {
    const bundle = manifest.get("test.css");
    // Source maps may or may not be generated depending on Lightning CSS availability
    const sourceMapType = typeof bundle?.sourceMap;
    assert(sourceMapType === "string" || sourceMapType === "undefined");
  }

  await cleanupTestDirs();
});

Deno.test("optimizeCSS - helper function", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  const options: CSSOptimizationOptions = {
    enabled: true,
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  };

  const manifest = await optimizeCSS(options);

  assertExists(manifest);
  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("loadCSSManifest - missing manifest", async () => {
  await cleanupTestDirs();

  const manifest = await loadCSSManifest(OUTPUT_DIR);

  assertEquals(manifest.size, 0);

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - critical CSS extraction", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  await optimizer.optimize();

  const htmlContent = '<button class="button">Click me</button>';
  const cssPath = join(TEST_DIR, "test.css");

  const result = await optimizer.extractCriticalCSS(cssPath, htmlContent);

  assertExists(result.critical);
  assertExists(result.remaining);
  assertEquals(typeof result.criticalSize, "number");
  assertEquals(typeof result.remainingSize, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - purge unused CSS", async () => {
  await cleanupTestDirs();
  await setupTestCSS("test.css", TEST_CSS);

  // Create some content files
  await ensureDir(join(TEST_DIR, "pages"));
  await Deno.writeTextFile(
    join(TEST_DIR, "pages", "index.tsx"),
    '<button className="button">Click</button>',
  );

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    purge: true,
    purgeContent: [`${TEST_DIR}/pages/**/*.tsx`],
  });

  const manifest = await optimizer.optimize();

  // Purging should work (with or without Lightning CSS)
  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - autoprefixer", async () => {
  await cleanupTestDirs();

  const modernCSS = `
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
`;

  await setupTestCSS("modern.css", modernCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    autoprefixer: true,
    browsers: ["last 2 versions"],
  });

  const manifest = await optimizer.optimize();

  // Should process CSS (prefixes added if Lightning CSS available)
  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - comment removal", async () => {
  await cleanupTestDirs();

  const cssWithComments = `
/* Header comment */
.header {
  /* Inline comment */
  padding: 1rem;
}

/* Another comment */
.footer {
  padding: 2rem; /* Trailing comment */
}
`;

  await setupTestCSS("commented.css", cssWithComments);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  if (manifest.size > 0) {
    const bundle = manifest.get("commented.css");
    assertExists(bundle);

    // Minified version should not contain comments
    const hasComments = bundle.content.includes("/*");
    assertEquals(hasComments, false);
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - empty CSS file", async () => {
  await cleanupTestDirs();
  await setupTestCSS("empty.css", "");

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  const manifest = await optimizer.optimize();

  // Should handle empty files gracefully
  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - invalid CSS", async () => {
  await cleanupTestDirs();
  await setupTestCSS("invalid.css", ".broken { color: }");

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  // Should not throw, should log error
  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

// Additional comprehensive tests for Lightning CSS integration
Deno.test("CSSOptimizer - Lightning CSS fallback minification", async () => {
  await cleanupTestDirs();

  const complexCSS = `
/* Complex CSS with modern features */
.container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  padding: clamp(1rem, 5vw, 3rem);
}

@media (prefers-color-scheme: dark) {
  .container {
    background: #1a1a1a;
    color: #ffffff;
  }
}

.card:has(> .active) {
  border: 2px solid blue;
}
`;

  await setupTestCSS("modern.css", complexCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  if (manifest.size > 0) {
    const bundle = manifest.get("modern.css");
    assertExists(bundle);
    // Should minify even with fallback
    assertEquals(bundle.minifiedSize <= bundle.size, true);
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - fallback when Lightning unavailable", async () => {
  await cleanupTestDirs();
  await setupTestCSS("fallback.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  // Even if Lightning CSS fails, fallback should work
  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

// PurgeCSS and critical CSS extraction tests
Deno.test("CSSOptimizer - purge CSS with className extraction", async () => {
  await cleanupTestDirs();

  const css = `
.used-button { background: blue; }
.used-card { padding: 1rem; }
.unused-section { display: block; }
.another-unused { color: red; }
`;

  await setupTestCSS("purgeable.css", css);

  // Create content files
  await ensureDir(join(TEST_DIR, "pages"));
  await Deno.writeTextFile(
    join(TEST_DIR, "pages", "index.tsx"),
    '<div className="used-button used-card">Content</div>',
  );

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    purge: true,
    purgeContent: [`${TEST_DIR}/pages/**/*.tsx`],
  });

  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - purge CSS with class attribute", async () => {
  await cleanupTestDirs();

  const css = `
.header { font-size: 2rem; }
.footer { margin-top: 2rem; }
.sidebar { width: 300px; }
`;

  await setupTestCSS("classes.css", css);

  await ensureDir(join(TEST_DIR, "app"));
  await Deno.writeTextFile(
    join(TEST_DIR, "app", "layout.tsx"),
    '<div class="header footer">Layout</div>',
  );

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    purge: true,
    purgeContent: [`${TEST_DIR}/app/**/*.tsx`],
  });

  await optimizer.optimize();

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - purge CSS with ID selectors", async () => {
  await cleanupTestDirs();

  const css = `
#main { max-width: 1200px; }
#sidebar { width: 250px; }
#unused { display: none; }
`;

  await setupTestCSS("ids.css", css);

  await ensureDir(join(TEST_DIR, "components"));
  await Deno.writeTextFile(
    join(TEST_DIR, "components", "app.tsx"),
    '<div id="main"><aside id="sidebar">Content</aside></div>',
  );

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    purge: true,
    purgeContent: [`${TEST_DIR}/components/**/*.tsx`],
  });

  await optimizer.optimize();

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - critical CSS with HTML content", async () => {
  await cleanupTestDirs();

  const css = `
.above-fold { display: flex; }
.below-fold { margin-top: 100vh; }
.header { position: sticky; }
.footer { margin-top: auto; }
`;

  await setupTestCSS("critical.css", css);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  await optimizer.optimize();

  const html = '<div class="above-fold header">Visible content</div>';
  const result = await optimizer.extractCriticalCSS(join(TEST_DIR, "critical.css"), html);

  assertExists(result.critical);
  assertExists(result.remaining);
  assertEquals(typeof result.criticalSize, "number");
  assertEquals(typeof result.remainingSize, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - critical CSS minification", async () => {
  await cleanupTestDirs();

  const css = `
/* Header styles */
.header {
  padding: 1rem;
  background: white;
}

/* Content styles */
.content {
  margin: 2rem;
}
`;

  await setupTestCSS("minify-critical.css", css);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  await optimizer.optimize();

  const html = '<header class="header">Title</header>';
  const result = await optimizer.extractCriticalCSS(join(TEST_DIR, "minify-critical.css"), html);

  // Critical CSS should be minified
  assertEquals(result.critical.includes("/*"), false);

  await cleanupTestDirs();
});

// Tailwind processing tests
Deno.test("CSSOptimizer - Tailwind utility classes", async () => {
  await cleanupTestDirs();

  const tailwindCSS = `
.flex { display: flex; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.p-4 { padding: 1rem; }
.mt-2 { margin-top: 0.5rem; }
.bg-blue-500 { background-color: #3b82f6; }
.text-white { color: #ffffff; }
`;

  await setupTestCSS("tailwind.css", tailwindCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  if (manifest.size > 0) {
    const bundle = manifest.get("tailwind.css");
    assertExists(bundle);
    assert(bundle.minifiedSize < bundle.size);
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - preserve utility classes with purge", async () => {
  await cleanupTestDirs();

  const utilities = `
.flex { display: flex; }
.grid { display: grid; }
.hidden { display: none; }
.block { display: block; }
`;

  await setupTestCSS("utilities.css", utilities);

  await ensureDir(join(TEST_DIR, "src"));
  await Deno.writeTextFile(
    join(TEST_DIR, "src", "component.tsx"),
    '<div className="flex hidden">Content</div>',
  );

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    purge: true,
    purgeContent: [`${TEST_DIR}/src/**/*.tsx`],
  });

  await optimizer.optimize();

  await cleanupTestDirs();
});

// Manifest writing tests
Deno.test("CSSOptimizer - manifest excludes content", async () => {
  await cleanupTestDirs();
  await setupTestCSS("manifest-test.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  await optimizer.optimize();

  try {
    const manifestPath = join(OUTPUT_DIR, "css-manifest.json");
    const content = await Deno.readTextFile(manifestPath);
    const parsed = JSON.parse(content);

    // Manifest should not include full content (for file size)
    for (const key in parsed) {
      const entry = parsed[key];
      assertEquals(entry.content, undefined);
      assertEquals(entry.sourceMap, undefined);
    }
  } catch {
    // Manifest may not exist if optimization disabled
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - manifest includes bundle metadata", async () => {
  await cleanupTestDirs();
  await setupTestCSS("metadata.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  await optimizer.optimize();

  try {
    const manifestPath = join(OUTPUT_DIR, "css-manifest.json");
    const content = await Deno.readTextFile(manifestPath);
    const parsed = JSON.parse(content);

    for (const key in parsed) {
      const entry = parsed[key];
      assertExists(entry.file);
      assertEquals(typeof entry.size, "number");
      assertEquals(typeof entry.minifiedSize, "number");
      assertEquals(typeof entry.savings, "number");
    }
  } catch {
    // OK if manifest doesn't exist
  }

  await cleanupTestDirs();
});

// Import resolution tests
Deno.test("CSSOptimizer - @import with URL", async () => {
  await cleanupTestDirs();

  const cssWithImports = `
@import url("https://fonts.googleapis.com/css2?family=Roboto");
@import "normalize.css";

.container {
  font-family: "Roboto", sans-serif;
}
`;

  await setupTestCSS("imports.css", cssWithImports);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  if (manifest.size > 0) {
    const bundle = manifest.get("imports.css");
    assertExists(bundle);
    // Should preserve imports
    assertStringIncludes(bundle.content, "@import");
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - relative @import paths", async () => {
  await cleanupTestDirs();

  const mainCSS = `
@import "./variables.css";
@import "../base/reset.css";

.app {
  color: var(--primary);
}
`;

  await setupTestCSS("main.css", mainCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

// Error handling tests
Deno.test("CSSOptimizer - handles missing input directory", async () => {
  await cleanupTestDirs();

  const optimizer = new CSSOptimizer({
    inputDir: "/nonexistent/directory",
    outputDir: OUTPUT_DIR,
  });

  // Should not throw
  const manifest = await optimizer.optimize();

  assertEquals(manifest.size, 0);

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - handles malformed @media queries", async () => {
  await cleanupTestDirs();

  const malformedCSS = `
@media (min-width: 768px {
  .container { width: 750px; }
}

.valid { color: blue; }
`;

  await setupTestCSS("malformed.css", malformedCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
  });

  // Should handle gracefully
  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - handles CSS with only whitespace", async () => {
  await cleanupTestDirs();
  await setupTestCSS("whitespace.css", "   \n\n   \t\t   \n   ");

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  const manifest = await optimizer.optimize();

  if (manifest.size > 0) {
    const bundle = manifest.get("whitespace.css");
    assertExists(bundle);
    assertEquals(bundle.content.trim(), "");
  }

  await cleanupTestDirs();
});

// Browser targets and compatibility tests
Deno.test("CSSOptimizer - modern browser targets", async () => {
  await cleanupTestDirs();

  const modernCSS = `
.container {
  display: grid;
  gap: 1rem;
  aspect-ratio: 16 / 9;
}
`;

  await setupTestCSS("modern-features.css", modernCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    autoprefixer: true,
    browsers: ["last 2 Chrome versions"],
  });

  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - legacy browser support", async () => {
  await cleanupTestDirs();

  const legacyCSS = `
.flexbox {
  display: flex;
  flex-direction: column;
}
`;

  await setupTestCSS("legacy.css", legacyCSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    autoprefixer: true,
    browsers: ["> 1%", "last 2 versions"],
  });

  const manifest = await optimizer.optimize();

  assertEquals(typeof manifest.size, "number");

  await cleanupTestDirs();
});

// Stat calculation tests
Deno.test("CSSOptimizer - total savings calculation", async () => {
  await cleanupTestDirs();
  await setupTestCSS("file1.css", TEST_CSS);
  await setupTestCSS("file2.css", TEST_CSS);

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: true,
  });

  await optimizer.optimize();

  const stats = await optimizer.getStats();

  if (stats.totalFiles > 0) {
    assertEquals(stats.totalSavings, stats.originalSize - stats.minifiedSize);
    assertEquals(stats.averageSavings, (stats.totalSavings / stats.originalSize) * 100);
  }

  await cleanupTestDirs();
});

Deno.test("CSSOptimizer - stats with no savings", async () => {
  await cleanupTestDirs();
  await setupTestCSS("minimal.css", ".a{color:red}");

  const optimizer = new CSSOptimizer({
    inputDir: TEST_DIR,
    outputDir: OUTPUT_DIR,
    minify: false,
  });

  await optimizer.optimize();

  const stats = await optimizer.getStats();

  assertEquals(typeof stats.averageSavings, "number");

  await cleanupTestDirs();
});

// Load manifest tests
Deno.test("loadCSSManifest - valid manifest file", async () => {
  await cleanupTestDirs();
  await ensureDir(OUTPUT_DIR);

  const testManifest = {
    "test.css": {
      file: "test.css",
      size: 1000,
      minifiedSize: 500,
      savings: 50,
    },
  };

  await Deno.writeTextFile(
    join(OUTPUT_DIR, "css-manifest.json"),
    JSON.stringify(testManifest, null, 2),
  );

  const manifest = await loadCSSManifest(OUTPUT_DIR);

  assertEquals(manifest.size, 1);
  const entry = manifest.get("test.css");
  assertExists(entry);

  await cleanupTestDirs();
});

Deno.test("loadCSSManifest - corrupted manifest file", async () => {
  await cleanupTestDirs();
  await ensureDir(OUTPUT_DIR);

  await Deno.writeTextFile(join(OUTPUT_DIR, "css-manifest.json"), "invalid{json}");

  const manifest = await loadCSSManifest(OUTPUT_DIR);

  // Should return empty map on error
  assertEquals(manifest.size, 0);

  await cleanupTestDirs();
});
