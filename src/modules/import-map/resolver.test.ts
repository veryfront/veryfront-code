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

    it("uses the longest matching scope prefix", () => {
      const map = {
        imports: { lib: "/global/lib.js" },
        scopes: {
          "/app/": { lib: "/app/lib.js" },
          "/app/admin/": { lib: "/admin/lib.js" },
        },
      };

      assertEquals(
        resolveImport("lib", map, "/app/admin/page.js"),
        "/admin/lib.js",
      );
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

    it("resolves versioned scoped-package subpaths before URL queries", () => {
      const map = {
        imports: {
          "@scope/package": "https://cdn.example.test/package?target=es2022",
        },
      };

      assertEquals(
        resolveImport(
          "https://esm.sh/v135/@scope/package@1.2.3/subpath",
          map,
        ),
        "https://cdn.example.test/package/subpath?target=es2022",
      );
    });

    it("should resolve prefix mappings with trailing slash", () => {
      const map = { imports: { "@lib/": "/src/lib/" } };
      assertEquals(resolveImport("@lib/utils.ts", map), "/src/lib/utils.ts");
    });

    it("prefers the longest prefix and applies scoped prefixes first", () => {
      const map = {
        imports: {
          "pkg/": "/global/",
          "pkg/deep/": "/global-deep/",
        },
        scopes: {
          "/app/": {
            "pkg/": "/scoped/",
          },
        },
      };

      assertEquals(
        resolveImport("pkg/deep/value", map),
        "/global-deep/value",
      );
      assertEquals(
        resolveImport("pkg/deep/value", map, "/app/page.js"),
        "/scoped/deep/value",
      );
    });

    it("should try stripping .js extension for fallback", () => {
      const map = { imports: { lodash: "https://esm.sh/lodash@4" } };
      assertEquals(resolveImport("lodash.js", map), "https://esm.sh/lodash@4");
    });

    it("should handle .mjs extension stripping", () => {
      const map = { imports: { mylib: "/local/mylib.ts" } };
      assertEquals(resolveImport("mylib.mjs", map), "/local/mylib.ts");
    });

    it("treats prototype-shaped specifiers as own data only", () => {
      const imports = JSON.parse(
        '{"__proto__":"/safe/proto.js","constructor":"/safe/constructor.js"}',
      );

      assertEquals(resolveImport("__proto__", { imports }), "/safe/proto.js");
      assertEquals(resolveImport("toString", { imports }), "toString");
    });
  });
});
