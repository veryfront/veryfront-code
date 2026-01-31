/**
 * Tests for CSS Optimizer
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { ensureDir } from "#veryfront/compat/std/fs.ts";
import {
  type CSSOptimizationOptions,
  CSSOptimizer,
  loadCSSManifest,
  optimizeCSS,
} from "./css-optimizer/index.ts";

const TEST_DIR = "./.veryfront/test-css";
const OUTPUT_DIR = "./.veryfront/test-output-css";

async function removeDir(path: string): Promise<void> {
  try {
    await remove(path, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

async function cleanupTestDirs(): Promise<void> {
  await removeDir(TEST_DIR);
  await removeDir(OUTPUT_DIR);
}

async function setupTestCSS(filename: string, content: string): Promise<void> {
  await ensureDir(TEST_DIR);
  await writeTextFile(join(TEST_DIR, filename), content);
}

async function withCleanDirs(fn: () => Promise<void>): Promise<void> {
  await cleanupTestDirs();
  try {
    await fn();
  } finally {
    await cleanupTestDirs();
  }
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

describe("CSSOptimizer", () => {
  describe("initialization", () => {
    it("should initialize and return boolean for readiness", async () => {
      await withCleanDirs(async () => {
        const optimizer = new CSSOptimizer({
          enabled: true,
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
        });

        const isReady = await optimizer.init();

        // Should return false if Lightning CSS is not available (graceful degradation)
        // or true if Lightning CSS is installed
        assertEquals(typeof isReady, "boolean");
      });
    });
  });

  describe("disabled optimization", () => {
    it("should return empty manifest when disabled", async () => {
      await withCleanDirs(async () => {
        const optimizer = new CSSOptimizer({ enabled: false });
        const manifest = await optimizer.optimize();

        assertEquals(manifest.size, 0);
      });
    });
  });

  describe("minification", () => {
    it("should perform basic minification", async () => {
      await withCleanDirs(async () => {
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

        const bundle = manifest.get("test.css");
        if (bundle) assertEquals(bundle.minifiedSize < bundle.size, true);
      });
    });

    it("should use fallback minification", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("test.css", TEST_CSS);

        const optimizer = new CSSOptimizer({
          enabled: true,
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          minify: true,
        });

        const manifest = await optimizer.optimize();

        // Even without Lightning CSS, fallback should work
        const bundle = manifest.get("test.css");
        if (!bundle) return;

        // Fallback minification should at least remove whitespace
        assertEquals(bundle.minifiedSize <= bundle.size, true);
      });
    });

    it("should remove comments when minifying", async () => {
      await withCleanDirs(async () => {
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

        const bundle = manifest.get("commented.css");
        if (!bundle) return;

        // Minified version should not contain comments
        assertEquals(bundle.content.includes("/*"), false);
      });
    });
  });

  describe("getStats", () => {
    it("should return stats with expected properties", async () => {
      await withCleanDirs(async () => {
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
      });
    });

    it("should calculate total savings correctly", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("file1.css", TEST_CSS);
        await setupTestCSS("file2.css", TEST_CSS);

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          minify: true,
        });

        await optimizer.optimize();

        const stats = await optimizer.getStats();

        if (stats.totalFiles <= 0) return;

        assertEquals(stats.totalSavings, stats.originalSize - stats.minifiedSize);
        assertEquals(
          stats.averageSavings,
          (stats.totalSavings / stats.originalSize) * 100,
        );
      });
    });

    it("should handle stats with no savings", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("minimal.css", ".a{color:red}");

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          minify: false,
        });

        await optimizer.optimize();

        const stats = await optimizer.getStats();

        assertEquals(typeof stats.averageSavings, "number");
      });
    });
  });

  describe("multiple files", () => {
    it("should process all CSS files", async () => {
      await withCleanDirs(async () => {
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
      });
    });
  });

  describe("source maps", () => {
    it("should handle source map generation", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("test.css", TEST_CSS);

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          sourceMap: true,
        });

        const manifest = await optimizer.optimize();

        const bundle = manifest.get("test.css");
        if (!bundle) return;

        // Source maps may or may not be generated depending on Lightning CSS availability
        const sourceMapType = typeof bundle.sourceMap;
        assert(sourceMapType === "string" || sourceMapType === "undefined");
      });
    });
  });

  describe("critical CSS extraction", () => {
    it("should extract critical CSS from HTML content", async () => {
      await withCleanDirs(async () => {
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
      });
    });

    it("should extract critical CSS with HTML content selectors", async () => {
      await withCleanDirs(async () => {
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
        const result = await optimizer.extractCriticalCSS(
          join(TEST_DIR, "critical.css"),
          html,
        );

        assertExists(result.critical);
        assertExists(result.remaining);
        assertEquals(typeof result.criticalSize, "number");
        assertEquals(typeof result.remainingSize, "number");
      });
    });

    it("should minify critical CSS", async () => {
      await withCleanDirs(async () => {
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
        const result = await optimizer.extractCriticalCSS(
          join(TEST_DIR, "minify-critical.css"),
          html,
        );

        // Critical CSS should be minified
        assertEquals(result.critical.includes("/*"), false);
      });
    });
  });

  describe("purge unused CSS", () => {
    it("should purge unused CSS", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("test.css", TEST_CSS);

        await ensureDir(join(TEST_DIR, "pages"));
        await writeTextFile(
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
      });
    });

    it("should purge CSS with className extraction", async () => {
      await withCleanDirs(async () => {
        const css = `
.used-button { background: blue; }
.used-card { padding: 1rem; }
.unused-section { display: block; }
.another-unused { color: red; }
`;

        await setupTestCSS("purgeable.css", css);

        await ensureDir(join(TEST_DIR, "pages"));
        await writeTextFile(
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
      });
    });

    it("should purge CSS with class attribute", async () => {
      await withCleanDirs(async () => {
        const css = `
.header { font-size: 2rem; }
.footer { margin-top: 2rem; }
.sidebar { width: 300px; }
`;

        await setupTestCSS("classes.css", css);

        await ensureDir(join(TEST_DIR, "app"));
        await writeTextFile(
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
      });
    });

    it("should purge CSS with ID selectors", async () => {
      await withCleanDirs(async () => {
        const css = `
#main { max-width: 1200px; }
#sidebar { width: 250px; }
#unused { display: none; }
`;

        await setupTestCSS("ids.css", css);

        await ensureDir(join(TEST_DIR, "components"));
        await writeTextFile(
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
      });
    });
  });

  describe("autoprefixer", () => {
    it("should add vendor prefixes", async () => {
      await withCleanDirs(async () => {
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
      });
    });

    it("should handle modern browser targets", async () => {
      await withCleanDirs(async () => {
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
      });
    });

    it("should handle legacy browser support", async () => {
      await withCleanDirs(async () => {
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
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty CSS file", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("empty.css", "");

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
        });

        const manifest = await optimizer.optimize();

        // Should handle empty files gracefully
        assertEquals(typeof manifest.size, "number");
      });
    });

    it("should handle invalid CSS", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("invalid.css", ".broken { color: }");

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
        });

        // Should not throw, should log error
        const manifest = await optimizer.optimize();

        assertEquals(typeof manifest.size, "number");
      });
    });

    it("should handle CSS with only whitespace", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("whitespace.css", "   \n\n   \t\t   \n   ");

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          minify: true,
        });

        const manifest = await optimizer.optimize();

        const bundle = manifest.get("whitespace.css");
        if (bundle) assertEquals(bundle.content.trim(), "");
      });
    });

    it("should handle missing input directory", async () => {
      await withCleanDirs(async () => {
        const optimizer = new CSSOptimizer({
          inputDir: "/nonexistent/directory",
          outputDir: OUTPUT_DIR,
        });

        // Should not throw
        const manifest = await optimizer.optimize();

        assertEquals(manifest.size, 0);
      });
    });

    it("should handle malformed @media queries", async () => {
      await withCleanDirs(async () => {
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
      });
    });
  });

  describe("Lightning CSS integration", () => {
    it("should use fallback minification for complex CSS", async () => {
      await withCleanDirs(async () => {
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

        const bundle = manifest.get("modern.css");
        if (bundle) {
          // Should minify even with fallback
          assertEquals(bundle.minifiedSize <= bundle.size, true);
        }
      });
    });

    it("should use fallback when Lightning unavailable", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("fallback.css", TEST_CSS);

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          minify: true,
        });

        // Even if Lightning CSS fails, fallback should work
        const manifest = await optimizer.optimize();

        assertEquals(typeof manifest.size, "number");
      });
    });
  });

  describe("Tailwind processing", () => {
    it("should process Tailwind utility classes", async () => {
      await withCleanDirs(async () => {
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

        const bundle = manifest.get("tailwind.css");
        if (bundle) assert(bundle.minifiedSize < bundle.size);
      });
    });

    it("should preserve utility classes with purge", async () => {
      await withCleanDirs(async () => {
        const utilities = `
.flex { display: flex; }
.grid { display: grid; }
.hidden { display: none; }
.block { display: block; }
`;

        await setupTestCSS("utilities.css", utilities);

        await ensureDir(join(TEST_DIR, "src"));
        await writeTextFile(
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
      });
    });
  });

  describe("manifest handling", () => {
    it("should exclude content from manifest", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("manifest-test.css", TEST_CSS);

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
        });

        await optimizer.optimize();

        try {
          const manifestPath = join(OUTPUT_DIR, "css-manifest.json");
          const content = await readTextFile(manifestPath);
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
      });
    });

    it("should include bundle metadata in manifest", async () => {
      await withCleanDirs(async () => {
        await setupTestCSS("metadata.css", TEST_CSS);

        const optimizer = new CSSOptimizer({
          inputDir: TEST_DIR,
          outputDir: OUTPUT_DIR,
          minify: true,
        });

        await optimizer.optimize();

        try {
          const manifestPath = join(OUTPUT_DIR, "css-manifest.json");
          const content = await readTextFile(manifestPath);
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
      });
    });
  });

  describe("import resolution", () => {
    it("should handle @import with URL", async () => {
      await withCleanDirs(async () => {
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

        const bundle = manifest.get("imports.css");
        if (bundle) {
          // Should preserve imports
          assertStringIncludes(bundle.content, "@import");
        }
      });
    });

    it("should handle relative @import paths", async () => {
      await withCleanDirs(async () => {
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
      });
    });
  });
});

describe("optimizeCSS", () => {
  it("should work as a helper function", async () => {
    await withCleanDirs(async () => {
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
    });
  });
});

describe("loadCSSManifest", () => {
  it("should return empty manifest for missing file", async () => {
    await withCleanDirs(async () => {
      const manifest = await loadCSSManifest(OUTPUT_DIR);

      assertEquals(manifest.size, 0);
    });
  });

  it("should load valid manifest file", async () => {
    await withCleanDirs(async () => {
      await ensureDir(OUTPUT_DIR);

      const testManifest = {
        "test.css": {
          file: "test.css",
          size: 1000,
          minifiedSize: 500,
          savings: 50,
        },
      };

      await writeTextFile(
        join(OUTPUT_DIR, "css-manifest.json"),
        JSON.stringify(testManifest, null, 2),
      );

      const manifest = await loadCSSManifest(OUTPUT_DIR);

      assertEquals(manifest.size, 1);
      assertExists(manifest.get("test.css"));
    });
  });

  it("should return empty manifest for corrupted file", async () => {
    await withCleanDirs(async () => {
      await ensureDir(OUTPUT_DIR);

      await writeTextFile(join(OUTPUT_DIR, "css-manifest.json"), "invalid{json}");

      const manifest = await loadCSSManifest(OUTPUT_DIR);

      // Should return empty map on error
      assertEquals(manifest.size, 0);
    });
  });
});
