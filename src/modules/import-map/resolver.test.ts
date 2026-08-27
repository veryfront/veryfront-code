import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveImport } from "./resolver.ts";

describe("modules/import-map/resolver", () => {
  describe("resolveImport", () => {
    it("should resolve exact global import", () => {
      const map = { imports: { react: "https://esm.sh/react@18" } };
      assertEquals(resolveImport("react", map), "https://esm.sh/react@18");
    });

    it("should return specifier unchanged when not in map", () => {
      const map = { imports: {} };
      assertEquals(resolveImport("lodash", map), "lodash");
    });

    it("should resolve scoped imports when scope matches", () => {
      const map = {
        imports: { react: "https://esm.sh/react@17" },
        scopes: { "/app/": { react: "https://esm.sh/react@18" } },
      };
      assertEquals(resolveImport("react", map, "/app/"), "https://esm.sh/react@18");
    });

    it("should fallback to global when scope does not match", () => {
      const map = {
        imports: { react: "https://esm.sh/react@17" },
        scopes: { "/other/": { react: "https://esm.sh/react@18" } },
      };
      assertEquals(resolveImport("react", map, "/app/"), "https://esm.sh/react@17");
    });

    it("should resolve esm.sh URLs by package name", () => {
      const map = { imports: { react: "https://esm.sh/react@19" } };
      assertEquals(resolveImport("https://esm.sh/react@18", map), "https://esm.sh/react@19");
    });

    it("should resolve esm.sh URLs with subpath", () => {
      const map = {
        imports: { "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime" },
      };
      assertEquals(
        resolveImport("https://esm.sh/react@18/jsx-runtime", map),
        "https://esm.sh/react@19/jsx-runtime",
      );
    });

    it("should preserve repeated separators when selecting an esm.sh subpath", () => {
      const map = { imports: { "pkg//sub": "/local.js" } };
      assertEquals(
        resolveImport("https://esm.sh/pkg@1//sub", map),
        "/local.js",
        "the dev-server resolver must select the exact empty-segment subpath entry",
      );
    });

    it("should not append the esm.sh subpath to a local file mapping", () => {
      const map = { imports: { react: "/local/react.ts" } };
      assertEquals(
        resolveImport("https://esm.sh/react@18/jsx-runtime", map),
        "/local/react.ts",
        "a local file mapping must not have the esm.sh subpath appended",
      );
    });

    it("should not append the esm.sh subpath to a numeric-leading remote file mapping", () => {
      const map = { imports: { "@scope/pkg": "https://cdn.example/archive.7z" } };
      assertEquals(
        resolveImport("https://esm.sh/@scope/pkg@1/sub", map),
        "https://cdn.example/archive.7z",
      );
    });

    it("should append the esm.sh subpath to an http mapping", () => {
      const map = { imports: { react: "https://esm.sh/react@19" } };
      assertEquals(
        resolveImport("https://esm.sh/react@18/jsx-runtime", map),
        "https://esm.sh/react@19/jsx-runtime",
        "an http mapping must carry the subpath through",
      );
    });

    it("should normalize a URL-equivalent backslash before appending a subpath", () => {
      const map = { imports: { pkg: "https://cdn.example/pkg\\" } };
      assertEquals(
        resolveImport("https://esm.sh/pkg@1/sub", map),
        "https://cdn.example/pkg/sub",
      );
    });

    it("should append through an encoded esm.sh GitHub source coordinate", () => {
      const map = { imports: { pkg: "https://esm.sh/%67h/owner/repo" } };
      assertEquals(
        resolveImport("https://esm.sh/pkg@1/sub", map),
        "https://esm.sh/%67h/owner/repo/sub",
      );
    });

    it("should append the esm.sh subpath to a wildcard-version mapping", () => {
      const map = { imports: { pkg: "https://cdn.example/pkg@1.x" } };
      assertEquals(
        resolveImport("https://esm.sh/pkg@1/sub", map),
        "https://cdn.example/pkg@1.x/sub",
      );
    });

    it("should append the esm.sh subpath to a compound-version mapping", () => {
      const mapping = "https://cdn.example/pkg@1.2.3%20-%202.0.0-alpha.beta";
      assertEquals(
        resolveImport("https://esm.sh/pkg@1/sub", { imports: { pkg: mapping } }),
        `${mapping}/sub`,
      );
    });

    it("should resolve prefix mappings with trailing slash", () => {
      const map = { imports: { "@lib/": "/src/lib/" } };
      assertEquals(resolveImport("@lib/utils.ts", map), "/src/lib/utils.ts");
    });

    it("uses the longest matching prefix regardless of insertion order", () => {
      const map = {
        imports: {
          "#/": "/short/",
          "#/nested/": "/long/",
        },
      };
      assertEquals(resolveImport("#/nested/client.ts", map), "/long/client.ts");
    });

    it("should try stripping .js extension for fallback", () => {
      const map = { imports: { lodash: "https://esm.sh/lodash@4" } };
      assertEquals(resolveImport("lodash.js", map), "https://esm.sh/lodash@4");
    });

    it("should handle .mjs extension stripping", () => {
      const map = { imports: { mylib: "/local/mylib.ts" } };
      assertEquals(resolveImport("mylib.mjs", map), "/local/mylib.ts");
    });

    // This resolver backs the dev server's esbuild plugin, so the scoped
    // subpath defect reported in #4098 reached production through here too,
    // not only through the unified rewriter.
    it("keeps the subpath of a scoped esm.sh specifier", () => {
      const map = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImport("https://esm.sh/@scope/pkg@1/sub", map),
        "https://cdn.example/pkg/sub",
        "a scoped subpath must reach its own entry point here as well",
      );
    });
  });
});
