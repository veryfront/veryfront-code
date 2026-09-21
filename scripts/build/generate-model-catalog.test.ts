import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildCatalogUrl,
  formatFailure,
  readCatalogJson,
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
      "replaces a URL whole, host, credentials and query included",
      new Error(
        "request to https://user:secret@internal.example.invalid/ai/models?sig=abc failed with 500",
      ),
      "request to a URL failed with 500",
    ],
    [
      "cuts an unquoted path with parentheses back to its last segment",
      new Error("failed /home/(alice-private)/build.ts"),
      "failed build.ts",
    ],
    [
      "consumes a quoted path whole, spaces and parentheses included",
      new Error(
        "cannot read '/Users/alice private/(work)/catalog.ts' for reading",
      ),
      "cannot read 'catalog.ts' for reading",
    ],
    [
      "consumes a quoted Windows path whole, spaces included",
      new Error('cannot read "C:\\Users\\alice private\\catalog.ts"'),
      'cannot read "catalog.ts"',
    ],
    [
      "replaces a URL whole even when it carries parentheses",
      new Error(
        "fetch failed: https://internal.example.invalid/path(foo)/ai/models?sig=abc (network)",
      ),
      "fetch failed: a URL (network)",
    ],
    [
      "replaces a URL of any scheme",
      new Error("wss://internal.example.invalid/socket closed"),
      "a URL closed",
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
      "cuts a Windows drive-letter path back to its last segment",
      new Error("failed to open C:\\Users\\someone\\secret\\catalog.data.ts"),
      "failed to open catalog.data.ts",
    ],
    [
      "cuts a UNC path back to its last segment",
      new Error("failed to open \\\\build-host\\share\\place\\generate.ts"),
      "failed to open generate.ts",
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

  it("keeps the base's path and query, so a signed query travels untouched", () => {
    assertEquals(
      buildCatalogUrl("https://example.invalid/base?sig=abc&v=1"),
      "https://example.invalid/base/ai/models?sig=abc&v=1",
    );
    assertEquals(
      buildCatalogUrl("https://example.invalid/base/?sig=abc"),
      "https://example.invalid/base/ai/models?sig=abc",
    );
    assertEquals(
      buildCatalogUrl("https://example.invalid?sig=abc"),
      "https://example.invalid/ai/models?sig=abc",
    );
  });

  it("accepts plain http towards loopback addresses only, since the token rides along", () => {
    for (
      const base of [
        "http://localhost:20000",
        "http://127.0.0.1:20000/",
        "http://[::1]:20000",
      ]
    ) {
      assertEquals(buildCatalogUrl(base).endsWith("/ai/models"), true);
    }
    const error = assertThrows(
      () => buildCatalogUrl("http://api.example.invalid"),
      Error,
    ) as Error;
    assertEquals(error.message.includes("must use https"), true);
    assertEquals(error.message.includes("api.example.invalid"), false);
  });

  it("refuses a base that is not an absolute http(s) URL, without echoing it", () => {
    for (
      const base of [
        "",
        "api.example.invalid",
        "ftp://example.invalid",
        "not a url",
      ]
    ) {
      const error = assertThrows(() => buildCatalogUrl(base), Error) as Error;
      assertEquals(
        error.message.includes("VERYFRONT_CATALOG_API_BASE_URL"),
        true,
      );
      assertEquals(base !== "" && error.message.includes(base), false);
    }
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

describe("a catalog response that is not JSON", () => {
  it("fails with one fixed sentence and echoes none of the body", async () => {
    const body = '{"models": [ <html>secret-looking service output</html>';
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    let message = "";
    try {
      await readCatalogJson(response);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(message.includes("was not valid JSON"), true, message);
    assertEquals(
      message.includes("secret-looking"),
      false,
      "the failure echoed the body",
    );
    assertEquals(
      message.includes("<html>"),
      false,
      "the failure echoed the body",
    );
  });

  it("returns the parsed body when it is JSON", async () => {
    const response = new Response('{"models": []}', { status: 200 });
    assertEquals(await readCatalogJson(response), { models: [] });
  });
});
