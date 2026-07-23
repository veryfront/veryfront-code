import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PathNormalizer } from "./path-normalizer.ts";

describe("PathNormalizer", () => {
  describe("class", () => {
    it("should export PathNormalizer class", () => {
      assertExists(PathNormalizer);
      assertEquals(typeof PathNormalizer, "function");
    });

    it("should be instantiable without projectDir", () => {
      assertExists(new PathNormalizer());
    });

    it("should be instantiable with projectDir", () => {
      assertExists(new PathNormalizer("/project"));
    });
  });

  describe("normalize", () => {
    it("should remove leading slashes", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize("/path/to/file"), "path/to/file");
    });

    it("should remove trailing slashes", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize("path/to/file/"), "path/to/file");
    });

    it("should collapse multiple slashes", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize("path//to///file"), "path/to/file");
    });

    it("normalizes Windows project paths", () => {
      const normalizer = new PathNormalizer("C:\\project");
      assertEquals(
        normalizer.normalize("C:\\project\\src\\file.ts"),
        "src/file.ts",
      );
    });

    it("removes current-directory segments", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize("pages/./nested/./page.tsx"), "pages/nested/page.tsx");
    });

    it("rejects traversal, NUL, and encoded separators", () => {
      const normalizer = new PathNormalizer();
      for (
        const path of [
          "../secret.ts",
          "pages/../../secret.ts",
          "pages\\..\\secret.ts",
          "pages/secret\0.ts",
          "pages/%2e%2e/secret.ts",
          "pages/%252e%252e%252fsecret.ts",
        ]
      ) {
        assertThrows(() => normalizer.normalize(path), Error, "unsafe project source path");
      }
    });

    it("should strip projectDir prefix", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(normalizer.normalize("/project/src/file.ts"), "src/file.ts");
    });

    it("rejects absolute paths outside the configured project directory", () => {
      const normalizer = new PathNormalizer("/project");
      assertThrows(
        () => normalizer.normalize("/other/src/file.ts"),
        Error,
        "outside the configured project directory",
      );
    });

    it("does not confuse a sibling path with the configured project prefix", () => {
      const normalizer = new PathNormalizer("/project");
      assertThrows(
        () => normalizer.normalize("/project-other/src/file.ts"),
        Error,
        "outside the configured project directory",
      );
    });

    it("should strip @/ path alias", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize("@/components/Button"), "components/Button");
    });

    it("should handle empty path", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize(""), "");
    });

    it("should handle simple filename", () => {
      const normalizer = new PathNormalizer();
      assertEquals(normalizer.normalize("file.ts"), "file.ts");
    });

    it("should strip projectDir and @/ alias together", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(
        normalizer.normalize("/project/@/components/Button.tsx"),
        "components/Button.tsx",
      );
    });

    it("should not strip @/ when it is not at the beginning", () => {
      const normalizer = new PathNormalizer();
      assertEquals(
        normalizer.normalize("src/@/components/Button.tsx"),
        "src/@/components/Button.tsx",
      );
    });

    it("should normalize to empty string when path equals projectDir", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(normalizer.normalize("/project"), "");
    });

    it("should normalize repeated slashes after stripping projectDir", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(normalizer.normalize("/project//src///page.tsx"), "src/page.tsx");
    });
  });
});
