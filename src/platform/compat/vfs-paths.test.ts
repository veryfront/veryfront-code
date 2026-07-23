import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getFrameworkRoot, getFrameworkRootFromMeta, testGetFrameworkRoot } from "./vfs-paths.ts";

describe("getFrameworkRoot", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: "should resolve Unix dev path correctly",
      input: "/workspace/project/src/modules/server/module-server.ts",
      expected: "/workspace/project",
    },
    {
      name: "should resolve Linux dev path correctly",
      input: "/srv/project/src/platform/compat/vfs-paths.ts",
      expected: "/srv/project",
    },
    {
      name: "should resolve deno-compile VFS path",
      input: "/runtime/deno-compile-veryfront/src/modules/server/module-server.ts",
      expected: "/runtime/deno-compile-veryfront",
    },
    {
      name: "should handle VFS path with random suffix",
      input: "/runtime/session/deno-compile-abc123def/src/platform/compat/runtime.ts",
      expected: "/runtime/session/deno-compile-abc123def",
    },
    {
      name: "should resolve production /app path",
      input: "/app/src/modules/server/module-server.ts",
      expected: "/app",
    },
    {
      name: "should resolve Windows dev path with backslashes",
      input: "C:\\workspace\\project\\src\\modules\\server\\module-server.ts",
      expected: "C:/workspace/project",
    },
    {
      name: "should resolve Windows deno-compile VFS path",
      input: "C:\\runtime\\deno-compile-xyz\\src\\platform\\runtime.ts",
      expected: "C:/runtime/deno-compile-xyz",
    },
    {
      name: "should handle mixed slashes",
      input: "C:\\workspace/project/src\\modules/server.ts",
      expected: "C:/workspace/project",
    },
    {
      name: "should return empty string for path without src/",
      input: "/app/modules/server.ts",
      expected: "",
    },
    {
      name: "should use last src/ when multiple exist",
      input: "/workspace/src-user/project/src/modules/server.ts",
      expected: "/workspace/src-user/project",
    },
    {
      name: "should preserve a POSIX root before src",
      input: "/src/module.ts",
      expected: "/",
    },
    {
      name: "should preserve a Windows drive root before src",
      input: "C:\\src\\module.ts",
      expected: "C:/",
    },
    {
      name: "should preserve a UNC share root",
      input: "\\\\server\\share\\src\\module.ts",
      expected: "//server/share",
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
      input: "file:///workspace/project/src/platform/compat/vfs-paths.ts",
      expected: "/workspace/project",
    },
    {
      name: "should resolve VFS URL from compiled binary",
      input: "file:///runtime/deno-compile-veryfront/src/modules/server/module-server.ts",
      expected: "/runtime/deno-compile-veryfront",
    },
    {
      name: "should decode escaped file URL path segments",
      input: "file:///workspace/project%20name/src/module.ts",
      expected: "/workspace/project name",
    },
    {
      name: "should normalize Windows file URLs",
      input: "file:///C:/workspace/project/src/module.ts",
      expected: "C:/workspace/project",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      assertEquals(getFrameworkRootFromMeta(input), expected);
    });
  }

  it("rejects non-file URLs", () => {
    assertThrows(
      () => getFrameworkRootFromMeta("https://example.invalid/project/src/module.ts"),
      TypeError,
      "file URL",
    );
  });

  it("rejects file URLs without a recognizable framework root", () => {
    assertThrows(
      () => getFrameworkRootFromMeta("file:///workspace/module.ts"),
      Error,
      "could not be resolved",
    );
  });
});

describe("testGetFrameworkRoot (export for testing)", () => {
  it("should be same as getFrameworkRoot", () => {
    const path = "/app/src/test.ts";
    assertEquals(testGetFrameworkRoot(path), getFrameworkRoot(path));
  });
});
