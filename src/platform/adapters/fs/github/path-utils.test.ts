import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeGitHubPath, normalizeGitHubProjectDir } from "./path-utils.ts";

describe("platform/adapters/fs/github/path-utils", () => {
  describe("normalizeGitHubPath", () => {
    const cases: Array<[string, string, string, string]> = [
      // [description, path, projectDir, expected]
      ["strips projectDir prefix", "/project/src/file.ts", "/project", "src/file.ts"],
      ["strips leading slashes", "///src/file.ts", "", "src/file.ts"],
      ["strips trailing slashes", "src/file.ts///", "", "src/file.ts"],
      ["collapses multiple slashes", "src///dir///file.ts", "", "src/dir/file.ts"],
      ["handles empty path", "", "", ""],
      ["handles root slash only", "/", "", ""],
      ["handles projectDir with slash", "/foo/bar/baz.ts", "/foo", "bar/baz.ts"],
      ["no-op when projectDir does not match", "/other/file.ts", "/project", "other/file.ts"],
      [
        "does not strip a partial projectDir match",
        "/project-two/file.ts",
        "/project",
        "project-two/file.ts",
      ],
      ["handles path equal to projectDir", "/project", "/project", ""],
      ["normalizes dot segments", "src/./nested/../file.ts", "", "src/file.ts"],
      ["normalizes Windows separators", "src\\nested\\file.ts", "", "src/nested/file.ts"],
      ["handles default empty projectDir", "src/file.ts", "", "src/file.ts"],
    ];

    for (const [desc, path, projectDir, expected] of cases) {
      it(desc, () => {
        assertEquals(normalizeGitHubPath(path, projectDir), expected);
      });
    }

    it("should default projectDir to empty string", () => {
      assertEquals(normalizeGitHubPath("/src/file.ts"), "src/file.ts");
    });

    for (
      const unsafePath of [
        "../secret.ts",
        "src/../../secret.ts",
        "src/%2e%2e/secret.ts",
        "src\0file.ts",
        "src\nfile.ts",
      ]
    ) {
      it(`rejects unsafe path ${JSON.stringify(unsafePath)}`, () => {
        assertThrows(() => normalizeGitHubPath(unsafePath), Error, "unsafe project source path");
      });
    }
  });

  describe("normalizeGitHubProjectDir", () => {
    it("preserves absolute roots while canonicalizing separators and dot segments", () => {
      assertEquals(normalizeGitHubProjectDir("/workspace/./project/"), "/workspace/project");
      assertEquals(normalizeGitHubProjectDir("C:\\workspace\\project\\"), "C:/workspace/project");
    });
  });
});
