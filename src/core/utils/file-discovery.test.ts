
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { collectFiles, countFiles, discoverFiles, hasMatchingFiles } from "./file-discovery.ts";
import { cwd } from "../../platform/compat/process.ts";

const TEST_DIR = join(cwd(), "src/core/utils");

Deno.test("file-discovery: discovers files with extension filter", async () => {
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

Deno.test("file-discovery: discovers files recursively", async () => {
  const files = await collectFiles({
    baseDir: join(cwd(), "src/core"),
    extensions: [".ts"],
    recursive: true,
  });

  assertExists(files);
  assertEquals(files.length > 0, true);
  assertEquals(files.some((f) => f.depth > 0), true);
});

Deno.test("file-discovery: filters by pattern", async () => {
  const files = await collectFiles({
    baseDir: TEST_DIR,
    extensions: [".ts"],
    patterns: ["test"],
    recursive: false,
  });

  assertExists(files);
  assertEquals(files.every((f) => f.name.includes("test")), true);
});

Deno.test("file-discovery: respects maxDepth", async () => {
  const files = await collectFiles({
    baseDir: join(cwd(), "src"),
    extensions: [".ts"],
    maxDepth: 1,
    recursive: true,
  });

  assertExists(files);
  assertEquals(files.every((f) => f.depth <= 1), true);
});

Deno.test("file-discovery: ignores patterns", async () => {
  const files = await collectFiles({
    baseDir: join(cwd(), "src/core"),
    extensions: [".ts"],
    ignorePatterns: ["test"],
    recursive: true,
  });

  assertExists(files);
  assertEquals(files.every((f) => !f.name.includes("test")), true);
});

Deno.test("file-discovery: includes directories when requested", async () => {
  const results = await collectFiles({
    baseDir: join(cwd(), "src/core"),
    includeDirs: true,
    recursive: false,
  });

  assertExists(results);
  assertEquals(results.some((r) => r.isDirectory), true);
});

Deno.test("file-discovery: async generator iteration", async () => {
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

Deno.test("file-discovery: hasMatchingFiles returns true when files exist", async () => {
  const hasFiles = await hasMatchingFiles({
    baseDir: TEST_DIR,
    extensions: [".ts"],
  });

  assertEquals(hasFiles, true);
});

Deno.test("file-discovery: hasMatchingFiles returns false when no files match", async () => {
  const hasFiles = await hasMatchingFiles({
    baseDir: TEST_DIR,
    extensions: [".nonexistent"],
  });

  assertEquals(hasFiles, false);
});

Deno.test("file-discovery: countFiles counts correctly", async () => {
  const count = await countFiles({
    baseDir: TEST_DIR,
    extensions: [".ts"],
    recursive: false,
  });

  assertEquals(count > 0, true);
});

Deno.test("file-discovery: handles non-existent directory gracefully", async () => {
  const files = await collectFiles({
    baseDir: "/nonexistent/directory",
    extensions: [".ts"],
  });

  assertEquals(files.length, 0);
});

Deno.test("file-discovery: discovers multiple extension types", async () => {
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

Deno.test("file-discovery: combines extension and pattern filters", async () => {
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
