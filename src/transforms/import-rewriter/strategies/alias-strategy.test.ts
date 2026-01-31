import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { aliasStrategy } from "./alias-strategy.ts";

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

describe("AliasStrategy", () => {
  describe("matches", () => {
    it("should match @/ imports", () => {
      assertEquals(aliasStrategy.matches("@/components/Button", makeCtx()), true);
    });

    it("should not match scoped packages", () => {
      assertEquals(aliasStrategy.matches("@tanstack/react-query", makeCtx()), false);
    });

    it("should not match relative imports", () => {
      assertEquals(aliasStrategy.matches("./utils", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should rewrite @/ to relative path from root-level file", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/components/Button"),
        makeCtx({ filePath: "/project/pages/index.tsx" }),
      );

      assertEquals(result.specifier, "../components/Button.js");
    });

    it("should rewrite @/ from nested file", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/utils/helper"),
        makeCtx({ filePath: "/project/components/ui/Card.tsx" }),
      );

      assertEquals(result.specifier, "../../utils/helper.js");
    });

    it("should keep existing extension for known extensions", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/lib/data.js"),
        makeCtx({ filePath: "/project/pages/index.tsx" }),
      );

      assertEquals(result.specifier?.endsWith(".js"), true);
    });

    it("should add .js extension when no known extension", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/utils/math"),
        makeCtx({ filePath: "/project/pages/index.tsx" }),
      );

      assertEquals(result.specifier?.endsWith(".js"), true);
    });
  });
});
