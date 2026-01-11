/**
 * Cross-Runtime Compatibility Tests
 *
 * These tests verify that the platform compat layer works correctly
 * across Deno, Node.js, and Bun runtimes.
 *
 * Run with:
 *   deno test src/platform/compat/cross-runtime.test.ts
 *   npx tsx --test src/platform/compat/cross-runtime.test.ts
 *   bun test src/platform/compat/cross-runtime.test.ts
 */

// Use a portable assertion approach
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const pass = actual === expected ||
    (typeof actual === "object" && typeof expected === "object" &&
      JSON.stringify(actual) === JSON.stringify(expected));
  if (!pass) {
    throw new Error(
      `${message || "assertEquals"}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertExists<T>(value: T, message?: string): void {
  if (value === null || value === undefined) {
    throw new Error(`${message || "assertExists"}: value is ${value}`);
  }
}

// Import platform compat modules
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
  SEPARATOR,
} from "./path/index.ts";

import {
  cwd,
  deleteEnv,
  env,
  getArgs,
  getEnv,
  getRuntimeVersion,
  memoryUsage,
  pid,
  setEnv,
  unrefTimer,
} from "./process.ts";

import { createFileSystem } from "./fs.ts";

import { isBun, isDeno, isNode } from "./runtime.ts";

// Test runner
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ name, passed: false, error: errorMsg });
      console.log(`  \x1b[31m✗\x1b[0m ${name}`);
      console.log(`    \x1b[31m${errorMsg}\x1b[0m`);
    }
  };
  // Queue test to run after module loads
  queueMicrotask(run);
}

// Detect current runtime for reporting
function getCurrentRuntime(): string {
  if (isDeno) return "Deno";
  if (isBun) return "Bun";
  if (isNode) return "Node.js";
  return "Unknown";
}

console.log(`\n\x1b[1mCross-Runtime Compatibility Tests\x1b[0m`);
console.log(`Runtime: \x1b[36m${getCurrentRuntime()}\x1b[0m`);
console.log(`Version: \x1b[36m${getRuntimeVersion()}\x1b[0m\n`);

// ============================================================================
// Path Tests
// ============================================================================

console.log("\x1b[1mPath Operations:\x1b[0m");

test("join combines paths", () => {
  const result = join("foo", "bar", "baz.txt");
  assert(result.includes("foo"), "should contain foo");
  assert(result.includes("bar"), "should contain bar");
  assert(result.includes("baz.txt"), "should contain baz.txt");
});

test("basename extracts filename", () => {
  assertEquals(basename("/path/to/file.txt"), "file.txt");
  assertEquals(basename("/path/to/dir"), "dir");
  // Note: trailing slash gives empty string (standard behavior)
  assertEquals(basename("/path/to/dir/"), "");
});

test("dirname extracts directory", () => {
  assertEquals(dirname("/path/to/file.txt"), "/path/to");
});

test("extname extracts extension", () => {
  assertEquals(extname("file.txt"), ".txt");
  assertEquals(extname("file.tar.gz"), ".gz");
  assertEquals(extname("noext"), "");
});

test("isAbsolute detects absolute paths", () => {
  assertEquals(isAbsolute("/absolute/path"), true);
  assertEquals(isAbsolute("relative/path"), false);
  assertEquals(isAbsolute("./relative"), false);
});

test("normalize handles .. and .", () => {
  const result = normalize("/foo/bar/../baz/./qux");
  assert(result.includes("foo"), "should contain foo");
  assert(result.includes("baz"), "should contain baz");
  assert(!result.includes(".."), "should not contain ..");
});

test("relative computes relative path", () => {
  const result = relative("/foo/bar", "/foo/baz");
  assertEquals(result, "../baz");
});

test("resolve creates absolute path", () => {
  const result = resolve("relative", "path");
  assert(isAbsolute(result), "result should be absolute");
});

test("parse breaks down path", () => {
  const parsed = parse("/path/to/file.txt");
  assertExists(parsed.dir);
  assertExists(parsed.base);
  assertExists(parsed.ext);
  assertExists(parsed.name);
  assertEquals(parsed.base, "file.txt");
  assertEquals(parsed.ext, ".txt");
  assertEquals(parsed.name, "file");
});

test("sep and SEPARATOR are consistent", () => {
  assertEquals(sep, SEPARATOR);
  assert(sep === "/" || sep === "\\", "sep should be / or \\");
});

// ============================================================================
// Process Tests
// ============================================================================

console.log("\n\x1b[1mProcess Operations:\x1b[0m");

test("cwd returns current directory", () => {
  const dir = cwd();
  assertEquals(typeof dir, "string");
  assert(dir.length > 0, "cwd should not be empty");
  assert(isAbsolute(dir), "cwd should be absolute");
});

test("getArgs returns array", () => {
  const args = getArgs();
  assertEquals(Array.isArray(args), true);
});

test("env returns object", () => {
  const envObj = env();
  assertEquals(typeof envObj, "object");
});

test("setEnv/getEnv/deleteEnv work correctly", () => {
  const key = `TEST_VAR_${Date.now()}`;
  const value = "test_value_123";

  // Set
  setEnv(key, value);
  assertEquals(getEnv(key), value);

  // Update
  setEnv(key, "updated");
  assertEquals(getEnv(key), "updated");

  // Delete
  deleteEnv(key);
  assertEquals(getEnv(key), undefined);
});

test("pid returns positive number", () => {
  const p = pid();
  assertEquals(typeof p, "number");
  assert(p > 0, "pid should be positive");
});

test("memoryUsage returns valid stats", () => {
  const usage = memoryUsage();
  assertEquals(typeof usage.rss, "number");
  assertEquals(typeof usage.heapTotal, "number");
  assertEquals(typeof usage.heapUsed, "number");
  assertEquals(typeof usage.external, "number");
  assert(usage.rss > 0, "rss should be positive");
  assert(usage.heapUsed > 0, "heapUsed should be positive");
});

test("getRuntimeVersion returns valid string", () => {
  const version = getRuntimeVersion();
  assertEquals(typeof version, "string");
  assert(version.length > 0, "version should not be empty");
  // Should start with runtime name
  assert(
    version.startsWith("Deno") || version.startsWith("Node") || version.startsWith("Bun"),
    `version should start with runtime name, got: ${version}`,
  );
});

test("unrefTimer accepts interval", () => {
  const timer = setInterval(() => {}, 10000);
  // Should not throw
  unrefTimer(timer);
  clearInterval(timer);
});

// ============================================================================
// Filesystem Tests
// ============================================================================

console.log("\n\x1b[1mFilesystem Operations:\x1b[0m");

test("createFileSystem returns valid interface", () => {
  const fs = createFileSystem();
  assertExists(fs.readTextFile);
  assertExists(fs.writeTextFile);
  assertExists(fs.exists);
  assertExists(fs.stat);
  assertExists(fs.mkdir);
  assertExists(fs.remove);
  assertEquals(typeof fs.readTextFile, "function");
  assertEquals(typeof fs.writeTextFile, "function");
});

test("fs.exists works for known paths", async () => {
  const fs = createFileSystem();
  // Current file should exist
  const thisFile = new URL(import.meta.url).pathname;
  const exists = await fs.exists(thisFile);
  assertEquals(exists, true);

  // Random path should not exist
  const notExists = await fs.exists("/this/path/definitely/does/not/exist/xyz123");
  assertEquals(notExists, false);
});

test("fs.stat returns file info", async () => {
  const fs = createFileSystem();
  const thisFile = new URL(import.meta.url).pathname;
  const stat = await fs.stat(thisFile);
  assertEquals(stat.isFile, true);
  assertEquals(stat.isDirectory, false);
});

test("fs.readTextFile reads this test file", async () => {
  const fs = createFileSystem();
  const thisFile = new URL(import.meta.url).pathname;
  const content = await fs.readTextFile(thisFile);
  assert(content.includes("Cross-Runtime Compatibility Tests"), "should read this file");
});

// ============================================================================
// Runtime Detection Tests
// ============================================================================

console.log("\n\x1b[1mRuntime Detection:\x1b[0m");

test("exactly one runtime is detected", () => {
  const runtimes = [isDeno, isBun, isNode].filter(Boolean);
  assertEquals(runtimes.length, 1, "exactly one runtime should be detected");
});

test("detected runtime matches version string", () => {
  const version = getRuntimeVersion();
  if (isDeno) {
    assert(version.startsWith("Deno"), "version should start with Deno");
  } else if (isBun) {
    assert(version.startsWith("Bun"), "version should start with Bun");
  } else if (isNode) {
    assert(version.startsWith("Node"), "version should start with Node");
  }
});

// ============================================================================
// Summary
// ============================================================================

// Print summary after all tests complete
setTimeout(() => {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`\n\x1b[1mSummary:\x1b[0m`);
  console.log(`  Total:  ${total}`);
  console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
  if (failed > 0) {
    console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
    console.log("\n\x1b[31mFailed tests:\x1b[0m");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    // Exit with error code
    if (typeof Deno !== "undefined") {
      Deno.exit(1);
    } else if (typeof process !== "undefined") {
      process.exit(1);
    }
  } else {
    console.log(`\n\x1b[32mAll tests passed!\x1b[0m\n`);
  }
}, 1000);
