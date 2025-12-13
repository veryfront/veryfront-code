import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { resolveImport } from "./resolver.ts";
import type { ImportMapConfig } from "./types.ts";

describe("resolveImport", () => {
  it("should resolve exact import match", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const resolved = resolveImport("react", importMap);
    assertEquals(resolved, "https://esm.sh/react@18");
  });

  it("should resolve path prefix imports", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib/": "https://example.com/lib/",
      },
    };

    const resolved = resolveImport("lib/utils.js", importMap);
    assertEquals(resolved, "https://example.com/lib/utils.js");
  });

  it("should return original specifier when no match", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "react": "https://esm.sh/react@18",
      },
    };

    const resolved = resolveImport("vue", importMap);
    assertEquals(resolved, "vue");
  });

  it("should resolve scoped imports", () => {
    const importMap: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/vendor-lib.js",
        },
      },
    };

    const resolved = resolveImport("lib", importMap, "/vendor/");
    assertEquals(resolved, "https://example.com/vendor-lib.js");
  });

  it("should prioritize scoped imports over global", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/global-lib.js",
      },
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/vendor-lib.js",
        },
      },
    };

    const resolved = resolveImport("lib", importMap, "/vendor/");
    assertEquals(resolved, "https://example.com/vendor-lib.js");
  });

  it("should fallback to global imports when scope not matched", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/global-lib.js",
      },
      scopes: {
        "/vendor/": {
          "other": "https://example.com/other.js",
        },
      },
    };

    const resolved = resolveImport("lib", importMap, "/vendor/");
    assertEquals(resolved, "https://example.com/global-lib.js");
  });

  it("should handle .js extension resolution", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib.js",
      },
    };

    const resolved = resolveImport("lib.js", importMap);
    assertEquals(resolved, "https://example.com/lib.js");
  });

  it("should handle .mjs extension resolution", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib.mjs",
      },
    };

    const resolved = resolveImport("lib.mjs", importMap);
    assertEquals(resolved, "https://example.com/lib.mjs");
  });

  it("should handle .cjs extension resolution", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib.cjs",
      },
    };

    const resolved = resolveImport("lib.cjs", importMap);
    assertEquals(resolved, "https://example.com/lib.cjs");
  });

  it("should handle empty import map", () => {
    const importMap: ImportMapConfig = {};

    const resolved = resolveImport("react", importMap);
    assertEquals(resolved, "react");
  });

  it("should handle undefined imports", () => {
    const importMap: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/lib.js",
        },
      },
    };

    const resolved = resolveImport("react", importMap);
    assertEquals(resolved, "react");
  });

  it("should resolve nested path imports", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "lib/": "https://example.com/lib/v2/",
      },
    };

    const resolved = resolveImport("lib/utils/helper.js", importMap);
    assertEquals(resolved, "https://example.com/lib/v2/utils/helper.js");
  });

  it("should handle @ scoped packages", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "@org/lib": "https://example.com/org-lib.js",
      },
    };

    const resolved = resolveImport("@org/lib", importMap);
    assertEquals(resolved, "https://example.com/org-lib.js");
  });

  it("should handle path imports with @ scoped packages", () => {
    const importMap: ImportMapConfig = {
      imports: {
        "@org/lib/": "https://example.com/org-lib/",
      },
    };

    const resolved = resolveImport("@org/lib/utils.js", importMap);
    assertEquals(resolved, "https://example.com/org-lib/utils.js");
  });
});
