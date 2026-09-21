import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildCatalogUrl,
  formatFailure,
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

describe("an unplanned failure", () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    [
      "keeps a message that is already one actionable line",
      new Error("Catalog endpoint not found - check the API base"),
      "Catalog endpoint not found - check the API base",
    ],
    [
      "keeps the endpoint a request failed against",
      new Error("request to https://example.invalid/ai/models failed with 500"),
      "request to https://example.invalid/ai/models failed with 500",
    ],
    [
      "flattens a multi-line message so nothing can pose as its own line",
      new Error("first line\n  at somewhere\n  at somewhere else"),
      "first line at somewhere at somewhere else",
    ],
    [
      "cuts an absolute path back to its last segment",
      new Error("failed to open /home/someone/secret/place/catalog.data.ts"),
      "failed to open catalog.data.ts",
    ],
    [
      "cuts an absolute path a file URL carries",
      new Error("failed at file:///home/someone/build/generate.ts"),
      "failed at generate.ts",
    ],
    [
      "describes a thrown value that is not an error",
      "plain thrown string",
      "plain thrown string",
    ],
    [
      "says so when there is no message at all",
      new Error(""),
      "no reason was given",
    ],
  ];

  for (const [name, thrown, expected] of cases) {
    it(name, () => {
      assertEquals(formatFailure(thrown), expected);
    });
  }

  it("bounds a message big enough to be a response body", () => {
    // A failure can carry whatever the service sent back. The reader gets a
    // line, not a transcript.
    const formatted = formatFailure(new Error("x".repeat(10_000)));

    assertEquals(formatted.length <= 403, true, "failure line was not bounded");
    assertEquals(formatted.endsWith("..."), true);
  });

  it("never prints a stack", () => {
    const error = new Error("something broke");

    assertEquals(formatFailure(error).includes("at "), false);
    assertEquals(
      formatFailure(error).includes(import.meta.url),
      false,
      "the failure line named a source file",
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
