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
      assertEquals(isDotPath(".veryfront/config"), true);
      assertEquals(isDotPath("pages/.hidden/secret"), true);
    });

    it("returns false for normal slugs", () => {
      assertEquals(isDotPath("app/page"), false);
      assertEquals(isDotPath("pages/index"), false);
    });

    it("checks filePath when provided", () => {
      assertEquals(isDotPath("normal", ".veryfront/cache/file.tsx"), true);
      assertEquals(isDotPath("normal", "pages/index.tsx"), false);
    });

    it("returns false for paths with . or ..", () => {
      assertEquals(isDotPath("./relative"), false);
      assertEquals(isDotPath("../parent"), false);
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
