import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { vendorStrategy } from "./vendor-strategy.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test",
    target: "browser",
    dev: false,
    reactVersion: "19.1.1",
    vendorBundleHash: "abc123",
    moduleServerUrl: "http://localhost:3000/_vf_modules",
    ...overrides,
  };
}

function makeInfo(specifier: string, isDynamic = false): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

describe("VendorStrategy", () => {
  describe("matches", () => {
    it("should match react in browser with vendor config", () => {
      assertEquals(vendorStrategy.matches("react", makeCtx()), true);
    });

    it("should match react-dom", () => {
      assertEquals(vendorStrategy.matches("react-dom", makeCtx()), true);
    });

    it("should match react/jsx-runtime", () => {
      assertEquals(vendorStrategy.matches("react/jsx-runtime", makeCtx()), true);
    });

    it("should not match in SSR target", () => {
      assertEquals(vendorStrategy.matches("react", makeCtx({ target: "ssr" })), false);
    });

    it("should not match without vendor hash", () => {
      assertEquals(
        vendorStrategy.matches("react", makeCtx({ vendorBundleHash: undefined })),
        false,
      );
    });

    it("should not match non-react packages", () => {
      assertEquals(vendorStrategy.matches("lodash", makeCtx()), false);
    });

    it("should not match without a module server URL", () => {
      assertEquals(
        vendorStrategy.matches("react", makeCtx({ moduleServerUrl: undefined })),
        false,
        "vendor strategy must not claim react without a module server URL",
      );
    });
  });

  describe("rewrite", () => {
    it("should rewrite static react import to vendor URL", () => {
      const result = vendorStrategy.rewrite(makeInfo("react"), makeCtx());
      assertEquals(result.specifier?.includes("_vendor.js"), true);
      assertEquals(result.specifier?.includes("v=abc123"), true);
    });

    it("should path-bind vendor URLs to the browser dependency snapshot", () => {
      const result = vendorStrategy.rewrite(
        makeInfo("react"),
        makeCtx({ dependencyPinningCacheKey: "on:snapshot-a" }),
      );
      assertEquals(
        result.specifier,
        "http://localhost:3000/_vf_modules/_pins/on%3Asnapshot-a/_vendor.js?v=abc123",
      );
    });

    it("should rewrite dynamic import with statement replacement", () => {
      const result = vendorStrategy.rewrite(makeInfo("react", true), makeCtx());
      assertEquals(result.specifier, null);
      assertEquals(result.statement?.includes("import("), true);
      assertEquals(result.statement?.includes("_vendor.js"), true);
    });

    it("should select the sanitized export name for a dynamic subpath import", () => {
      const result = vendorStrategy.rewrite(makeInfo("react-dom/client", true), makeCtx());

      assertEquals(
        result.statement,
        "import('http://localhost:3000/_vf_modules/_vendor.js?v=abc123').then(m => m.reactDomClient)",
        "a dynamic vendor import must select the sanitized export name for the specifier",
      );
      assertEquals(
        result.specifier,
        null,
        "a dynamic vendor import replaces the whole statement instead of the specifier",
      );
    });

    it("should return null when no module server URL", () => {
      const result = vendorStrategy.rewrite(
        makeInfo("react"),
        makeCtx({ moduleServerUrl: undefined }),
      );
      assertEquals(
        result.specifier,
        null,
        "vendor rewrite declines when no module server URL is configured",
      );
    });

    it("should return null when no vendor config", () => {
      const result = vendorStrategy.rewrite(
        makeInfo("react"),
        makeCtx({ vendorBundleHash: undefined }),
      );
      assertEquals(result.specifier, null);
    });
  });
});
