import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { InvalidDataEndpointPathError, parseDataEndpointPath } from "./data-endpoint-path.ts";

describe("modules/server/data-endpoint-path", () => {
  it("distinguishes unrelated paths and parses nested data slugs", () => {
    assertEquals(parseDataEndpointPath("/about"), { matched: false });
    assertEquals(parseDataEndpointPath("/_veryfront/data/blog/my-post.json"), {
      matched: true,
      slug: "blog/my-post",
    });
    assertEquals(parseDataEndpointPath("/_veryfront/data/.json"), {
      matched: true,
      slug: "",
    });
  });

  it("decodes safe path segments exactly once", () => {
    assertEquals(parseDataEndpointPath("/_veryfront/data/hello%20world.json"), {
      matched: true,
      slug: "hello world",
    });
  });

  it("rejects malformed suffixes, traversal, separators, and empty segments", () => {
    for (
      const pathname of [
        "/_veryfront/data/page",
        "/_veryfront/data/page.json/extra",
        "/_veryfront/data/../secret.json",
        "/_veryfront/data/%2e%2e/secret.json",
        "/_veryfront/data/a%2Fb.json",
        "/_veryfront/data/a%5Cb.json",
        "/_veryfront/data/a//b.json",
        "/_veryfront/data/%ZZ.json",
      ]
    ) {
      assertThrows(
        () => parseDataEndpointPath(pathname),
        InvalidDataEndpointPathError,
      );
    }
  });
});
