import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseEsmShSpecifier, resolveEsmShThroughImportMap } from "./esm-sh-import-map.ts";

function resolve(
  specifier: string,
  imports: Record<string, string> = {},
  scopedImports?: Record<string, string>,
): string | null {
  return resolveEsmShThroughImportMap(specifier, scopedImports, imports);
}

describe("transforms/shared/esm-sh-import-map", () => {
  it("extracts package coordinates from esm.sh specifiers", () => {
    assertEquals(parseEsmShSpecifier("https://esm.sh/@scope/pkg@1/sub"), {
      packageName: "@scope/pkg",
      subpath: "/sub",
      version: "1",
    });
    assertEquals(parseEsmShSpecifier("https://esm.sh/v135/v8/sub/"), {
      packageName: "v8",
      subpath: "/sub/",
      version: null,
    });
    assertEquals(parseEsmShSpecifier("https://esm.sh/gh/owner/repo"), null);
  });

  it("resolves scoped subpaths through package mappings", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/sub",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg/sub", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/sub",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/es2022/pkg.mjs", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/es2022/pkg.mjs",
    );
  });

  it("prefers scoped import-map entries before global entries", () => {
    assertEquals(
      resolve(
        "https://esm.sh/@scope/pkg@1/sub",
        { "@scope/pkg/sub": "/global/sub.js" },
        { "@scope/pkg": "https://cdn.example/scoped" },
      ),
      "https://cdn.example/scoped/sub",
    );
    assertEquals(
      resolve(
        "https://esm.sh/@scope/pkg@1/sub",
        { "https://esm.sh/@scope/pkg@1/sub": "/global/exact-url.js" },
        { "@scope/pkg": "https://cdn.example/scoped" },
      ),
      "https://cdn.example/scoped/sub",
    );
  });

  it("prefers exact package subpath entries over package root entries", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://cdn.example/pkg",
        "@scope/pkg/sub": "/local/sub.js",
      }),
      "/local/sub.js",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/other", {
        "@scope/pkg/sub": "/local/sub.js",
      }),
      null,
    );
  });

  it("keeps URL query, fragment, and trailing separator boundaries", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://esm.sh/@scope/pkg@2?target=es2022",
      }),
      "https://esm.sh/@scope/pkg@2/sub?target=es2022",
    );
    assertEquals(
      resolve("https://esm.sh/lodash@4/fp", {
        lodash: "https://cdn.example/lodash#frag",
      }),
      "https://cdn.example/lodash/fp#frag",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub/", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/sub/",
    );
  });

  it("distinguishes package roots from single-module mappings", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/auto", {
        pkg: "https://cdn.jsdelivr.net/npm/chart.js",
      }),
      "https://cdn.jsdelivr.net/npm/chart.js/auto",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", {
        pkg: "https://cdn.example/pkg.js",
      }),
      "https://cdn.example/pkg.js",
    );
    assertEquals(
      resolve("https://esm.sh/foo@1/other", { foo: "npm:foo@1/sub" }),
      "npm:foo@1/sub",
    );
  });

  it("handles reserved esm.sh segment names without changing package identity", () => {
    assertEquals(resolve("https://esm.sh/stable", { stable: "/local/s.js" }), "/local/s.js");
    assertEquals(resolve("https://esm.sh/stable/", { stable: "/local/s.js" }), "/local/s.js");
    assertEquals(
      resolve("https://esm.sh/stable/react@18", { react: "/local/react.js" }),
      "/local/react.js",
    );
    assertEquals(resolve("https://esm.sh/gh/owner/repo", { gh: "/local/gh.js" }), null);
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://esm.sh/stable",
      }),
      "https://esm.sh/stable",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://esm.sh/stable@1" }),
      "https://esm.sh/stable@1/sub",
    );
  });
});
