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

import { assert, assertEquals, assertExists } from "#std/assert.ts";
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

function getCurrentRuntime(): string {
  if (isDeno) return "Deno";
  if (isBun) return "Bun";
  if (isNode) return "Node.js";
  return "Unknown";
}

console.log(`\n\x1b[1mCross-Runtime Compatibility Tests\x1b[0m`);
console.log(`Runtime: \x1b[36m${getCurrentRuntime()}\x1b[0m`);
console.log(`Version: \x1b[36m${getRuntimeVersion()}\x1b[0m\n`);

describe("Path Operations", () => {
  it("join combines paths", () => {
    const result = join("foo", "bar", "baz.txt");
    assert(result.includes("foo"), "should contain foo");
    assert(result.includes("bar"), "should contain bar");
    assert(result.includes("baz.txt"), "should contain baz.txt");
  });

  it("basename extracts filename", () => {
    assertEquals(basename("/path/to/file.txt"), "file.txt");
    assertEquals(basename("/path/to/dir"), "dir");
    assertEquals(basename("/path/to/dir/"), "dir");
  });

  it("dirname extracts directory", () => {
    assertEquals(dirname("/path/to/file.txt"), "/path/to");
  });

  it("extname extracts extension", () => {
    assertEquals(extname("file.txt"), ".txt");
    assertEquals(extname("file.tar.gz"), ".gz");
    assertEquals(extname("noext"), "");
  });

  it("isAbsolute detects absolute paths", () => {
    assertEquals(isAbsolute("/absolute/path"), true);
    assertEquals(isAbsolute("relative/path"), false);
    assertEquals(isAbsolute("./relative"), false);
  });

  it("normalize handles .. and .", () => {
    const result = normalize("/foo/bar/../baz/./qux");
    assert(result.includes("foo"), "should contain foo");
    assert(result.includes("baz"), "should contain baz");
    assert(!result.includes(".."), "should not contain ..");
  });

  it("relative computes relative path", () => {
    assertEquals(relative("/foo/bar", "/foo/baz"), "../baz");
  });

  it("resolve creates absolute path", () => {
    const result = resolve("relative", "path");
    assert(isAbsolute(result), "result should be absolute");
  });

  it("parse breaks down path", () => {
    const parsed = parse("/path/to/file.txt");
    assertExists(parsed.dir);
    assertExists(parsed.base);
    assertExists(parsed.ext);
    assertExists(parsed.name);
    assertEquals(parsed.base, "file.txt");
    assertEquals(parsed.ext, ".txt");
    assertEquals(parsed.name, "file");
  });

  it("sep and SEPARATOR are consistent", () => {
    assertEquals(sep, SEPARATOR);
    assert(sep === "/" || sep === "\\", "sep should be / or \\");
  });
});

describe("Process Operations", () => {
  it("cwd returns current directory", () => {
    const dir = cwd();
    assertEquals(typeof dir, "string");
    assert(dir.length > 0, "cwd should not be empty");
    assert(isAbsolute(dir), "cwd should be absolute");
  });

  it("getArgs returns array", () => {
    assertEquals(Array.isArray(getArgs()), true);
  });

  it("env returns object", () => {
    assertEquals(typeof env(), "object");
  });

  it("setEnv/getEnv/deleteEnv work correctly", () => {
    const key = `TEST_VAR_${Date.now()}`;

    setEnv(key, "test_value_123");
    assertEquals(getEnv(key), "test_value_123");

    setEnv(key, "updated");
    assertEquals(getEnv(key), "updated");

    deleteEnv(key);
    assertEquals(getEnv(key), undefined);
  });

  it("pid returns positive number", () => {
    const p = pid();
    assertEquals(typeof p, "number");
    assert(p > 0, "pid should be positive");
  });

  it("memoryUsage returns valid stats", () => {
    const usage = memoryUsage();
    assertEquals(typeof usage.rss, "number");
    assertEquals(typeof usage.heapTotal, "number");
    assertEquals(typeof usage.heapUsed, "number");
    assertEquals(typeof usage.external, "number");
    assert(usage.rss > 0, "rss should be positive");
    assert(usage.heapUsed > 0, "heapUsed should be positive");
  });

  it("getRuntimeVersion returns valid string", () => {
    const version = getRuntimeVersion();
    assertEquals(typeof version, "string");
    assert(version.length > 0, "version should not be empty");
    assert(
      version.startsWith("Deno") || version.startsWith("Node") || version.startsWith("Bun"),
      `version should start with runtime name, got: ${version}`,
    );
  });

  it("unrefTimer accepts interval", () => {
    const timer = setInterval(() => {}, 10000);
    unrefTimer(timer);
    clearInterval(timer);
  });
});

describe("Filesystem Operations", () => {
  it("createFileSystem returns valid interface", () => {
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

  it("fs.exists works for known paths", async () => {
    const fs = createFileSystem();
    const thisFile = new URL(import.meta.url).pathname;

    assertEquals(await fs.exists(thisFile), true);
    assertEquals(await fs.exists("/this/path/definitely/does/not/exist/xyz123"), false);
  });

  it("fs.stat returns file info", async () => {
    const fs = createFileSystem();
    const thisFile = new URL(import.meta.url).pathname;
    const stat = await fs.stat(thisFile);
    assertEquals(stat.isFile, true);
    assertEquals(stat.isDirectory, false);
  });

  it("fs.readTextFile reads this test file", async () => {
    const fs = createFileSystem();
    const thisFile = new URL(import.meta.url).pathname;
    const content = await fs.readTextFile(thisFile);
    assert(content.includes("Cross-Runtime Compatibility Tests"), "should read this file");
  });
});

describe("Runtime Detection", () => {
  it("exactly one runtime is detected", () => {
    assertEquals([isDeno, isBun, isNode].filter(Boolean).length, 1);
  });

  it("detected runtime matches version string", () => {
    const version = getRuntimeVersion();

    if (isDeno) {
      assert(version.startsWith("Deno"), "version should start with Deno");
      return;
    }

    if (isBun) {
      assert(version.startsWith("Bun"), "version should start with Bun");
      return;
    }

    if (isNode) {
      assert(version.startsWith("Node"), "version should start with Node");
    }
  });
});
