import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildTransformedModuleSpecifier } from "./component-loader.ts";

describe("modules/react-loader/component-loader specifier", () => {
  it("reuses one specifier for unchanged transform output", () => {
    const path = "/cache/proj-1a2b/components/Widget.js";
    assertEquals(
      buildTransformedModuleSpecifier(path, "hash-aaa"),
      buildTransformedModuleSpecifier(path, "hash-aaa"),
    );
  });

  it("varies the specifier when transform output changes so dev reloads pick it up", () => {
    const path = "/cache/proj-1a2b/components/Widget.js";
    assertEquals(
      buildTransformedModuleSpecifier(path, "hash-aaa") ===
        buildTransformedModuleSpecifier(path, "hash-bbb"),
      false,
    );
  });

  it("percent-encodes a path containing spaces", () => {
    const specifier = buildTransformedModuleSpecifier(
      "/cache/proj/my components/Wid get.js",
      "hash-aaa",
    );
    assertEquals(
      decodeURIComponent(new URL(specifier).pathname),
      "/cache/proj/my components/Wid get.js",
    );
  });

  it("keeps a '#' in the path out of the URL fragment", () => {
    const specifier = buildTransformedModuleSpecifier("/cache/proj/note#1/App.js", "hash-aaa");
    const url = new URL(specifier);

    assertEquals(decodeURIComponent(url.pathname), "/cache/proj/note#1/App.js");
    assertEquals(url.hash, "");
  });

  it("keeps a '?' in the path out of the query string", () => {
    const specifier = buildTransformedModuleSpecifier("/cache/proj/a?b/App.js", "hash-aaa");
    const url = new URL(specifier);

    assertEquals(decodeURIComponent(url.pathname), "/cache/proj/a?b/App.js");
    assertEquals(url.searchParams.get("v"), "hash-aaa");
  });
});
