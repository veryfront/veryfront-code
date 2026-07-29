import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EMPTY_LAYOUT_RESULT, isDotPath, isHiddenSegment } from "./path-helpers.ts";

describe("path-helpers", () => {
  describe("isHiddenSegment", () => {
    it("returns true for dot-prefixed segments", () => {
      assertEquals(isHiddenSegment(".veryfront"), true);
      assertEquals(isHiddenSegment(".hidden"), true);
      assertEquals(isHiddenSegment(".git"), true);
    });

    it("returns false for . and ..", () => {
      assertEquals(isHiddenSegment("."), false);
      assertEquals(isHiddenSegment(".."), false);
    });

    it("returns false for non-dot segments", () => {
      assertEquals(isHiddenSegment("app"), false);
      assertEquals(isHiddenSegment("pages"), false);
      assertEquals(isHiddenSegment("index.tsx"), false);
    });
  });

  describe("isDotPath", () => {
    it("returns true for slugs with hidden segments", () => {
      assertEquals(isDotPath({ slug: ".veryfront/config", projectDir: "/project" }), true);
      assertEquals(isDotPath({ slug: "pages/.hidden/secret", projectDir: "/project" }), true);
    });

    it("returns false for normal slugs", () => {
      assertEquals(isDotPath({ slug: "app/page", projectDir: "/project" }), false);
      assertEquals(isDotPath({ slug: "pages/index", projectDir: "/project" }), false);
    });

    it("checks filePath when provided", () => {
      assertEquals(
        isDotPath({
          slug: "normal",
          filePath: ".veryfront/cache/file.tsx",
          projectDir: "/project",
        }),
        true,
      );
      assertEquals(
        isDotPath({ slug: "normal", filePath: "pages/index.tsx", projectDir: "/project" }),
        false,
      );
    });

    it("ignores hidden ancestors outside the project", () => {
      const projectDir = "/repo/.worktrees/project";

      assertEquals(
        isDotPath({
          slug: "chat",
          filePath: `${projectDir}/pages/chat/index.tsx`,
          projectDir,
        }),
        false,
      );
      assertEquals(
        isDotPath({
          slug: "hidden",
          filePath: `${projectDir}/pages/.hidden/index.tsx`,
          projectDir,
        }),
        true,
      );
    });

    it("ignores absolute file paths outside the project", () => {
      assertEquals(
        isDotPath({
          slug: "chat",
          filePath: "/repo/.worktrees/another-project/pages/chat/index.tsx",
          projectDir: "/repo/project",
        }),
        false,
      );
    });

    it("returns false for paths with . or ..", () => {
      assertEquals(isDotPath({ slug: "./relative", projectDir: "/project" }), false);
      assertEquals(isDotPath({ slug: "../parent", projectDir: "/project" }), false);
    });
  });

  describe("EMPTY_LAYOUT_RESULT", () => {
    it("has undefined layoutBundle", () => {
      assertEquals(EMPTY_LAYOUT_RESULT.layoutBundle, undefined);
    });

    it("has empty nestedLayouts array", () => {
      assertEquals(EMPTY_LAYOUT_RESULT.nestedLayouts, []);
    });
  });
});
