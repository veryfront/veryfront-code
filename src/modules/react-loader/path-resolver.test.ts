import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeModulePath, resolveRelativePath } from "./path-resolver.ts";

describe("modules/react-loader/path-resolver", () => {
  describe("resolveRelativePath", () => {
    it("should strip project dir prefix", () => {
      assertEquals(
        resolveRelativePath("/home/user/project/src/app.tsx", "/home/user/project"),
        "src/app.tsx",
      );
    });

    it("should handle trailing slash on project dir", () => {
      assertEquals(
        resolveRelativePath("/home/user/project/src/app.tsx", "/home/user/project/"),
        "src/app.tsx",
      );
    });

    it("should return relative path unchanged", () => {
      assertEquals(resolveRelativePath("src/app.tsx", "/home/user/project"), "src/app.tsx");
    });

    it("should find project dir name in path parts", () => {
      assertEquals(
        resolveRelativePath("/data/repos/myproject/pages/index.tsx", "/other/myproject"),
        "pages/index.tsx",
      );
    });

    it("should return path as-is when project dir not found", () => {
      assertEquals(
        resolveRelativePath("/completely/different/path.tsx", "/home/user/project"),
        "/completely/different/path.tsx",
      );
    });
  });

  describe("normalizeModulePath", () => {
    it("should convert .tsx to .js", () => {
      assertEquals(normalizeModulePath("component.tsx"), "component.js");
    });

    it("should convert .ts to .js", () => {
      assertEquals(normalizeModulePath("utils.ts"), "utils.js");
    });

    it("should convert .jsx to .js", () => {
      assertEquals(normalizeModulePath("app.jsx"), "app.js");
    });

    it("should leave .js unchanged", () => {
      assertEquals(normalizeModulePath("module.js"), "module.js");
    });

    it("should leave non-matching extensions unchanged", () => {
      assertEquals(normalizeModulePath("style.css"), "style.css");
    });
  });
});
