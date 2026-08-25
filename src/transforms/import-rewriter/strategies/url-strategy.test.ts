import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { urlStrategy } from "./url-strategy.ts";

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

describe("UrlStrategy", () => {
  describe("matches", () => {
    it("should match esm.sh https URLs", () => {
      assertEquals(urlStrategy.matches("https://esm.sh/lodash", makeCtx()), true);
    });

    it("should match esm.sh http URLs", () => {
      assertEquals(urlStrategy.matches("http://esm.sh/lodash", makeCtx()), true);
    });

    it("should not match other URLs", () => {
      assertEquals(
        urlStrategy.matches("https://cdn.example.com/lib.js", makeCtx()),
        false,
      );
    });

    it("should not match bare specifiers", () => {
      assertEquals(urlStrategy.matches("lodash", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should add deps to esm.sh URL without params", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx(),
      );
      assertEquals(specifier?.includes("external=react"), true);
    });

    it("should canonicalize URLs that already have params", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash?target=es2022"),
        makeCtx(),
      );
      assertEquals(specifier, "https://esm.sh/lodash?external=react,react-dom&target=es2022");
    });

    it("should return null for react packages (already configured)", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/react@19.1.1"),
        makeCtx({ reactVersion: "19.1.1" }),
      );
      assertEquals(specifier, null);
    });

    it("should pin an unversioned URL from the project dependency map", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(
        specifier,
        "https://esm.sh/lodash@4.17.21?external=react,react-dom&target=es2022",
      );
    });

    it("should pin an unversioned scoped URL with a subpath", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/@dnd-kit/core/dist"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { "@dnd-kit/core": "6.1.0" },
        }),
      );
      assertEquals(
        specifier,
        "https://esm.sh/@dnd-kit/core@6.1.0/dist?external=react,react-dom&target=es2022",
      );
    });

    it("should not override a version already present in the URL", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash@4.17.20"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(specifier?.includes("lodash@4.17.20"), true);
      assertEquals(specifier?.includes("4.17.21"), false);
    });

    it("should leave the URL unversioned when the flag is off", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx({
          dependencyPinningCacheKey: "off",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(specifier, "https://esm.sh/lodash?external=react,react-dom&target=es2022");
    });

    it("should leave the URL unversioned when the declaration is a range", () => {
      // Ranges are handed to the platform resolver; the render proceeds
      // unversioned until an exact declaration is written back.
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "^4.17.0" },
        }),
      );
      assertEquals(specifier?.includes("@^4"), false);
      assertEquals(specifier?.includes("lodash?"), true);
    });

    it("should leave the URL unversioned when the package is undeclared", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/recharts"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(specifier, "https://esm.sh/recharts?external=react,react-dom&target=es2022");
    });

    it("should not pin react, which owns its own resolution ladder", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/react"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { react: "18.0.0" },
        }),
      );
      assertEquals(specifier?.includes("react@18.0.0"), false);
    });

    it("should leave an esm.sh build-prefixed URL untouched", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/v135/lodash@4.17.21"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "4.17.99" },
        }),
      );
      assertEquals(specifier?.includes("4.17.99"), false);
    });
  });
});
