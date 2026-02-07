import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getFrameworkRoot, getFrameworkRootFromMeta, testGetFrameworkRoot } from "./vfs-paths.ts";

describe("getFrameworkRoot", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: "should resolve Unix dev path correctly",
      input: "/Users/dev/code/veryfront-server/src/modules/server/module-server.ts",
      expected: "/Users/dev/code/veryfront-server",
    },
    {
      name: "should resolve Linux dev path correctly",
      input: "/home/developer/projects/veryfront-server/src/platform/compat/vfs-paths.ts",
      expected: "/home/developer/projects/veryfront-server",
    },
    {
      name: "should resolve deno-compile VFS path",
      input: "/tmp/deno-compile-veryfront/src/modules/server/module-server.ts",
      expected: "/tmp/deno-compile-veryfront",
    },
    {
      name: "should handle VFS path with random suffix",
      input: "/var/folders/xyz/deno-compile-abc123def/src/platform/compat/runtime.ts",
      expected: "/var/folders/xyz/deno-compile-abc123def",
    },
    {
      name: "should resolve production /app path",
      input: "/app/src/modules/server/module-server.ts",
      expected: "/app",
    },
    {
      name: "should resolve Windows dev path with backslashes",
      input: "C:\\Users\\dev\\code\\veryfront-server\\src\\modules\\server\\module-server.ts",
      expected: "C:/Users/dev/code/veryfront-server",
    },
    {
      name: "should resolve Windows deno-compile VFS path",
      input: "C:\\Users\\dev\\AppData\\Local\\Temp\\deno-compile-xyz\\src\\platform\\runtime.ts",
      expected: "C:\\Users\\dev\\AppData\\Local\\Temp\\deno-compile-xyz",
    },
    {
      name: "should handle mixed slashes",
      input: "C:\\Users\\dev/code/veryfront-server/src\\modules/server.ts",
      expected: "C:/Users/dev/code/veryfront-server",
    },
    {
      name: "should return empty string for path without src/",
      input: "/app/modules/server.ts",
      expected: "",
    },
    {
      name: "should use last src/ when multiple exist",
      input: "/home/src-user/projects/veryfront-server/src/modules/server.ts",
      expected: "/home/src-user/projects/veryfront-server",
    },
    {
      name: "should handle empty string",
      input: "",
      expected: "",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      assertEquals(getFrameworkRoot(input), expected);
    });
  }
});

describe("getFrameworkRootFromMeta", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: "should resolve from file:// URL",
      input: "file:///Users/dev/code/veryfront-server/src/platform/compat/vfs-paths.ts",
      expected: "/Users/dev/code/veryfront-server",
    },
    {
      name: "should resolve VFS URL from compiled binary",
      input: "file:///tmp/deno-compile-veryfront/src/modules/server/module-server.ts",
      expected: "/tmp/deno-compile-veryfront",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      assertEquals(getFrameworkRootFromMeta(input), expected);
    });
  }
});

describe("testGetFrameworkRoot (export for testing)", () => {
  it("should be same as getFrameworkRoot", () => {
    const path = "/app/src/test.ts";
    assertEquals(testGetFrameworkRoot(path), getFrameworkRoot(path));
  });
});
