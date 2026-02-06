import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolvePath } from "./path-utils.ts";

describe("resolvePath", () => {
  it("should return absolute paths as-is", () => {
    assertEquals(resolvePath("/absolute/path"), "/absolute/path");
  });

  it("should return absolute paths with nested dirs as-is", () => {
    assertEquals(resolvePath("/home/user/project"), "/home/user/project");
  });

  it("should resolve relative paths from cwd", () => {
    const result = resolvePath("relative/path");
    // Should be an absolute path (starts with /)
    assertEquals(result.startsWith("/"), true);
    // Should end with the relative part
    assertEquals(result.endsWith("relative/path"), true);
  });

  it("should resolve simple filename from cwd", () => {
    const result = resolvePath("file.ts");
    assertEquals(result.startsWith("/"), true);
    assertEquals(result.endsWith("file.ts"), true);
  });
});
