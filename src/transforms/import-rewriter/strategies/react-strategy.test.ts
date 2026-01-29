import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { ReactStrategy } from "./react-strategy.ts";

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

describe("ReactStrategy", () => {
  const strategy = new ReactStrategy();

  describe("matches", () => {
    it("should match 'react'", () => {
      assertEquals(strategy.matches("react", makeCtx()), true);
    });

    it("should match 'react-dom'", () => {
      assertEquals(strategy.matches("react-dom", makeCtx()), true);
    });

    it("should match 'react/jsx-runtime'", () => {
      assertEquals(strategy.matches("react/jsx-runtime", makeCtx()), true);
    });

    it("should match 'react-dom/client'", () => {
      assertEquals(strategy.matches("react-dom/client", makeCtx()), true);
    });

    it("should not match lodash", () => {
      assertEquals(strategy.matches("lodash", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should rewrite react to esm.sh URL", () => {
      const result = strategy.rewrite(makeInfo("react"), makeCtx());
      assertEquals(result.specifier!.includes("esm.sh/react@19.1.1"), true);
    });

    it("should rewrite react-dom to esm.sh URL", () => {
      const result = strategy.rewrite(makeInfo("react-dom"), makeCtx());
      assertEquals(result.specifier!.includes("esm.sh/react-dom@19.1.1"), true);
    });

    it("should rewrite react/jsx-runtime", () => {
      const result = strategy.rewrite(makeInfo("react/jsx-runtime"), makeCtx());
      assertEquals(result.specifier!.includes("jsx-runtime"), true);
    });

    it("should handle unknown react/* subpaths via prefix", () => {
      const result = strategy.rewrite(makeInfo("react/some-custom-export"), makeCtx());
      assertEquals(result.specifier !== null, true);
    });

    it("should return null for non-react specifier that somehow matches", () => {
      // Force a specifier that passes matches but has no map entry
      const result = strategy.rewrite(makeInfo("react-dom/nonexistent-deep-path"), makeCtx());
      // Should still return null since react-dom/ subpaths not in map return null
      assertEquals(result.specifier, null);
    });
  });
});
