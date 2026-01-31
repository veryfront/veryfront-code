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

    it("should return null for URLs that already have params", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash?target=es2022"),
        makeCtx(),
      );
      assertEquals(specifier, null);
    });

    it("should return null for react packages (already configured)", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/react@19.1.1"),
        makeCtx({ reactVersion: "19.1.1" }),
      );
      assertEquals(specifier, null);
    });
  });
});
