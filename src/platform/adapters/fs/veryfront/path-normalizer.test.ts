import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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

    it("should strip projectDir prefix", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(normalizer.normalize("/project/src/file.ts"), "src/file.ts");
    });

    it("should not modify path without projectDir prefix", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(normalizer.normalize("/other/src/file.ts"), "other/src/file.ts");
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
