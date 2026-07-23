import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { collectStaticRouteOutputPaths, resolveBuildOutputPath } from "./route-output-paths.ts";

describe("build/production-build/route-output-paths", () => {
  it("allows safe output segments whose names start with two dots", () => {
    assertEquals(
      resolveBuildOutputPath("/output", "..docs/index.html", "docs output"),
      "/output/..docs/index.html",
    );
  });

  it("rejects absolute paths even when they point inside outputDir", () => {
    assertThrows(
      () => resolveBuildOutputPath("/output", "/output/forged.html", "forged output"),
      TypeError,
      "must be relative",
    );
  });

  it("rejects duplicate route paths with different output slugs", () => {
    assertThrows(
      () =>
        collectStaticRouteOutputPaths(
          [
            { slug: "first", path: "/same", file: "pages/first.mdx" },
            { slug: "second", path: "/same", file: "pages/second.mdx" },
          ],
          [],
          "/output",
        ),
      TypeError,
      "Duplicate static route path",
    );
  });

  it("rejects URL queries, fragments, repeated separators, and dot segments", () => {
    for (const path of ["/docs?draft=1", "/docs#title", "/docs//api", "/docs/./api"]) {
      assertThrows(
        () =>
          collectStaticRouteOutputPaths(
            [{ slug: "docs", path, file: "pages/docs.mdx" }],
            [],
            "/output",
          ),
        TypeError,
        "safe absolute URL path",
      );
    }
  });

  it("rejects unsafe Pages Router slugs before resolving output paths", () => {
    for (const slug of ["docs?draft=1", "docs#title", "docs//api", "docs/./api"]) {
      assertThrows(
        () =>
          collectStaticRouteOutputPaths(
            [{ slug, path: "/docs", file: "pages/docs.mdx" }],
            [],
            "/output",
          ),
        TypeError,
        "safe relative path",
      );
    }
  });
});
