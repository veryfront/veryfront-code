import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { importMapStrategy, resolveImportWithMap } from "./import-map-strategy.ts";
import type { ImportMapConfig, ImportSpecifierInfo, RewriteContext } from "../types.ts";

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
    } as ImportSpecifierInfo["raw"],
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

    it("appends the esm.sh subpath to a URL mapping", () => {
      const map: ImportMapConfig = { imports: { lodash: "https://cdn.example/lodash" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/lodash@4/fp", map),
        "https://cdn.example/lodash/fp",
        "a URL mapping keeps the subpath so the /fp entry point is resolved, not the package root",
      );
    });

    it("prefers an exact package+subpath mapping over the package mapping", () => {
      const map: ImportMapConfig = {
        imports: { lodash: "https://cdn.example/lodash", "lodash/fp": "/local/fp.js" },
      };
      assertEquals(
        resolveImportWithMap("https://esm.sh/lodash@4/fp", map),
        "/local/fp.js",
        "the package+subpath key wins over the bare package key",
      );
    });

    it("drops the esm.sh subpath for a file-path mapping", () => {
      const map: ImportMapConfig = { imports: { lodash: "/local/lodash.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/lodash@4/fp", map),
        "/local/lodash.js",
        "a file-path mapping already points at a single module, so the subpath is not appended",
      );
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

    it("prefers an exact package+subpath mapping for a scoped package", () => {
      const map: ImportMapConfig = {
        imports: {
          "@scope/pkg": "https://cdn.example/pkg",
          "@scope/pkg/sub": "/local/sub.js",
        },
      };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1.0/sub", map),
        "/local/sub.js",
        "the package+subpath key must win for scoped packages just as it does for unscoped ones",
      );
    });

    it("appends the subpath of a scoped package to a URL mapping", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1.0/sub", map),
        "https://cdn.example/pkg/sub",
        "a scoped subpath must reach its own entry point rather than resolving to the package root",
      );
    });

    it("appends the subpath of an unversioned scoped package", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg/sub", map),
        "https://cdn.example/pkg/sub",
        "the version is optional, so an unversioned scoped specifier keeps its subpath",
      );
    });

    it("keeps a deep build-target subpath for a scoped package", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1.0/es2022/pkg.mjs", map),
        "https://cdn.example/pkg/es2022/pkg.mjs",
        "esm.sh build-target paths are multi-segment subpaths and must survive intact",
      );
    });

    it("returns null when only a scoped package+subpath key is mapped", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg/sub": "/local/sub.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1.0/other", map),
        null,
        "an unmapped scoped subpath must not silently fall back to the package root mapping",
      );
    });

    it("inserts a scoped subpath before a mapping's query string", () => {
      const map: ImportMapConfig = {
        imports: { "@scope/pkg": "https://esm.sh/@scope/pkg@2?target=es2022" },
      };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/sub", map),
        "https://esm.sh/@scope/pkg@2/sub?target=es2022",
        "appending after the query would fold the subpath into the target parameter",
      );
    });

    it("inserts an unscoped subpath before a mapping's query string", () => {
      const map: ImportMapConfig = {
        imports: { lodash: "https://cdn.example/lodash?target=es2022" },
      };
      assertEquals(
        resolveImportWithMap("https://esm.sh/lodash@4/fp", map),
        "https://cdn.example/lodash/fp?target=es2022",
        "the query boundary applies to unscoped packages too",
      );
    });

    it("inserts a subpath before a mapping's fragment", () => {
      const map: ImportMapConfig = { imports: { lodash: "https://cdn.example/lodash#frag" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/lodash@4/fp", map),
        "https://cdn.example/lodash/fp#frag",
        "a fragment ends the path just as a query does",
      );
    });

    it("does not duplicate the separator when a mapping ends in a slash", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg/" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/sub", map),
        "https://cdn.example/pkg/sub",
        "not every CDN collapses a doubled separator back to one",
      );
    });

    it("keeps a remote single-module mapping instead of appending a subpath", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/sub", map),
        "https://cdn.example/pkg.js",
        "a mapping that already addresses one module cannot take a path below it",
      );
    });

    it("keeps a remote TypeScript mapping as a single module", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://example.com/package.ts" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/sub", map),
        "https://example.com/package.ts",
        "remote TypeScript import-map values are ordinary in a Deno-first project",
      );
    });

    it("still appends a subpath to a remote package-root mapping", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/sub", map),
        "https://cdn.example/pkg/sub",
        "an extensionless remote mapping is a package root, so the subpath still applies",
      );
    });

    it("resolves an esm.sh URL that carries a trailing slash", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "/local/pkg.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/", map),
        "/local/pkg.js",
        "a trailing separator must not make an otherwise resolvable specifier unresolvable",
      );
    });

    it("preserves a trailing separator that belongs to the subpath", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/sub/", map),
        "https://cdn.example/pkg/sub/",
        "a directory-style subpath addresses something different from the same path without the separator",
      );
    });

    it("preserves a trailing separator on an unscoped subpath", () => {
      const map: ImportMapConfig = { imports: { lodash: "https://cdn.example/lodash" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/lodash@4/fp/", map),
        "https://cdn.example/lodash/fp/",
        "the separator was preserved before this change and must stay preserved",
      );
    });

    it("appends a subpath to a jsr package mapping", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "jsr:@std/path@1.1.4" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@1/posix", map),
        "jsr:@std/path@1.1.4/posix",
        "jsr: names a package just as npm: does, so it takes a subpath",
      );
    });

    it("resolves a package whose name looks like a build prefix", () => {
      const map: ImportMapConfig = { imports: { v8: "/local/v8.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/v8", map),
        "/local/v8.js",
        "a build prefix always precedes a package, so a lone v-number is a package name",
      );
    });

    it("resolves a legacy build-prefixed esm.sh URL", () => {
      const map: ImportMapConfig = { imports: { react: "/local/react.js" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/v135/react@18.3.1", map),
        "/local/react.js",
        "esm.sh still serves v-prefixed build URLs, which must keep resolving",
      );
    });

    it("resolves a scoped package carrying a non-numeric version tag", () => {
      const map: ImportMapConfig = { imports: { "@scope/pkg": "https://cdn.example/pkg" } };
      assertEquals(
        resolveImportWithMap("https://esm.sh/@scope/pkg@beta/sub", map),
        "https://cdn.example/pkg/sub",
        "version tags are not always numeric, so the package name must be split on the version separator",
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
