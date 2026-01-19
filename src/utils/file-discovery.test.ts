/**
 * Tests for consolidated file discovery utility
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { collectFiles, countFiles, discoverFiles, hasMatchingFiles } from "./file-discovery.ts";
import { cwd } from "../platform/compat/process.ts";

const TEST_DIR = join(cwd(), "src/utils");

describe("file-discovery", () => {
  it("discovers files with extension filter", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      recursive: false,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(files.every((f) => f.name.endsWith(".ts")), true);
    assertEquals(files.every((f) => f.isFile), true);
  });

  it("discovers files recursively", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src/utils"),
      extensions: [".ts"],
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(files.some((f) => f.depth > 0), true);
  });

  it("filters by pattern", async () => {
    const files = await collectFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      patterns: ["test"],
      recursive: false,
    });

    assertExists(files);
    assertEquals(files.every((f) => f.name.includes("test")), true);
  });

  it("respects maxDepth", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src"),
      extensions: [".ts"],
      maxDepth: 1,
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.every((f) => f.depth <= 1), true);
  });

  it("ignores patterns", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src/utils"),
      extensions: [".ts"],
      ignorePatterns: ["test"],
      recursive: true,
    });

    assertExists(files);
    assertEquals(files.every((f) => !f.name.includes("test")), true);
  });

  it("includes directories when requested", async () => {
    const results = await collectFiles({
      baseDir: join(cwd(), "src/utils"),
      includeDirs: true,
      recursive: false,
    });

    assertExists(results);
    assertEquals(results.some((r) => r.isDirectory), true);
  });

  it("async generator iteration", async () => {
    let count = 0;
    for await (
      const _file of discoverFiles({
        baseDir: TEST_DIR,
        extensions: [".ts"],
        recursive: false,
      })
    ) {
      count++;
    }
    assertEquals(count > 0, true);
  });

  it("hasMatchingFiles returns true when files exist", async () => {
    const hasFiles = await hasMatchingFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
    });

    assertEquals(hasFiles, true);
  });

  it("hasMatchingFiles returns false when no files match", async () => {
    const hasFiles = await hasMatchingFiles({
      baseDir: TEST_DIR,
      extensions: [".nonexistent"],
    });

    assertEquals(hasFiles, false);
  });

  it("countFiles counts correctly", async () => {
    const count = await countFiles({
      baseDir: TEST_DIR,
      extensions: [".ts"],
      recursive: false,
    });

    assertEquals(count > 0, true);
  });

  it("handles non-existent directory gracefully", async () => {
    const files = await collectFiles({
      baseDir: "/nonexistent/directory",
      extensions: [".ts"],
    });

    assertEquals(files.length, 0);
  });

  it("discovers multiple extension types", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src/routing"),
      extensions: [".ts", ".tsx"],
      maxDepth: 1,
    });

    assertExists(files);
    assertEquals(files.length > 0, true);
    assertEquals(
      files.every((f) => f.name.endsWith(".ts") || f.name.endsWith(".tsx")),
      true,
    );
  });

  it("combines extension and pattern filters", async () => {
    const files = await collectFiles({
      baseDir: join(cwd(), "src/routing"),
      extensions: [".ts"],
      patterns: ["route"],
      maxDepth: 1,
    });

    assertExists(files);
    if (files.length > 0) {
      assertEquals(files.every((f) => f.name.endsWith(".ts")), true);
      assertEquals(files.every((f) => f.name.includes("route")), true);
    }
  });
});
