import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeGitHubPath } from "./path-utils.ts";

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
      ["handles path equal to projectDir", "/project", "/project", ""],
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
  });
});
