import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { importMapStrategy, resolveImportWithMap } from "./import-map-strategy.ts";
import type {
  ImportMapConfig,
  ImportSpecifier,
  ImportSpecifierInfo,
  RewriteContext,
} from "../types.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "app/page.tsx",
    projectDir: "/project",
    projectId: "proj-1",
    target: "ssr",
    dev: false,
    reactVersion: "19.1.1",
    importMap: { imports: {} },
    ...overrides,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: specifier.length,
    statementStart: 0,
    statementEnd: specifier.length,
    raw: {
      n: specifier,
      s: 0,
      e: specifier.length,
      ss: 0,
      se: specifier.length,
      d: -1,
      a: -1,
    } as ImportSpecifier,
  };
}

describe("transforms/import-rewriter/strategies/import-map-strategy", () => {
  describe("ImportMapStrategy", () => {
    it("has name 'import-map'", () => {
      assertEquals(importMapStrategy.name, "import-map");
    });

    it("has priority 5", () => {
      assertEquals(importMapStrategy.priority, 5);
    });
  });

  describe("matches", () => {
    it("matches bare specifier in SSR mode with import map", () => {
      assertEquals(importMapStrategy.matches("lodash", makeCtx()), true);
    });

    it("does not match in browser mode", () => {
      assertEquals(importMapStrategy.matches("lodash", makeCtx({ target: "browser" })), false);
    });

    it("does not match without import map", () => {
      assertEquals(importMapStrategy.matches("lodash", makeCtx({ importMap: undefined })), false);
    });

    it("does not match relative specifier", () => {
      assertEquals(importMapStrategy.matches("./foo", makeCtx()), false);
    });

    it("does not match absolute path specifier", () => {
      assertEquals(importMapStrategy.matches("/foo", makeCtx()), false);
    });

    it("matches esm.sh URLs", () => {
      assertEquals(importMapStrategy.matches("https://esm.sh/react@18", makeCtx()), true);
    });
  });

  describe("resolveImportWithMap", () => {
    it("resolves exact match from imports", () => {
      const map: ImportMapConfig = { imports: { lodash: "/_vf_modules/lodash.js" } };
      assertEquals(resolveImportWithMap("lodash", map), "/_vf_modules/lodash.js");
    });

    it("returns null when no match", () => {
      const map: ImportMapConfig = { imports: {} };
      assertEquals(resolveImportWithMap("unknown-pkg", map), null);
    });

    it("resolves prefix match", () => {
      const map: ImportMapConfig = { imports: { "lodash/": "/_vf_modules/lodash/" } };
      assertEquals(resolveImportWithMap("lodash/fp", map), "/_vf_modules/lodash/fp");
    });

    it("resolves scoped exact match", () => {
      const map: ImportMapConfig = {
        imports: {},
        scopes: { "/app/": { lodash: "/scoped/lodash.js" } },
      };
      assertEquals(resolveImportWithMap("lodash", map, "/app/"), "/scoped/lodash.js");
    });

    it("falls back to global when no scoped match", () => {
      const map: ImportMapConfig = {
        imports: { lodash: "/global/lodash.js" },
        scopes: { "/other/": { lodash: "/scoped/lodash.js" } },
      };
      assertEquals(resolveImportWithMap("lodash", map, "/app/"), "/global/lodash.js");
    });

    it("resolves .js extension fallback", () => {
      const map: ImportMapConfig = { imports: { "my-lib": "/lib/my-lib.js" } };
      assertEquals(resolveImportWithMap("my-lib.js", map), "/lib/my-lib.js");
    });

    it("resolves esm.sh URL to local mapping", () => {
      const map: ImportMapConfig = { imports: { lodash: "/local/lodash.js" } };
      assertEquals(resolveImportWithMap("https://esm.sh/lodash@4", map), "/local/lodash.js");
    });

    it("returns null for empty imports", () => {
      assertEquals(resolveImportWithMap("foo", {}), null);
    });

    it("resolves esm.sh scoped package", () => {
      const map: ImportMapConfig = { imports: { "@tanstack/react-query": "/local/rq.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@tanstack/react-query@5", map),
        "/local/rq.js",
      );
    });
  });

  describe("rewrite", () => {
    it("rewrites when import map has a mapping", () => {
      const ctx = makeCtx({
        importMap: { imports: { lodash: "/_vf_modules/lodash.js" } },
      });
      const result = importMapStrategy.rewrite(makeInfo("lodash"), ctx);
      assertEquals(result.specifier, "/_vf_modules/lodash.js");
    });

    it("returns null specifier when no mapping", () => {
      const ctx = makeCtx({ importMap: { imports: {} } });
      const result = importMapStrategy.rewrite(makeInfo("unknown"), ctx);
      assertEquals(result.specifier, null);
    });

    it("returns null when no import map", () => {
      const ctx = makeCtx({ importMap: undefined });
      const result = importMapStrategy.rewrite(makeInfo("lodash"), ctx);
      assertEquals(result.specifier, null);
    });
  });
});
