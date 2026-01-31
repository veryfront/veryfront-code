import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { nodeBuiltinStrategy } from "./node-builtin-strategy.ts";

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

describe("NodeBuiltinStrategy", () => {
  describe("matches", () => {
    it("should match node: imports", () => {
      assertEquals(nodeBuiltinStrategy.matches("node:fs", makeCtx()), true);
    });

    it("should match node:async_hooks", () => {
      assertEquals(nodeBuiltinStrategy.matches("node:async_hooks", makeCtx()), true);
    });

    it("should not match bare specifiers", () => {
      assertEquals(nodeBuiltinStrategy.matches("lodash", makeCtx()), false);
    });

    it("should not match relative imports", () => {
      assertEquals(nodeBuiltinStrategy.matches("./node-utils", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should return null for SSR target (keep as-is)", () => {
      const result = nodeBuiltinStrategy.rewrite(makeInfo("node:fs"), makeCtx({ target: "ssr" }));
      assertEquals(result.specifier, null);
    });

    it("should return polyfill URL for known builtin in browser", () => {
      const result = nodeBuiltinStrategy.rewrite(
        makeInfo("node:async_hooks"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("node-async-hooks"), true);
    });

    it("should return noop URL for unknown builtin in browser", () => {
      const result = nodeBuiltinStrategy.rewrite(
        makeInfo("node:fs"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier?.includes("node-noop"), true);
    });
  });
});
