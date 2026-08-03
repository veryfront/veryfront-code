import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

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

    it("should reject traversal segments in projectDir", () => {
      for (const projectDir of ["/project/..", "../project", "/project//../root"]) {
        const error = assertThrows(
          () => new PathNormalizer(projectDir),
          VeryfrontError,
          'project directory must not contain ".." segments',
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "config-validation-failed");
      }
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

    it("should canonicalize current-directory segments before stripping projectDir", () => {
      const normalizer = new PathNormalizer("/project/./root");
      assertEquals(normalizer.normalize("/project/root/src/file.ts"), "src/file.ts");
      assertEquals(normalizer.normalize("/project/./root/src/file.ts"), "src/file.ts");
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

    it("should only strip projectDir at a path-segment boundary", () => {
      const normalizer = new PathNormalizer("/project/root");
      assertEquals(
        normalizer.normalize("/project/root-other/src/page.tsx"),
        "project/root-other/src/page.tsx",
      );
    });

    it("should reject traversal segments", () => {
      const normalizer = new PathNormalizer("/project");
      assertThrows(
        () => normalizer.normalize("/project/src/../secrets.ts"),
        TypeError,
        'must not contain ".." segments',
      );
      assertThrows(
        () => normalizer.normalize("../../../../user/repos"),
        TypeError,
        'must not contain ".." segments',
      );
    });

    it("should normalize current-directory segments away", () => {
      const normalizer = new PathNormalizer("/project");
      assertEquals(normalizer.normalize("src/./page.tsx"), "src/page.tsx");
      assertEquals(normalizer.normalize("./src/page.tsx"), "src/page.tsx");
    });

    it("should reject backslashes and control characters", () => {
      const normalizer = new PathNormalizer();
      assertThrows(
        () => normalizer.normalize("src\\secrets.ts"),
        TypeError,
        "must use forward slashes",
      );
      assertThrows(
        () => normalizer.normalize("src/\u0000secrets.ts"),
        TypeError,
        "must not contain control characters",
      );
    });

    it("should reject C1 control characters like the GitHub normalizer", () => {
      const normalizer = new PathNormalizer();
      // U+0080 and U+009F bound the C1 range; NUL is the C0 control anchor.
      for (const codeUnit of [0x00, 0x80, 0x9f]) {
        assertThrows(
          () => normalizer.normalize(`src/${String.fromCharCode(codeUnit)}secrets.ts`),
          TypeError,
          "must not contain control characters",
        );
      }
    });

    it("should reject unbounded paths", () => {
      const normalizer = new PathNormalizer();
      assertThrows(
        () => normalizer.normalize("a".repeat(4_097)),
        TypeError,
        "exceeds the 4096-character limit",
      );
    });
  });
});
