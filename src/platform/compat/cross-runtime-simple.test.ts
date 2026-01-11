#!/usr/bin/env node
/**
 * Simple Cross-Runtime Compatibility Test
 *
 * Tests the platform compat layer using relative imports (no import maps needed).
 * This test can run in Deno, Node.js, and Bun without any configuration.
 *
 * Run with:
 *   deno run --allow-all src/platform/compat/cross-runtime-simple.test.ts
 *   npx tsx src/platform/compat/cross-runtime-simple.test.ts
 *   bun src/platform/compat/cross-runtime-simple.test.ts
 */

// Use relative imports for cross-runtime compatibility
// Note: Skip security.ts as it has external deps (@veryfront/utils)
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
} from "./path/basic-ops-only.ts";

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

// Simple assertion helpers
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const pass = actual === expected;
  if (!pass) {
    throw new Error(
      `FAIL: ${message || "assertEquals"}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

// Test results
let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      }).catch((err) => {
        failed++;
        failures.push(`${name}: ${err.message}`);
        console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
      });
    } else {
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    }
  } catch (err: unknown) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${msg}`);
  }
}

// Detect runtime
function getCurrentRuntime(): string {
  if (isDeno) return "Deno";
  if (isBun) return "Bun";
  if (isNode) return "Node.js";
  return "Unknown";
}

console.log(`\n\x1b[1m=== Cross-Runtime Compatibility Test ===\x1b[0m`);
console.log(`Runtime: \x1b[36m${getCurrentRuntime()}\x1b[0m`);
console.log(`Version: \x1b[36m${getRuntimeVersion()}\x1b[0m\n`);

// ============================================================================
// Path Tests
// ============================================================================
console.log("\x1b[1mPath Operations:\x1b[0m");

test("join combines paths", () => {
  const result = join("foo", "bar", "baz.txt");
  assert(result.includes("foo") && result.includes("bar"), "should contain path parts");
});

test("basename extracts filename", () => {
  assertEquals(basename("/path/to/file.txt"), "file.txt");
});

test("dirname extracts directory", () => {
  assertEquals(dirname("/path/to/file.txt"), "/path/to");
});

test("extname extracts extension", () => {
  assertEquals(extname("file.txt"), ".txt");
});

test("isAbsolute detects paths", () => {
  assertEquals(isAbsolute("/absolute"), true);
  assertEquals(isAbsolute("relative"), false);
});

test("normalize handles ..", () => {
  const result = normalize("/foo/bar/../baz");
  assert(!result.includes(".."), "should resolve ..");
});

test("relative computes path", () => {
  assertEquals(relative("/foo/bar", "/foo/baz"), "../baz");
});

test("resolve creates absolute", () => {
  assert(isAbsolute(resolve("rel")), "should be absolute");
});

test("parse breaks down path", () => {
  const p = parse("/path/to/file.txt");
  assertEquals(p.base, "file.txt");
  assertEquals(p.ext, ".txt");
});

test("sep equals SEPARATOR", () => {
  assertEquals(sep, SEPARATOR);
});

// ============================================================================
// Process Tests
// ============================================================================
console.log("\n\x1b[1mProcess Operations:\x1b[0m");

test("cwd returns directory", () => {
  const dir = cwd();
  assert(typeof dir === "string" && dir.length > 0, "should return string");
});

test("getArgs returns array", () => {
  assert(Array.isArray(getArgs()), "should be array");
});

test("env returns object", () => {
  assert(typeof env() === "object", "should be object");
});

test("setEnv/getEnv/deleteEnv", () => {
  const key = `TEST_${Date.now()}`;
  setEnv(key, "value");
  assertEquals(getEnv(key), "value");
  deleteEnv(key);
  assertEquals(getEnv(key), undefined);
});

test("pid returns number", () => {
  assert(typeof pid() === "number" && pid() > 0, "should be positive number");
});

test("memoryUsage returns stats", () => {
  const m = memoryUsage();
  assert(typeof m.heapUsed === "number", "should have heapUsed");
});

test("getRuntimeVersion works", () => {
  const v = getRuntimeVersion();
  assert(v.length > 0, "should return version");
});

test("unrefTimer works", () => {
  const t = setInterval(() => {}, 10000);
  unrefTimer(t); // Should not throw
  clearInterval(t);
});

// ============================================================================
// Filesystem Tests
// ============================================================================
console.log("\n\x1b[1mFilesystem Operations:\x1b[0m");

test("createFileSystem returns interface", () => {
  const fs = createFileSystem();
  assert(typeof fs.readTextFile === "function", "should have readTextFile");
  assert(typeof fs.exists === "function", "should have exists");
});

test("fs.exists works", async () => {
  const fs = createFileSystem();
  const exists = await fs.exists("/this/does/not/exist/xyz");
  assertEquals(exists, false);
});

// ============================================================================
// Runtime Detection
// ============================================================================
console.log("\n\x1b[1mRuntime Detection:\x1b[0m");

test("exactly one runtime detected", () => {
  const count = [isDeno, isBun, isNode].filter(Boolean).length;
  assertEquals(count, 1, "should detect exactly one runtime");
});

test("version matches runtime", () => {
  const v = getRuntimeVersion();
  if (isDeno) assert(v.startsWith("Deno"), "should be Deno");
  if (isBun) assert(v.startsWith("Bun"), "should be Bun");
  if (isNode) assert(v.startsWith("Node"), "should be Node");
});

// Print summary after async tests complete
setTimeout(() => {
  console.log(`\n\x1b[1mSummary:\x1b[0m`);
  console.log(`  Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`  Failed: \x1b[${failed > 0 ? "31" : "32"}m${failed}\x1b[0m`);

  if (failed > 0) {
    console.log(`\n\x1b[31mFailures:\x1b[0m`);
    failures.forEach((f) => console.log(`  - ${f}`));
    // deno-lint-ignore no-explicit-any
    (globalThis as any).process?.exit?.(1);
    // @ts-ignore Deno global
    Deno?.exit?.(1);
  } else {
    console.log(`\n\x1b[32mAll tests passed on ${getCurrentRuntime()}!\x1b[0m\n`);
  }
}, 500);
