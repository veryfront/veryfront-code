import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildCatalogUrl,
  stripTrailingSlashes,
} from "./generate-model-catalog.ts";

describe("scripts/build/generate-model-catalog", () => {
  it("drops every trailing slash and leaves the rest alone", () => {
    assertEquals(
      stripTrailingSlashes("https://example.invalid/api"),
      "https://example.invalid/api",
    );
    assertEquals(
      stripTrailingSlashes("https://example.invalid/api/"),
      "https://example.invalid/api",
    );
    assertEquals(
      stripTrailingSlashes("https://example.invalid/api///"),
      "https://example.invalid/api",
    );
    assertEquals(stripTrailingSlashes("///"), "");
    assertEquals(stripTrailingSlashes(""), "");
  });

  it("stays linear on an input built to make a backtracking matcher crawl", () => {
    // The base URL comes from an environment variable, so its shape is not
    // this generator's to assume. A long run of slashes followed by a
    // non-slash is the shape that makes an anchored `/+$` retry from every
    // position; a scan does not care.
    const pathological = `https://example.invalid/${"/".repeat(200_000)}x`;
    const started = performance.now();

    assertEquals(stripTrailingSlashes(pathological), pathological);
    assertEquals(
      performance.now() - started < 1_000,
      true,
      "stripping took too long",
    );
  });
});

describe("the catalog URL", () => {
  it("is the API origin plus the catalog path, with no REST prefix", () => {
    // The catalog sits beside the gateway paths the package itself builds:
    // see the URLs pinned in
    // `src/provider/veryfront-cloud/gateway-routing.test.ts`. An `/api`
    // segment here gets a 404.
    assertEquals(
      buildCatalogUrl("https://api.veryfront.com"),
      "https://api.veryfront.com/ai/models",
    );
  });

  it("joins a base with or without a trailing slash with exactly one slash", () => {
    for (
      const base of [
        "https://example.invalid",
        "https://example.invalid/",
        "https://example.invalid///",
      ]
    ) {
      assertEquals(buildCatalogUrl(base), "https://example.invalid/ai/models");
    }
  });
});
