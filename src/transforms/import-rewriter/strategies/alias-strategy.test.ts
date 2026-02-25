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

    it("should rewrite @/ to /_vf_modules/ path for SSR target", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/components/Button"),
        makeCtx({ target: "ssr", filePath: "/project/pages/index.tsx" }),
      );
      assertEquals(result.specifier, "/_vf_modules/components/Button.js");
    });

    it("should rewrite @/ with nested path to /_vf_modules/ for SSR", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/components/forms/ContactForm"),
        makeCtx({ target: "ssr", filePath: "/project/components/sections/ContactSection.tsx" }),
      );
      assertEquals(result.specifier, "/_vf_modules/components/forms/ContactForm.js");
    });

    it("should normalize extension for SSR", () => {
      const result = aliasStrategy.rewrite(
        makeInfo("@/lib/data.tsx"),
        makeCtx({ target: "ssr", filePath: "/project/pages/index.tsx" }),
      );
      assertEquals(result.specifier, "/_vf_modules/lib/data.js");
    });

    describe("moduleServerUrl path", () => {
      it("should use absolute path when moduleServerUrl is configured", () => {
        const result = aliasStrategy.rewrite(
          makeInfo("@/lib/utils"),
          makeCtx({
            filePath: "/project/components/elements/Textarea.tsx",
            moduleServerUrl: "/_vf_modules",
          }),
        );
        assertEquals(result.specifier, "/_vf_modules/lib/utils.js");
      });

      it("should handle file index path mismatch with moduleServerUrl", () => {
        // When file index returns "elements/Textarea.tsx" instead of "components/elements/Textarea.tsx"
        // Using moduleServerUrl avoids the relative path calculation issue entirely
        const result = aliasStrategy.rewrite(
          makeInfo("@/lib/utils"),
          makeCtx({
            filePath: "elements/Textarea.tsx",
            projectDir: "/project",
            moduleServerUrl: "/_vf_modules",
          }),
        );
        // With moduleServerUrl, we always use absolute paths - no relative path calculation needed
        assertEquals(result.specifier, "/_vf_modules/lib/utils.js");
      });
    });

    describe("CSS file imports (issue #453)", () => {
      it("should NOT append .js to .css imports for SSR", () => {
        // Bug: @/globals.css becomes /_vf_modules/globals.css.js
        // because .css is not in the known extension list
        const result = aliasStrategy.rewrite(
          makeInfo("@/globals.css"),
          makeCtx({ target: "ssr", filePath: "/project/app/layout.tsx" }),
        );
        // Expected: /_vf_modules/globals.css (preserve .css extension)
        // Actual (bug): /_vf_modules/globals.css.js
        assertEquals(result.specifier, "/_vf_modules/globals.css");
      });

      it("should NOT append .js to .css imports with moduleServerUrl", () => {
        const result = aliasStrategy.rewrite(
          makeInfo("@/globals.css"),
          makeCtx({
            filePath: "/project/app/layout.tsx",
            moduleServerUrl: "/_vf_modules",
          }),
        );
        assertEquals(result.specifier, "/_vf_modules/globals.css");
      });

      it("should NOT append .js to .css imports in browser fallback", () => {
        const result = aliasStrategy.rewrite(
          makeInfo("@/globals.css"),
          makeCtx({ filePath: "/project/app/layout.tsx" }),
        );
        // Should preserve .css, not become globals.css.js
        assertEquals(result.specifier?.endsWith(".css"), true);
        assertEquals(result.specifier?.endsWith(".css.js"), false);
      });
    });

    describe("relative path fallback (no moduleServerUrl)", () => {
      it("should handle file at components/elements depth correctly", () => {
        // File is at components/elements/Textarea.tsx
        // @/lib/utils should become ../../lib/utils.js (go up 2 levels to root)
        const result = aliasStrategy.rewrite(
          makeInfo("@/lib/utils"),
          makeCtx({ filePath: "/project/components/elements/Textarea.tsx" }),
        );
        assertEquals(result.specifier, "../../lib/utils.js");
      });

      it("relative path when file index has different structure (known limitation)", () => {
        // When file index returns "elements/Textarea.tsx" without components/ prefix
        // and no moduleServerUrl is configured, relative path calculation uses the file path as-is.
        // This is a known limitation - use moduleServerUrl for production deployments.
        const result = aliasStrategy.rewrite(
          makeInfo("@/lib/utils"),
          makeCtx({ filePath: "elements/Textarea.tsx", projectDir: "/project" }),
        );
        // depth=1 (only "elements"), so we get ../lib/utils.js
        // This is "correct" given the input, but may not match the expected module structure
        assertEquals(result.specifier, "../lib/utils.js");
      });
    });
  });
});
