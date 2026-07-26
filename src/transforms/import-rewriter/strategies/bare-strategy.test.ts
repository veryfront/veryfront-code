import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../../release-assets/constants.ts";
import {
  _primeDependenciesCache,
  clearReactVersionCache,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  scheduleNpmVersionResolution,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { bareStrategy } from "./bare-strategy.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test",
    target: "browser",
    dev: false,
    reactVersion: "19.1.1",
    ...overrides,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

describe("BareStrategy", () => {
  describe("matches", () => {
    it("should match bare npm packages", () => {
      assertEquals(bareStrategy.matches("lodash", makeCtx()), true);
    });

    it("should match scoped packages", () => {
      assertEquals(bareStrategy.matches("@tanstack/react-query", makeCtx()), true);
    });

    it("should not match http URLs", () => {
      assertEquals(bareStrategy.matches("https://esm.sh/react", makeCtx()), false);
    });

    it("should not match relative imports", () => {
      assertEquals(bareStrategy.matches("./utils", makeCtx()), false);
    });

    it("should not match ../ imports", () => {
      assertEquals(bareStrategy.matches("../lib", makeCtx()), false);
    });

    it("should not match @/ aliases", () => {
      assertEquals(bareStrategy.matches("@/components", makeCtx()), false);
    });

    it("should not match react", () => {
      assertEquals(bareStrategy.matches("react", makeCtx()), false);
    });

    it("should not match react-dom", () => {
      assertEquals(bareStrategy.matches("react-dom", makeCtx()), false);
    });

    it("should not match react/ subpaths", () => {
      assertEquals(bareStrategy.matches("react/jsx-runtime", makeCtx()), false);
    });

    it("should not match node: builtins", () => {
      assertEquals(bareStrategy.matches("node:fs", makeCtx()), false);
    });

    it("should not match # imports", () => {
      assertEquals(bareStrategy.matches("#veryfront/utils", makeCtx()), false);
    });

    it("should not match veryfront imports", () => {
      assertEquals(bareStrategy.matches("veryfront/client", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should return null for SSR target", () => {
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "ssr" }));
      assertEquals(result.specifier, null);
    });

    it("should rewrite to esm.sh URL for browser", () => {
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "browser" }));
      assertEquals(
        result.specifier,
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });

    it("should handle tailwindcss with pinned version", () => {
      const result = bareStrategy.rewrite(
        makeInfo("tailwindcss"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("tailwindcss@"), true);
    });

    it("should preserve versioned specifiers", () => {
      const result = bareStrategy.rewrite(
        makeInfo("lodash@4.17.21"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("esm.sh/lodash@4.17.21"), true);
    });

    // R1 regression: a known server-only driver (`redis`) and its explicit Deno
    // `npm:` form only run server-side. They must be left external (specifier:
    // null) for the runtime to resolve natively — never routed through esm.sh,
    // which 500s building `redis` under `external=react` and otherwise ships a
    // client that can never connect. This is the v0.1.1101 cold-cache regression.
    it("leaves a server-only package (redis) external for the browser", () => {
      const result = bareStrategy.rewrite(makeInfo("redis"), makeCtx({ target: "browser" }));
      assertEquals(result.specifier, null);
    });

    it("leaves an explicit npm: server-only specifier external for the browser", () => {
      const result = bareStrategy.rewrite(
        makeInfo("npm:redis@5.11.0"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier, null);
    });

    // The `npm:` scheme alone does not mean server-only. A browser-safe package
    // imported Deno-style (`npm:zod@4.0.0`) must still flow through esm.sh — the
    // `npm:` prefix is stripped and the package rewritten like a bare import, so
    // the browser can load it. Only server-only `npm:` packages stay external.
    it("rewrites a browser-safe npm: specifier through esm.sh", () => {
      const result = bareStrategy.rewrite(
        makeInfo("npm:zod@4.0.0"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(
        result.specifier,
        "https://esm.sh/zod@4.0.0?external=react,react-dom&target=es2022",
      );
    });

    it("rewrites a version-less npm: specifier through esm.sh", () => {
      const result = bareStrategy.rewrite(makeInfo("npm:zod"), makeCtx({ target: "browser" }));
      assertEquals(result.specifier, "https://esm.sh/zod?external=react,react-dom&target=es2022");
    });

    it("preserves a subpath on a browser-safe npm: specifier", () => {
      const result = bareStrategy.rewrite(
        makeInfo("npm:zod@4.0.0/mini"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(
        result.specifier,
        "https://esm.sh/zod@4.0.0/mini?external=react,react-dom&target=es2022",
      );
    });

    // `npm:` specifiers are left external on SSR — the Deno npm resolver
    // understands their version, so no rewrite is needed.
    it("leaves a browser-safe npm: specifier external on the SSR target", () => {
      const result = bareStrategy.rewrite(makeInfo("npm:zod@4.0.0"), makeCtx({ target: "ssr" }));
      assertEquals(result.specifier, null);
    });
  });

  describe("rewrite: flag-off regression — behavior byte-identical to original when VERYFRONT_DEPENDENCY_PINNING is unset", () => {
    let originalFlag: string | undefined;

    beforeEach(() => {
      originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      _clearNpmVersionCache();
      clearReactVersionCache();
    });

    afterEach(() => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      _clearNpmVersionCache();
      clearReactVersionCache();
    });

    it("produces the same unversioned esm.sh URL as the original code path", () => {
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "browser" }));
      assertEquals(
        result.specifier,
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });

    it("still pins tailwindcss regardless of the flag", () => {
      const result = bareStrategy.rewrite(makeInfo("tailwindcss"), makeCtx({ target: "browser" }));
      assertEquals(result.specifier?.includes("tailwindcss@"), true);
    });

    it("preserves inline-versioned specifiers unchanged", () => {
      const result = bareStrategy.rewrite(
        makeInfo("zod@3.22.4"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("esm.sh/zod@3.22.4"), true);
    });
  });

  describe("rewrite: version-selection ladder when VERYFRONT_DEPENDENCY_PINNING=1", () => {
    let originalFlag: string | undefined;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      _clearNpmVersionCache();
      clearReactVersionCache();
      // Mock fetch so cold-cache paths never make real network requests in tests.
      originalFetch = globalThis.fetch;
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
    });

    afterEach(async () => {
      // Drain any in-flight background resolutions before the sanitizer runs.
      await _pendingResolutions();
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      _clearNpmVersionCache();
      clearReactVersionCache();
      globalThis.fetch = originalFetch;
    });

    it("uses a synchronously stored exact version from the npm cache (no registry fetch needed)", () => {
      // Store an exact semver synchronously — scheduleNpmVersionResolution short-
      // circuits for exact literals, so no background network request is issued.
      scheduleNpmVersionResolution("lodash", "4.17.21", "/project");
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "browser" }));
      assertEquals(result.specifier?.includes("lodash@4.17.21"), true);
    });

    it("falls back to unversioned URL when both caches are cold", async () => {
      // No package.json cache, no npm registry cache — must behave like flag-off.
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "browser" }));
      // Yield one tick so the background fetch microtask settles and clears its timer.
      await new Promise<void>((r) => setTimeout(r, 1));
      assertEquals(
        result.specifier,
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });

    it("uses the inline version even when a registry cache entry exists", () => {
      scheduleNpmVersionResolution("lodash", "3.0.0", "/project");
      // Inline version (4.17.21) must win over the cached 3.0.0.
      const result = bareStrategy.rewrite(
        makeInfo("lodash@4.17.21"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("lodash@4.17.21"), true);
      assertEquals(result.specifier?.includes("3.0.0"), false);
    });

    it("produces a versioned URL for a scoped package from npm cache", () => {
      scheduleNpmVersionResolution("@tanstack/react-query", "5.28.0", "/project");
      const result = bareStrategy.rewrite(
        makeInfo("@tanstack/react-query"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("@tanstack/react-query@5.28.0"), true);
    });

    it("still uses tailwindcss pinned version regardless of npm cache", () => {
      const result = bareStrategy.rewrite(makeInfo("tailwindcss"), makeCtx({ target: "browser" }));
      assertEquals(result.specifier?.includes("tailwindcss@"), true);
    });

    it("SSR target is not affected by the pin flag", () => {
      scheduleNpmVersionResolution("lodash", "4.17.21", "/project");
      // SSR always returns null for bare specifiers with no inline version.
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "ssr" }));
      assertEquals(result.specifier, null);
    });

    it("preserves a dist-tag specifier (pkg@next) and does not override it with a numeric pin", () => {
      // pkg@next has a version specifier (the dist-tag "next"); the pin ladder
      // must not treat it as unversioned and inject a cached numeric version.
      scheduleNpmVersionResolution("some-pkg", "4.0.0", "/project");
      const result = bareStrategy.rewrite(
        makeInfo("some-pkg@next"),
        makeCtx({ target: "browser" }),
      );
      // The specifier already has a version (@next); it should be passed through
      // to the esm.sh URL builder as-is.
      assertEquals(result.specifier?.includes("some-pkg@next"), true);
      assertEquals(result.specifier?.includes("4.0.0"), false);
    });

    it("treats a compound range in package.json as unpinned and falls back to registry cache", () => {
      // Compound ranges like ">=1.0.0 <2.0.0" are not exact semver literals so
      // isExactSemver returns false. The strategy skips them and falls through to
      // the npm registry cache (which is also cold here) — unversioned fallback.
      _primeDependenciesCache("/project", { lodash: ">=1.0.0 <2.0.0" });
      // No registry cache entry — should fall through to cold-cache (unversioned).
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "browser" }));
      assertEquals(
        result.specifier,
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });
  });

  describe("rewrite: SSR strips explicit versions from bare specifiers", () => {
    const ssr = makeCtx({ target: "ssr" });

    it("strips the version so an installed package resolves by name", () => {
      // Regression: `import()` of `next-themes@0.4.6` has no matching
      // node_modules entry and stalls the cold module load to a 500.
      assertEquals(bareStrategy.rewrite(makeInfo("next-themes@0.4.6"), ssr), {
        specifier: "next-themes",
      });
    });

    it("leaves an unversioned specifier unchanged", () => {
      assertEquals(bareStrategy.rewrite(makeInfo("next-themes"), ssr), { specifier: null });
    });

    it("preserves the subpath while stripping the version", () => {
      assertEquals(bareStrategy.rewrite(makeInfo("date-fns@3.6.0/locale"), ssr), {
        specifier: "date-fns/locale",
      });
    });

    it("strips the version from a scoped package", () => {
      assertEquals(bareStrategy.rewrite(makeInfo("@tanstack/react-query@5.0.0"), ssr), {
        specifier: "@tanstack/react-query",
      });
    });

    it("keeps the version in the browser esm.sh URL (unchanged)", () => {
      const result = bareStrategy.rewrite(
        makeInfo("next-themes@0.4.6"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(
        result.specifier?.startsWith("https://esm.sh/next-themes@0.4.6"),
        true,
      );
    });
  });
});
