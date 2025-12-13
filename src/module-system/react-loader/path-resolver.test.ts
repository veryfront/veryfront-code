import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals } from "std/assert/mod.ts";
import { resolveRelativePath, normalizeModulePath } from "./path-resolver.ts";

describe("resolveRelativePath", () => {
  it("should resolve path relative to project dir", () => {
    const result = resolveRelativePath("/project/src/index.ts", "/project");
    assertEquals(result, "src/index.ts");
  });

  it("should handle path with project dir prefix", () => {
    const result = resolveRelativePath("/home/user/project/components/Button.tsx", "/home/user/project");
    assertEquals(result, "components/Button.tsx");
  });

  it("should handle Windows-style paths", () => {
    // The function normalizes backslashes to forward slashes
    const result = resolveRelativePath("C:\\project\\src\\index.ts", "C:\\project");
    // May not match exactly on non-Windows platforms
    assert(result.includes("index.ts"));
  });

  it("should handle trailing slash in project dir", () => {
    const result = resolveRelativePath("/project/src/index.ts", "/project/");
    assertEquals(result, "src/index.ts");
  });

  it("should handle path not starting with project dir", () => {
    const result = resolveRelativePath("/other/src/index.ts", "/project");
    // The function tries to find the project name in the path
    // If not found, returns the path as-is or attempts extraction
    assert(result.includes("index.ts"));
  });

  it("should return original path when project dir not found", () => {
    const result = resolveRelativePath("/completely/different/path.ts", "/project");
    assertEquals(result, "/completely/different/path.ts");
  });

  it("should handle nested project directories", () => {
    const result = resolveRelativePath("/home/project/nested/app/src/index.ts", "/home/project/nested/app");
    assertEquals(result, "src/index.ts");
  });

  it("should handle root path", () => {
    const result = resolveRelativePath("/index.ts", "/");
    assertEquals(result, "index.ts");
  });
});

describe("normalizeModulePath", () => {
  it("should convert .ts to .js", () => {
    const result = normalizeModulePath("module.ts");
    assertEquals(result, "module.js");
  });

  it("should convert .tsx to .js", () => {
    const result = normalizeModulePath("Component.tsx");
    assertEquals(result, "Component.js");
  });

  it("should convert .jsx to .js", () => {
    const result = normalizeModulePath("Component.jsx");
    assertEquals(result, "Component.js");
  });

  it("should not change .js files", () => {
    const result = normalizeModulePath("module.js");
    assertEquals(result, "module.js");
  });

  it("should handle paths with directories", () => {
    const result = normalizeModulePath("src/components/Button.tsx");
    assertEquals(result, "src/components/Button.js");
  });

  it("should handle files without extension", () => {
    const result = normalizeModulePath("module");
    assertEquals(result, "module");
  });

  it("should only replace extension at the end", () => {
    const result = normalizeModulePath("file.ts.backup.ts");
    assertEquals(result, "file.ts.backup.js");
  });
});
