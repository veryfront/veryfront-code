import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { bareStrategy } from "./bare-strategy.ts";

function makeCtx(overrides?: Partial<RewriteContext>): RewriteContext {
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
      const result = bareStrategy.rewrite(
        makeInfo("lodash"),
        makeCtx({ target: "ssr" }),
      );
      assertEquals(result.specifier, null);
    });

    it("should rewrite to esm.sh URL for browser", () => {
      const result = bareStrategy.rewrite(
        makeInfo("lodash"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier!.includes("esm.sh"), true);
    });

    it("should handle tailwindcss with pinned version", () => {
      const result = bareStrategy.rewrite(
        makeInfo("tailwindcss"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier!.includes("tailwindcss@"), true);
    });

    it("should strip version from versioned specifier", () => {
      const result = bareStrategy.rewrite(
        makeInfo("lodash@4.17.21"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier!.includes("esm.sh/lodash"), true);
    });
  });
});
