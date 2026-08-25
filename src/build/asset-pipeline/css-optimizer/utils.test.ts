import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for CSS Optimizer Utilities
 */

import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join, resolve } from "#veryfront/compat/path";
import { isNotFoundError, makeTempDir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { ensureDir } from "#veryfront/compat/std/fs.ts";
import {
  calculateSavings,
  extractSelectors,
  findCSSFiles,
  getOutputPath,
  globFiles,
  matchPattern,
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

    it("rejects a missing directory", async () => {
      try {
        await findCSSFiles(`${TEST_DIR}-${crypto.randomUUID()}`);
        throw new Error("a missing CSS root must reject");
      } catch (error) {
        assertEquals(isNotFoundError(error), true, "a missing CSS root must reject as NotFound");
      }
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

    it("keeps wildcards inside segments unless globstar spans directories", () => {
      assert(matchPattern("src/page.tsx", "src/*.tsx"));
      assert(!matchPattern("src/nested/page.tsx", "src/*.tsx"));
      assert(matchPattern("src/nested/page.tsx", "src/**/*.tsx"));
      assert(matchPattern("src/page.tsx", "src/**/*.tsx"));
    });

    it("normalizes separators and supports literal glob characters", () => {
      assert(matchPattern("src\\nested\\page.tsx", "src\\**\\*.tsx"));
      assert(matchPattern("file?.tsx", "file[?].tsx"));
      assert(!matchPattern("file1.tsx", "file[?].tsx"));
    });

    it("rejects invalid glob syntax", () => {
      assertThrows(() => matchPattern("page.tsx", "*.{ts,tsx"), TypeError, "Invalid path glob");
      assertThrows(() => matchPattern("page.tsx", "file[abc"), TypeError, "Invalid path glob");
    });
  });

  describe("getOutputPath", () => {
    it("generates correct output path with .min suffix", () => {
      const result = getOutputPath("styles/main.css", ".output");
      assertEquals(result, ".output/styles/main.min.css");
    });

    it("rejects paths that could escape output", () => {
      assertThrows(
        () => getOutputPath("../main.css", ".output"),
        TypeError,
        "Invalid relative",
      );
    });

    it("rejects inputs that are not CSS files", () => {
      assertThrows(
        () => getOutputPath("styles/main.js", ".output"),
        TypeError,
        "must end in .css",
      );
      assertThrows(
        () => getOutputPath("styles/main", ".output"),
        TypeError,
        "must end in .css",
      );
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

  describe("calculateSavings", () => {
    it("calculates percentage savings correctly", () => {
      assertEquals(calculateSavings(1000, 500), 50);
      assertEquals(calculateSavings(1000, 750), 25);
      assertEquals(calculateSavings(0, 0), 0);
      assertThrows(
        () => calculateSavings(-1, 0),
        TypeError,
        "non-negative safe integers",
      );
      assertThrows(
        () => calculateSavings(1000, -5),
        TypeError,
        "non-negative safe integers",
      );
      assertThrows(
        () => calculateSavings(1000, 1.5),
        TypeError,
        "non-negative safe integers",
      );
      assertThrows(
        () => calculateSavings(1000, Number.NaN),
        TypeError,
        "non-negative safe integers",
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

    it("uses the static prefix before an extended group as the scan root", async () => {
      await cleanupTestDir();
      try {
        await ensureDir(join(TEST_DIR, "app"));
        await ensureDir(join(TEST_DIR, "pages"));
        await ensureDir(join(TEST_DIR, "components"));
        await writeTextFile(join(TEST_DIR, "app", "page.tsx"), "content");
        await writeTextFile(join(TEST_DIR, "pages", "page.tsx"), "content");
        await writeTextFile(join(TEST_DIR, "components", "page.tsx"), "content");

        const files = await globFiles(`${TEST_DIR}/@(app|pages)/**/*.tsx`);

        assertEquals(files.map((file) => file.replaceAll("\\", "/")).sort(), [
          resolve(TEST_DIR, "app", "page.tsx").replaceAll("\\", "/"),
          resolve(TEST_DIR, "pages", "page.tsx").replaceAll("\\", "/"),
        ]);
      } finally {
        await cleanupTestDir();
      }
    });

    it("applies negative extglobs to complete CSS discovery segments", async () => {
      await cleanupTestDir();
      try {
        await ensureDir(join(TEST_DIR, "src", "app"));
        await ensureDir(join(TEST_DIR, "src", "generated"));
        await ensureDir(join(TEST_DIR, "src", "generated-extra"));
        await ensureDir(join(TEST_DIR, "src", "vendor"));
        await writeTextFile(join(TEST_DIR, "src", "app", "page.tsx"), "content");
        await writeTextFile(join(TEST_DIR, "src", "generated", "page.tsx"), "content");
        await writeTextFile(join(TEST_DIR, "src", "generated-extra", "page.tsx"), "content");
        await writeTextFile(join(TEST_DIR, "src", "vendor", "page.tsx"), "content");

        const files = await globFiles(
          `${TEST_DIR}/src/!(generated|vendor)/**/*.tsx`,
        );

        assertEquals(files.map((file) => file.replaceAll("\\", "/")), [
          resolve(TEST_DIR, "src", "app", "page.tsx").replaceAll("\\", "/"),
        ]);
      } finally {
        await cleanupTestDir();
      }
    });

    it("rejects patterns outside the project boundary", async () => {
      const baseDir = await makeTempDir();
      try {
        await assertRejects(
          () => globFiles("../outside/**/*.ts", { baseDir }),
          TypeError,
          "outside the project",
        );
      } finally {
        await remove(baseDir, { recursive: true });
      }
    });

    it("treats only a missing static glob root as no matches", async () => {
      const baseDir = await makeTempDir();
      try {
        assertEquals(
          await globFiles("optional/**/*.tsx", { baseDir }),
          [],
        );
        await assertRejects(
          () =>
            globFiles("blocked/**/*.tsx", {
              baseDir,
              fs: {
                readDir() {
                  throw new Error("blocked");
                },
              },
            }),
          Error,
          "blocked",
        );
      } finally {
        await remove(baseDir, { recursive: true });
      }
    });
  });
});
