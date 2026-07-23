import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for CSS Optimizer Utilities
 */

import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { ensureDir } from "#veryfront/compat/std/fs.ts";
import {
  basicMinify,
  calculateSavings,
  extractSelectors,
  findCSSFiles,
  getOutputPath,
  globFiles,
  matchPattern,
  parseBrowserTargets,
  shouldKeepSelector,
} from "./utils.ts";

const TEST_DIR = "./.veryfront/test-css-utils";

async function cleanupTestDir(): Promise<void> {
  try {
    await remove(TEST_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

describe("CSS Optimizer Utils", () => {
  describe("findCSSFiles", () => {
    it("finds all CSS files in a directory", async () => {
      await cleanupTestDir();
      await ensureDir(join(TEST_DIR, "styles"));

      await writeTextFile(join(TEST_DIR, "styles", "main.css"), ".test {}");
      await writeTextFile(join(TEST_DIR, "styles", "theme.css"), ".theme {}");

      const files = await findCSSFiles(join(TEST_DIR, "styles"));

      assertEquals(files.length, 2);
      assert(files.some((f) => f.includes("main.css")));
      assert(files.some((f) => f.includes("theme.css")));

      await cleanupTestDir();
    });
  });

  describe("matchPattern", () => {
    it("matches wildcards", () => {
      assert(matchPattern("test.ts", "*.ts"));
      assert(matchPattern("component.tsx", "*.tsx"));
      assert(!matchPattern("test.ts", "*.tsx"));
    });

    it("matches braces", () => {
      assert(matchPattern("test.tsx", "*.{ts,tsx}"));
      assert(matchPattern("test.ts", "*.{ts,tsx}"));
      assert(!matchPattern("test.js", "*.{ts,tsx}"));
    });

    it("treats regular expression punctuation as literal text", () => {
      assert(matchPattern("file+name.ts", "file+name.ts"));
      assert(!matchPattern("filename.ts", "file+name.ts"));
    });
  });

  describe("getOutputPath", () => {
    it("generates correct output path with .min suffix", () => {
      const result = getOutputPath("styles/main.css", ".output");
      assertEquals(result, ".output/styles/main.min.css");
    });

    it("rejects non-CSS and traversal paths", () => {
      assertThrows(() => getOutputPath("styles/main.scss", ".output"), TypeError, ".css");
      assertThrows(() => getOutputPath("../main.css", ".output"), TypeError, "escape");
    });
  });

  describe("extractSelectors", () => {
    it("extracts classes from className attribute", () => {
      const content = '<div className="button primary">Test</div>';
      const result = extractSelectors(content);

      assertEquals(result.classes.includes("button"), true);
      assertEquals(result.classes.includes("primary"), true);
      assertEquals(result.selectors.has(".button"), true);
      assertEquals(result.selectors.has(".primary"), true);
    });

    it("extracts classes from class attribute", () => {
      const content = '<div class="card header">Test</div>';
      const result = extractSelectors(content);

      assertEquals(result.classes.includes("card"), true);
      assertEquals(result.classes.includes("header"), true);
    });

    it("extracts ids from id attribute", () => {
      const content = '<div id="main-content">Test</div>';
      const result = extractSelectors(content);

      assertEquals(result.ids.includes("main-content"), true);
      assertEquals(result.selectors.has("#main-content"), true);
    });

    it("extracts tags from HTML content", () => {
      const content = "<header><nav><button>Test</button></nav></header>";
      const result = extractSelectors(content);

      assertEquals(result.tags.includes("header"), true);
      assertEquals(result.tags.includes("nav"), true);
      assertEquals(result.tags.includes("button"), true);
    });
  });

  describe("shouldKeepSelector", () => {
    it("keeps universal rules", () => {
      const used = new Set([".button"]);

      assertEquals(shouldKeepSelector("*", used), true);
      assertEquals(shouldKeepSelector(":root", used), true);
      assertEquals(shouldKeepSelector("html", used), true);
      assertEquals(shouldKeepSelector("body", used), true);
    });

    it("keeps used selectors", () => {
      const used = new Set([".button", "#main"]);

      assertEquals(shouldKeepSelector(".button", used), true);
      assertEquals(shouldKeepSelector("#main", used), true);
      assertEquals(shouldKeepSelector(".unused", used), false);
    });

    it("handles compound selectors", () => {
      const used = new Set([".button", ".card"]);

      assertEquals(shouldKeepSelector(".button .icon", used), true);
      assertEquals(shouldKeepSelector(".card > .title", used), true);
      assertEquals(shouldKeepSelector(".unused .icon", used), false);
    });
  });

  describe("basicMinify", () => {
    it("removes comments", () => {
      const css = "/* Comment */ .button { color: red; }";
      const minified = basicMinify(css);

      assertEquals(minified.includes("/*"), false);
    });

    it("removes whitespace", () => {
      const css = ".button   {   color:   red;   }";
      const minified = basicMinify(css);

      assertEquals(minified, ".button{color:red}");
    });

    it("removes semicolons before braces", () => {
      const css = ".button { color: red; }";
      const minified = basicMinify(css);

      assertEquals(minified, ".button{color:red}");
    });

    it("preserves comment-like text inside quoted values", () => {
      assertEquals(
        basicMinify('.label::before { content: "/* keep */"; }').includes('"/* keep */"'),
        true,
      );
    });

    it("rejects unbalanced CSS instead of emitting corrupted output", () => {
      assertThrows(() => basicMinify(".button { color: red"), SyntaxError, "Unterminated");
      assertThrows(() => basicMinify(".button }"), SyntaxError, "Unexpected");
    });
  });

  describe("calculateSavings", () => {
    it("calculates percentage savings correctly", () => {
      assertEquals(calculateSavings(1000, 500), 50);
      assertEquals(calculateSavings(1000, 750), 25);
      assertEquals(calculateSavings(0, 0), 0);
    });
  });

  describe("parseBrowserTargets", () => {
    it("encodes explicit browser versions for Lightning CSS", () => {
      assertEquals(parseBrowserTargets({ chrome: 120, safari: 17.4 }), {
        chrome: 120 << 16,
        safari: (17 << 16) | (4 << 8),
      });
      assertEquals(parseBrowserTargets(["chrome 120", "firefox 119"]), {
        chrome: 120 << 16,
        firefox: 119 << 16,
      });
    });

    it("rejects unsupported queries instead of substituting hardcoded targets", () => {
      assertThrows(
        () => parseBrowserTargets(["defaults", "not IE 11"]),
        TypeError,
        "Unsupported browser target",
      );
    });
  });

  describe("globFiles", () => {
    it("finds files matching pattern", async () => {
      await cleanupTestDir();
      await ensureDir(join(TEST_DIR, "src"));

      await writeTextFile(join(TEST_DIR, "src", "test.tsx"), "content");
      await writeTextFile(join(TEST_DIR, "src", "test.ts"), "content");
      await writeTextFile(join(TEST_DIR, "src", "test.js"), "content");

      const files = await globFiles(`${TEST_DIR}/**/*.{ts,tsx}`);

      assertEquals(files.length >= 2, true);
      assert(files.some((f) => f.includes("test.tsx")));
      assert(files.some((f) => f.includes("test.ts")));

      await cleanupTestDir();
    });
  });
});
