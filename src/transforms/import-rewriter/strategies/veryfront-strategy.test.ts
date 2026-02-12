import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { VeryfrontStrategy } from "./veryfront-strategy.ts";

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

describe("VeryfrontStrategy", () => {
  const strategy = new VeryfrontStrategy();

  describe("matches", () => {
    it("should match veryfront/*", () => {
      assertEquals(strategy.matches("veryfront/head", makeCtx()), true);
      assertEquals(strategy.matches("veryfront/workflow", makeCtx()), true);
    });

    it("should match #veryfront/*", () => {
      assertEquals(strategy.matches("#veryfront/utils", makeCtx()), true);
    });

    it("should match bare veryfront", () => {
      assertEquals(strategy.matches("veryfront", makeCtx()), true);
    });

    it("should not match other specifiers", () => {
      assertEquals(strategy.matches("react", makeCtx()), false);
      assertEquals(strategy.matches("lodash", makeCtx()), false);
    });
  });

  describe("SSR overrides", () => {
    it("should redirect veryfront/workflow to React-only submodule for SSR", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront/workflow"),
        makeCtx({ target: "ssr" }),
      );
      assert(result.specifier !== null, "specifier should not be null");
      assert(
        result.specifier!.includes("/workflow/react/index.js"),
        `Expected workflow/react/index.js in SSR, got: ${result.specifier}`,
      );
      assert(
        result.specifier!.includes("?ssr=true"),
        `Expected ?ssr=true param, got: ${result.specifier}`,
      );
    });

    it("should NOT redirect veryfront/workflow for browser target", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront/workflow"),
        makeCtx({ target: "browser" }),
      );
      assert(result.specifier !== null, "specifier should not be null");
      assert(
        !result.specifier!.includes("/workflow/react/"),
        `Browser target should use full module, got: ${result.specifier}`,
      );
    });

    it("should not apply SSR override to non-overridden modules", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront/head"),
        makeCtx({ target: "ssr" }),
      );
      assert(result.specifier !== null, "specifier should not be null");
      assert(
        result.specifier!.includes("?ssr=true"),
        `Expected ?ssr=true param for SSR, got: ${result.specifier}`,
      );
      // head should resolve normally, not through override
      assert(
        !result.specifier!.includes("/workflow/"),
        `head should not resolve to workflow path, got: ${result.specifier}`,
      );
    });
  });
});
