import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
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
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { rewriteSSRImportsCompatAsync } from "../ssr-adapter.ts";
import { rewriteImports } from "../unified-rewriter.ts";
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
      assertEquals(bareStrategy.matches("HTTPS://esm.sh/react", makeCtx()), false);
      assertEquals(bareStrategy.matches("//esm.sh/react", makeCtx()), false);
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

    it("rejects configured server external packages in browser modules", () => {
      const ctx = makeCtx({
        target: "browser",
        serverExternalPackages: ["knex", "@prisma/client"],
      });

      for (
        const specifier of [
          "knex",
          "npm:knex@3.1.0",
          "@prisma/client/runtime/library",
        ]
      ) {
        const error = assertThrows(() => bareStrategy.rewrite(makeInfo(specifier), ctx));

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, "server-only-in-client");
        assertEquals(
          (error as VeryfrontError).message.includes("build.serverExternalPackages"),
          true,
        );
        assertEquals((error as VeryfrontError).message.includes(specifier), true);
        assertEquals((error as VeryfrontError).message.includes(ctx.filePath), true);
      }
    });

    it("keeps configured server external packages external for SSR", () => {
      const ctx = makeCtx({
        target: "ssr",
        serverExternalPackages: ["knex", "@prisma/client"],
      });

      assertEquals(bareStrategy.rewrite(makeInfo("knex"), ctx).specifier, null);
      assertEquals(bareStrategy.rewrite(makeInfo("npm:knex@3.1.0"), ctx).specifier, null);
      assertEquals(
        bareStrategy.rewrite(makeInfo("@prisma/client/runtime/library"), ctx).specifier,
        null,
      );
    });

    it("still rewrites an undeclared package when server externals are configured", () => {
      const result = bareStrategy.rewrite(
        makeInfo("sequelize"),
        makeCtx({ target: "browser", serverExternalPackages: ["knex"] }),
      );

      assertEquals(
        result.specifier,
        "https://esm.sh/sequelize?external=react,react-dom&target=es2022",
      );
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

    it("keeps transform output stable after a registry lookup warms", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "4.17.21" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const ctx = makeCtx({
        target: "browser",
        dependencyPinningCacheKey: "on:snapshot-a",
        dependencyPinningDependencies: {},
      });
      const before = bareStrategy.rewrite(makeInfo("lodash"), ctx);
      await _pendingResolutions();
      const after = bareStrategy.rewrite(makeInfo("lodash"), ctx);

      assertEquals(
        before.specifier,
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
      assertEquals(after.specifier, before.specifier);
    });

    it("keeps an unchanged draft byte-identical with exact dependency pins", async () => {
      const context = makeCtx({
        target: "browser",
        dependencyPinningCacheKey: "on:snapshot-exact",
        dependencyPinningDependencies: { lodash: "4.17.21" },
      });
      const source = [
        `import lodash from "lodash";`,
        `import debounce from "lodash/debounce";`,
      ].join("\n");

      const first = await rewriteImports(source, context);
      const second = await rewriteImports(source, context);

      assertEquals(second, first);
      assertEquals(
        first,
        [
          `import lodash from "https://esm.sh/lodash@4.17.21?external=react,react-dom&target=es2022";`,
          `import debounce from "https://esm.sh/lodash@4.17.21/debounce?external=react,react-dom&target=es2022";`,
        ].join("\n"),
      );
      assertEquals(first.includes("https://esm.sh/lodash?"), false);
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

    it("uses the inline version", () => {
      const result = bareStrategy.rewrite(
        makeInfo("lodash@4.17.21"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("lodash@4.17.21"), true);
    });

    it("keeps an inline version through the two-stage SSR rewrite", async () => {
      const context = makeCtx({
        target: "ssr",
        dependencyPinningCacheKey: "on:snapshot-inline",
        dependencyPinningDependencies: { lodash: "2.0.0" },
      });
      const afterPipeline = await rewriteImports(
        `import lodash from "lodash@1.2.3";`,
        context,
      );
      const afterAdapter = await rewriteSSRImportsCompatAsync(afterPipeline, {
        projectDir: context.projectDir,
        projectId: context.projectId,
        dependencyPinningCacheKey: context.dependencyPinningCacheKey,
        dependencyPinningDependencies: context.dependencyPinningDependencies,
      });

      assertEquals(
        afterPipeline,
        `import lodash from "https://esm.sh/lodash@1.2.3?external=react&target=es2022";`,
      );
      assertEquals(afterAdapter, afterPipeline);
      assertEquals(afterAdapter.includes("lodash@2.0.0"), false);
    });

    it("keeps native npm and server-only SSR imports external while pinning", () => {
      const context = makeCtx({
        target: "ssr",
        dependencyPinningCacheKey: "on:snapshot-inline",
        dependencyPinningDependencies: {},
      });

      assertEquals(bareStrategy.rewrite(makeInfo("npm:zod@1.2.3"), context), {
        specifier: null,
      });
      assertEquals(bareStrategy.rewrite(makeInfo("redis@5.11.0"), context), {
        specifier: null,
      });
    });

    it("preserves a declared v-prefixed exact version byte-for-byte", () => {
      const result = bareStrategy.rewrite(
        makeInfo("lodash"),
        makeCtx({
          target: "browser",
          dependencyPinningCacheKey: "on:snapshot-v",
          dependencyPinningDependencies: { lodash: "v4.17.21+build.7" },
        }),
      );

      assertEquals(result.specifier?.includes("lodash@v4.17.21+build.7"), true);
    });

    it("keeps an undeclared scoped package unversioned after registry warmup", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "5.28.0" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      const ctx = makeCtx({
        target: "browser",
        dependencyPinningCacheKey: "on:snapshot-b",
        dependencyPinningDependencies: {},
      });
      const before = bareStrategy.rewrite(makeInfo("@tanstack/react-query"), ctx);
      await _pendingResolutions();
      const after = bareStrategy.rewrite(makeInfo("@tanstack/react-query"), ctx);
      assertEquals(after.specifier, before.specifier);
      assertEquals(after.specifier?.includes("@tanstack/react-query@5.28.0"), false);
    });

    it("does not replace a declared package range with registry latest", async () => {
      _primeDependenciesCache("/project", { lodash: "^2" });
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        return Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "3.0.0" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      };

      const result = bareStrategy.rewrite(
        makeInfo("lodash"),
        makeCtx({ target: "browser" }),
      );
      await _pendingResolutions();

      assertEquals(fetchCalls, 0);
      assertEquals(
        result.specifier,
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });

    it("still uses tailwindcss pinned version regardless of npm cache", () => {
      const result = bareStrategy.rewrite(makeInfo("tailwindcss"), makeCtx({ target: "browser" }));
      assertEquals(result.specifier?.includes("tailwindcss@"), true);
    });

    it("SSR target is not affected by the pin flag", () => {
      // SSR always returns null for bare specifiers with no inline version.
      const result = bareStrategy.rewrite(makeInfo("lodash"), makeCtx({ target: "ssr" }));
      assertEquals(result.specifier, null);
    });

    it("preserves a dist-tag specifier (pkg@next)", () => {
      const result = bareStrategy.rewrite(
        makeInfo("some-pkg@next"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("some-pkg@next"), true);
    });

    it("leaves a compound package range on the current unversioned fallback", () => {
      // Compound ranges like ">=1.0.0 <2.0.0" are not exact semver literals so
      // isExactSemver returns false. The strategy must not replace the range with
      // registry latest, so it retains the current unversioned fallback.
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
    const ssr = makeCtx({
      target: "ssr",
      dependencyPinningCacheKey: "off",
    });

    it("strips the version so an installed package resolves by name", () => {
      // Regression: `import()` of `next-themes@0.4.6` has no matching
      // node_modules entry and stalls the cold module load to a 500.
      assertEquals(bareStrategy.rewrite(makeInfo("next-themes@0.4.6"), ssr), {
        specifier: "next-themes",
      });
    });

    it("treats an unknown dependency state as flag-off", () => {
      // "on:unknown" (unreadable package.json) must fall back to conservative
      // flag-off behavior instead of entering the pinning-on esm.sh branch.
      const unknown = makeCtx({
        target: "ssr",
        dependencyPinningCacheKey: "on:unknown",
      });
      assertEquals(bareStrategy.rewrite(makeInfo("next-themes@0.4.6"), unknown), {
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
