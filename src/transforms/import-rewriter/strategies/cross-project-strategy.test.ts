import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CrossProjectStrategy, crossProjectStrategy } from "./cross-project-strategy.ts";
import type { RewriteContext, ImportSpecifierInfo, ImportSpecifier } from "../types.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "app/page.tsx",
    projectDir: "/project",
    projectId: "proj-1",
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
    end: specifier.length,
    statementStart: 0,
    statementEnd: specifier.length,
    raw: { n: specifier, s: 0, e: specifier.length, ss: 0, se: specifier.length, d: -1, a: -1 } as ImportSpecifier,
  };
}

describe("transforms/import-rewriter/strategies/cross-project-strategy", () => {
  describe("CrossProjectStrategy", () => {
    it("has name 'cross-project'", () => {
      assertEquals(crossProjectStrategy.name, "cross-project");
    });

    it("has priority 4", () => {
      assertEquals(crossProjectStrategy.priority, 4);
    });
  });

  describe("matches", () => {
    it("matches versioned cross-project import", () => {
      assertEquals(crossProjectStrategy.matches("my-project@1.0.0/@/components/Button", makeCtx()), true);
    });

    it("matches latest cross-project import", () => {
      assertEquals(crossProjectStrategy.matches("my-project/@/components/Button", makeCtx()), true);
    });

    it("does not match bare import", () => {
      assertEquals(crossProjectStrategy.matches("react", makeCtx()), false);
    });

    it("does not match relative import", () => {
      assertEquals(crossProjectStrategy.matches("./foo", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("returns null specifier for SSR target", () => {
      const result = crossProjectStrategy.rewrite(
        makeInfo("my-project@1.0.0/@/components/Button"),
        makeCtx({ target: "ssr" }),
      );
      assertEquals(result.specifier, null);
    });

    it("rewrites versioned import for browser target", () => {
      const result = crossProjectStrategy.rewrite(
        makeInfo("my-project@1.0.0/@/components/Button"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier!.includes("/_vf_modules/_cross/"), true);
      assertEquals(result.specifier!.includes("my-project@1.0.0"), true);
    });

    it("rewrites latest import for browser target", () => {
      const result = crossProjectStrategy.rewrite(
        makeInfo("my-project/@/components/Button"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier!.includes("/_vf_modules/_cross/my-project/"), true);
    });

    it("returns null for invalid specifier", () => {
      const result = crossProjectStrategy.rewrite(
        makeInfo("not-a-cross-project-import"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier, null);
    });
  });
});
