import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCanonicalProjectRelativePath,
  isCanonicalProjectRelativePath,
  resolveCanonicalProjectRelativePath,
} from "./project-relative-path.ts";

describe("utils/project-relative-path", () => {
  it("accepts one canonical portable spelling", () => {
    assertEquals(
      assertCanonicalProjectRelativePath("src/styles/globals.css", "Stylesheet path"),
      "src/styles/globals.css",
    );
    assertEquals(isCanonicalProjectRelativePath(".config/theme.css"), true);
  });

  it("rejects absolute, traversal, alias, URL, and control-character paths", () => {
    for (
      const path of [
        "/globals.css",
        "C:\\project\\globals.css",
        "../globals.css",
        "styles/../globals.css",
        "./globals.css",
        "styles//globals.css",
        "styles/",
        "file:///project/globals.css",
        "https://example.com/globals.css",
        "styles/\u0000globals.css",
      ]
    ) {
      assertThrows(
        () => assertCanonicalProjectRelativePath(path, "Stylesheet path"),
        TypeError,
        "Stylesheet path",
      );
      assertEquals(isCanonicalProjectRelativePath(path), false);
    }
  });

  it("resolves validated paths beneath an absolute project root", () => {
    assertEquals(
      resolveCanonicalProjectRelativePath(
        "/workspace/project",
        "styles/globals.css",
        "Stylesheet path",
      ),
      "/workspace/project/styles/globals.css",
    );
    assertThrows(
      () => resolveCanonicalProjectRelativePath("project", "globals.css", "Stylesheet path"),
      TypeError,
      "project directory must be absolute",
    );
  });
});
