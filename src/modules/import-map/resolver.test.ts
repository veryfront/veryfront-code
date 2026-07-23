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

    it("does not resolve inherited object properties as import-map entries", () => {
      const map = { imports: {} };
      assertEquals(resolveImport("toString", map), "toString");
      assertEquals(resolveImport("constructor", map), "constructor");
    });

    it("ignores malformed runtime mapping values", () => {
      assertEquals(
        resolveImport("broken", { imports: { broken: 42 } } as never),
        "broken",
      );
      assertEquals(
        resolveImport("@lib/file.ts", { imports: { "@lib/": 42 } } as never),
        "@lib/file.ts",
      );
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

    it("should resolve prefix mappings with trailing slash", () => {
      const map = { imports: { "@lib/": "/src/lib/" } };
      assertEquals(resolveImport("@lib/utils.ts", map), "/src/lib/utils.ts");
    });

    it("ignores prefix mappings whose target is not a directory target", () => {
      const map = { imports: { "@lib/": "/src/lib" } };
      assertEquals(resolveImport("@lib/utils.ts", map), "@lib/utils.ts");
    });

    it("should try stripping .js extension for fallback", () => {
      const map = { imports: { lodash: "https://esm.sh/lodash@4" } };
      assertEquals(resolveImport("lodash.js", map), "https://esm.sh/lodash@4");
    });

    it("should handle .mjs extension stripping", () => {
      const map = { imports: { mylib: "/local/mylib.ts" } };
      assertEquals(resolveImport("mylib.mjs", map), "/local/mylib.ts");
    });

    it("uses the longest matching scope and prefix mapping", () => {
      const map = {
        imports: { "@lib/": "/global/" },
        scopes: {
          "/app/": { "@lib/": "/app-lib/" },
          "/app/admin/": { "@lib/": "/admin-lib/" },
        },
      };

      assertEquals(
        resolveImport("@lib/format.ts", map, "/app/admin/page.ts"),
        "/admin-lib/format.ts",
      );
    });

    it("uses the longest matching import-map prefix", () => {
      const map = {
        imports: {
          "@lib/": "/lib/",
          "@lib/internal/": "/private/",
        },
      };

      assertEquals(resolveImport("@lib/internal/token.ts", map), "/private/token.ts");
    });

    it("resolves versioned scoped esm.sh package subpaths", () => {
      const map = {
        imports: {
          "@scope/pkg/subpath": "/vendor/scoped-subpath.js",
        },
      };

      assertEquals(
        resolveImport("https://esm.sh/@scope/pkg@2.3.4/subpath", map),
        "/vendor/scoped-subpath.js",
      );
    });
  });
});
