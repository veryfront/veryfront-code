
import { assert, assertEquals, assertExists as _assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import {
  basicMinify,
  calculateSavings,
  extractSelectors,
  findCSSFiles,
  getOutputPath,
  globFiles,
  matchPattern,
  shouldKeepSelector,
} from "./utils.ts";

const TEST_DIR = "./.veryfront/test-css-utils";

async function cleanupTestDir() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
  }
}

Deno.test("utils - findCSSFiles", async () => {
  await cleanupTestDir();
  await ensureDir(join(TEST_DIR, "styles"));

  await Deno.writeTextFile(join(TEST_DIR, "styles", "main.css"), ".test {}");
  await Deno.writeTextFile(join(TEST_DIR, "styles", "theme.css"), ".theme {}");

  const files = await findCSSFiles(join(TEST_DIR, "styles"));

  assertEquals(files.length, 2);
  assert(files.some((f) => f.includes("main.css")));
  assert(files.some((f) => f.includes("theme.css")));

  await cleanupTestDir();
});

Deno.test("utils - matchPattern with wildcards", () => {
  assert(matchPattern("test.ts", "*.ts"));
  assert(matchPattern("component.tsx", "*.tsx"));
  assert(!matchPattern("test.ts", "*.tsx"));
});

Deno.test("utils - matchPattern with braces", () => {
  assert(matchPattern("test.tsx", "*.{ts,tsx}"));
  assert(matchPattern("test.ts", "*.{ts,tsx}"));
  assert(!matchPattern("test.js", "*.{ts,tsx}"));
});

Deno.test("utils - getOutputPath", () => {
  const result = getOutputPath("styles/main.css", ".output");
  assertEquals(result, ".output/styles/main.min.css");
});

Deno.test("utils - extractSelectors from className", () => {
  const content = '<div className="button primary">Test</div>';
  const result = extractSelectors(content);

  assertEquals(result.classes.includes("button"), true);
  assertEquals(result.classes.includes("primary"), true);
  assertEquals(result.selectors.has(".button"), true);
  assertEquals(result.selectors.has(".primary"), true);
});

Deno.test("utils - extractSelectors from class attribute", () => {
  const content = '<div class="card header">Test</div>';
  const result = extractSelectors(content);

  assertEquals(result.classes.includes("card"), true);
  assertEquals(result.classes.includes("header"), true);
});

Deno.test("utils - extractSelectors from id attribute", () => {
  const content = '<div id="main-content">Test</div>';
  const result = extractSelectors(content);

  assertEquals(result.ids.includes("main-content"), true);
  assertEquals(result.selectors.has("#main-content"), true);
});

Deno.test("utils - extractSelectors from tags", () => {
  const content = "<header><nav><button>Test</button></nav></header>";
  const result = extractSelectors(content);

  assertEquals(result.tags.includes("header"), true);
  assertEquals(result.tags.includes("nav"), true);
  assertEquals(result.tags.includes("button"), true);
});

Deno.test("utils - shouldKeepSelector with universal rules", () => {
  const used = new Set([".button"]);

  assertEquals(shouldKeepSelector("*", used), true);
  assertEquals(shouldKeepSelector(":root", used), true);
  assertEquals(shouldKeepSelector("html", used), true);
  assertEquals(shouldKeepSelector("body", used), true);
});

Deno.test("utils - shouldKeepSelector with used selectors", () => {
  const used = new Set([".button", "#main"]);

  assertEquals(shouldKeepSelector(".button", used), true);
  assertEquals(shouldKeepSelector("#main", used), true);
  assertEquals(shouldKeepSelector(".unused", used), false);
});

Deno.test("utils - shouldKeepSelector with compound selectors", () => {
  const used = new Set([".button", ".card"]);

  assertEquals(shouldKeepSelector(".button .icon", used), true);
  assertEquals(shouldKeepSelector(".card > .title", used), true);
  assertEquals(shouldKeepSelector(".unused .icon", used), false);
});

Deno.test("utils - basicMinify removes comments", () => {
  const css = " .button { color: red; }";
  const minified = basicMinify(css);

  assertEquals(minified.includes("

  assertEquals(files.length >= 2, true);
  assert(files.some((f) => f.includes("test.tsx")));
  assert(files.some((f) => f.includes("test.ts")));

  await cleanupTestDir();
});
