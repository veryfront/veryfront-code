import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
      expected: "C:/Users/dev/AppData/Local/Temp/deno-compile-xyz",
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
      name: "should use the last src segment when a project lives under a src directory",
      input: "/home/me/src/apps/site/src/modules/server.ts",
      expected: "/home/me/src/apps/site",
    },
    {
      name: "should use the last src segment on Windows paths",
      input: String.raw`C:\src\work\app\src\mod.ts`,
      expected: "C:/src/work/app",
    },
    {
      name: "should handle empty string",
      input: "",
      expected: "",
    },
    {
      name: "should resolve a published dist path",
      input: "/opt/veryfront/dist/platform/compat/vfs-paths.js",
      expected: "/opt/veryfront",
    },
    {
      name: "should resolve an embedded framework source path",
      input: "/opt/veryfront/dist/framework-src/react/index.ts.src",
      expected: "/opt/veryfront",
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
    {
      name: "should decode URL-encoded filesystem paths",
      input: "file:///Users/dev/code/veryfront%20server/src/platform/compat/vfs-paths.ts",
      expected: "/Users/dev/code/veryfront server",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      assertEquals(getFrameworkRootFromMeta(input), expected);
    });
  }

  it("rejects non-file URLs and unknown layouts", () => {
    assertThrows(
      () => getFrameworkRootFromMeta("https://example.com/src/platform/file.ts"),
      TypeError,
    );
    assertThrows(
      () => getFrameworkRootFromMeta("file:///opt/veryfront/platform/file.js"),
      Error,
      "Cannot determine framework root",
    );
  });
});

describe("testGetFrameworkRoot (export for testing)", () => {
  it("should be same as getFrameworkRoot", () => {
    const path = "/app/src/test.ts";
    assertEquals(testGetFrameworkRoot(path), getFrameworkRoot(path));
  });
});
