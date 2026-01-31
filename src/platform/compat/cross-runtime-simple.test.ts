/**
 * Simple Cross-Runtime Compatibility Test
 *
 * Tests the platform compat layer using relative imports (no import maps needed).
 * This test can run in Deno, Node.js, and Bun without any configuration.
 *
 * Run with:
 *   deno test src/platform/compat/cross-runtime-simple.test.ts
 *   npx tsx --test src/platform/compat/cross-runtime-simple.test.ts
 *   bun test src/platform/compat/cross-runtime-simple.test.ts
 */

import { assert, assertEquals } from "#std/assert.ts";
import { describe, it } from "#std/testing/bdd.ts";

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

function getCurrentRuntime(): string {
  if (isDeno) return "Deno";
  if (isBun) return "Bun";
  if (isNode) return "Node.js";
  return "Unknown";
}

console.log(`\n\x1b[1m=== Cross-Runtime Compatibility Test ===\x1b[0m`);
console.log(`Runtime: \x1b[36m${getCurrentRuntime()}\x1b[0m`);
console.log(`Version: \x1b[36m${getRuntimeVersion()}\x1b[0m\n`);

describe("Path Operations", () => {
  it("join combines paths", () => {
    const result = join("foo", "bar", "baz.txt");
    assert(result.includes("foo") && result.includes("bar"), "should contain path parts");
  });

  it("basename extracts filename", () => {
    assertEquals(basename("/path/to/file.txt"), "file.txt");
  });

  it("dirname extracts directory", () => {
    assertEquals(dirname("/path/to/file.txt"), "/path/to");
  });

  it("extname extracts extension", () => {
    assertEquals(extname("file.txt"), ".txt");
  });

  it("isAbsolute detects paths", () => {
    assertEquals(isAbsolute("/absolute"), true);
    assertEquals(isAbsolute("relative"), false);
  });

  it("normalize handles ..", () => {
    const result = normalize("/foo/bar/../baz");
    assert(!result.includes(".."), "should resolve ..");
  });

  it("relative computes path", () => {
    assertEquals(relative("/foo/bar", "/foo/baz"), "../baz");
  });

  it("resolve creates absolute", () => {
    assert(isAbsolute(resolve("rel")), "should be absolute");
  });

  it("parse breaks down path", () => {
    const p = parse("/path/to/file.txt");
    assertEquals(p.base, "file.txt");
    assertEquals(p.ext, ".txt");
  });

  it("sep equals SEPARATOR", () => {
    assertEquals(sep, SEPARATOR);
  });
});

describe("Process Operations", () => {
  it("cwd returns directory", () => {
    const dir = cwd();
    assert(typeof dir === "string" && dir.length > 0, "should return string");
  });

  it("getArgs returns array", () => {
    assert(Array.isArray(getArgs()), "should be array");
  });

  it("env returns object", () => {
    assert(typeof env() === "object", "should be object");
  });

  it("setEnv/getEnv/deleteEnv", () => {
    const key = `TEST_${Date.now()}`;
    setEnv(key, "value");
    assertEquals(getEnv(key), "value");
    deleteEnv(key);
    assertEquals(getEnv(key), undefined);
  });

  it("pid returns number", () => {
    const p = pid();
    assert(typeof p === "number" && p > 0, "should be positive number");
  });

  it("memoryUsage returns stats", () => {
    const m = memoryUsage();
    assert(typeof m.heapUsed === "number", "should have heapUsed");
  });

  it("getRuntimeVersion works", () => {
    const v = getRuntimeVersion();
    assert(v.length > 0, "should return version");
  });

  it("unrefTimer works", () => {
    const t = setInterval(() => {}, 10000);
    unrefTimer(t);
    clearInterval(t);
  });
});

describe("Filesystem Operations", () => {
  it("createFileSystem returns interface", () => {
    const fs = createFileSystem();
    assert(typeof fs.readTextFile === "function", "should have readTextFile");
    assert(typeof fs.exists === "function", "should have exists");
  });

  it("fs.exists works", async () => {
    const fs = createFileSystem();
    assertEquals(await fs.exists("/this/does/not/exist/xyz"), false);
  });
});

describe("Runtime Detection", () => {
  it("exactly one runtime detected", () => {
    assertEquals(
      [isDeno, isBun, isNode].filter(Boolean).length,
      1,
      "should detect exactly one runtime",
    );
  });

  it("version matches runtime", () => {
    const v = getRuntimeVersion();

    if (isDeno) {
      assert(v.startsWith("Deno"), "should be Deno");
      return;
    }

    if (isBun) {
      assert(v.startsWith("Bun"), "should be Bun");
      return;
    }

    if (isNode) {
      assert(v.startsWith("Node"), "should be Node");
    }
  });
});
