import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { mergeImportMaps } from "./merger.ts";
import type { ImportMapConfig } from "./types.ts";

describe("mergeImportMaps", () => {
  it("should merge empty import maps", () => {
    const result = mergeImportMaps({}, {});

    assertExists(result);
    assertExists(result.imports);
    assertExists(result.scopes);
    assertEquals(Object.keys(result.imports).length, 0);
    assertEquals(Object.keys(result.scopes).length, 0);
  });

  it("should merge single import map", () => {
    const map: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib.js",
      },
    };

    const result = mergeImportMaps(map);

    assertExists(result);
    assertExists(result.imports);
    assertEquals(result.imports["lib"], "https://example.com/lib.js");
  });

  it("should merge multiple import maps with different keys", () => {
    const map1: ImportMapConfig = {
      imports: {
        "lib1": "https://example.com/lib1.js",
      },
    };

    const map2: ImportMapConfig = {
      imports: {
        "lib2": "https://example.com/lib2.js",
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.imports);
    assertEquals(result.imports["lib1"], "https://example.com/lib1.js");
    assertEquals(result.imports["lib2"], "https://example.com/lib2.js");
    assertEquals(Object.keys(result.imports).length, 2);
  });

  it("should override earlier imports with later ones", () => {
    const map1: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib-v1.js",
      },
    };

    const map2: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib-v2.js",
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.imports);
    assertEquals(result.imports["lib"], "https://example.com/lib-v2.js");
  });

  it("should merge scopes from multiple import maps", () => {
    const map1: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/vendor-lib.js",
        },
      },
    };

    const map2: ImportMapConfig = {
      scopes: {
        "/app/": {
          "lib": "https://example.com/app-lib.js",
        },
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.scopes);
    assertExists(result.scopes["/vendor/"]);
    assertExists(result.scopes["/app/"]);
    assertEquals(result.scopes["/vendor/"]["lib"], "https://example.com/vendor-lib.js");
    assertEquals(result.scopes["/app/"]["lib"], "https://example.com/app-lib.js");
  });

  it("should merge imports within the same scope", () => {
    const map1: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib1": "https://example.com/lib1.js",
        },
      },
    };

    const map2: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib2": "https://example.com/lib2.js",
        },
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.scopes);
    assertExists(result.scopes["/vendor/"]);
    assertEquals(result.scopes["/vendor/"]["lib1"], "https://example.com/lib1.js");
    assertEquals(result.scopes["/vendor/"]["lib2"], "https://example.com/lib2.js");
    assertEquals(Object.keys(result.scopes["/vendor/"]).length, 2);
  });

  it("should override scoped imports with later ones", () => {
    const map1: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/lib-v1.js",
        },
      },
    };

    const map2: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/lib-v2.js",
        },
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.scopes);
    assertExists(result.scopes["/vendor/"]);
    assertEquals(result.scopes["/vendor/"]["lib"], "https://example.com/lib-v2.js");
  });

  it("should merge both imports and scopes", () => {
    const map1: ImportMapConfig = {
      imports: {
        "global-lib": "https://example.com/global.js",
      },
      scopes: {
        "/vendor/": {
          "scoped-lib": "https://example.com/scoped.js",
        },
      },
    };

    const map2: ImportMapConfig = {
      imports: {
        "another-lib": "https://example.com/another.js",
      },
      scopes: {
        "/app/": {
          "app-lib": "https://example.com/app.js",
        },
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.imports);
    assertExists(result.scopes);
    assertEquals(result.imports["global-lib"], "https://example.com/global.js");
    assertEquals(result.imports["another-lib"], "https://example.com/another.js");
    assertExists(result.scopes["/vendor/"]);
    assertEquals(result.scopes["/vendor/"]["scoped-lib"], "https://example.com/scoped.js");
    assertExists(result.scopes["/app/"]);
    assertEquals(result.scopes["/app/"]["app-lib"], "https://example.com/app.js");
  });

  it("should handle import map without imports field", () => {
    const map1: ImportMapConfig = {
      imports: {
        "lib": "https://example.com/lib.js",
      },
    };

    const map2: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "scoped": "https://example.com/scoped.js",
        },
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.imports);
    assertExists(result.scopes);
    assertEquals(result.imports["lib"], "https://example.com/lib.js");
    assertExists(result.scopes["/vendor/"]);
    assertEquals(result.scopes["/vendor/"]["scoped"], "https://example.com/scoped.js");
  });

  it("should handle import map without scopes field", () => {
    const map1: ImportMapConfig = {
      scopes: {
        "/vendor/": {
          "lib": "https://example.com/lib.js",
        },
      },
    };

    const map2: ImportMapConfig = {
      imports: {
        "global": "https://example.com/global.js",
      },
    };

    const result = mergeImportMaps(map1, map2);

    assertExists(result);
    assertExists(result.imports);
    assertExists(result.scopes);
    assertEquals(result.imports["global"], "https://example.com/global.js");
    assertExists(result.scopes["/vendor/"]);
    assertEquals(result.scopes["/vendor/"]["lib"], "https://example.com/lib.js");
  });

  it("should merge three or more import maps", () => {
    const map1: ImportMapConfig = {
      imports: { "lib1": "https://example.com/lib1.js" },
    };

    const map2: ImportMapConfig = {
      imports: { "lib2": "https://example.com/lib2.js" },
    };

    const map3: ImportMapConfig = {
      imports: { "lib3": "https://example.com/lib3.js" },
    };

    const result = mergeImportMaps(map1, map2, map3);

    assertExists(result);
    assertExists(result.imports);
    assertEquals(Object.keys(result.imports).length, 3);
    assertEquals(result.imports["lib1"], "https://example.com/lib1.js");
    assertEquals(result.imports["lib2"], "https://example.com/lib2.js");
    assertEquals(result.imports["lib3"], "https://example.com/lib3.js");
  });

  it("should preserve order of precedence with multiple maps", () => {
    const map1: ImportMapConfig = {
      imports: { "lib": "https://example.com/lib-v1.js" },
    };

    const map2: ImportMapConfig = {
      imports: { "lib": "https://example.com/lib-v2.js" },
    };

    const map3: ImportMapConfig = {
      imports: { "lib": "https://example.com/lib-v3.js" },
    };

    const result = mergeImportMaps(map1, map2, map3);

    assertExists(result);
    assertExists(result.imports);
    // Last one wins
    assertEquals(result.imports["lib"], "https://example.com/lib-v3.js");
  });

  it("should handle completely empty import map", () => {
    const map: ImportMapConfig = {};

    const result = mergeImportMaps(map);

    assertExists(result);
    assertExists(result.imports);
    assertExists(result.scopes);
  });

  it("should handle no arguments", () => {
    const result = mergeImportMaps();

    assertExists(result);
    assertExists(result.imports);
    assertExists(result.scopes);
    assertEquals(Object.keys(result.imports).length, 0);
    assertEquals(Object.keys(result.scopes).length, 0);
  });

  it("should preserve special characters in keys", () => {
    const map1: ImportMapConfig = {
      imports: {
        "@org/lib": "https://example.com/org-lib.js",
        "lib/": "https://example.com/lib/",
      },
    };

    const result = mergeImportMaps(map1);

    assertExists(result);
    assertExists(result.imports);
    assertEquals(result.imports["@org/lib"], "https://example.com/org-lib.js");
    assertEquals(result.imports["lib/"], "https://example.com/lib/");
  });
});
