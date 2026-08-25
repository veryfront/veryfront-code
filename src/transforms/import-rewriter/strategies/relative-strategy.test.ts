import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { relativeStrategy } from "./relative-strategy.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test",
    target: "browser",
    dev: false,
    reactVersion: "19.1.1",
    moduleServerUrl: "http://localhost:3000/_vf_modules",
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

describe("RelativeStrategy", () => {
  describe("matches", () => {
    it("should match ./ imports", () => {
      assertEquals(relativeStrategy.matches("./utils", makeCtx()), true);
    });

    it("should match ../ imports", () => {
      assertEquals(relativeStrategy.matches("../lib/helper", makeCtx()), true);
    });

    it("should not match bare specifiers", () => {
      assertEquals(relativeStrategy.matches("lodash", makeCtx()), false);
    });

    it("should not match absolute paths", () => {
      assertEquals(relativeStrategy.matches("/absolute/path", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    it("should resolve to module server URL for SSR when moduleServerUrl is available", () => {
      // Critical for compiled Deno binaries - framework files need to resolve via module server
      const result = relativeStrategy.rewrite(
        makeInfo("./component.tsx"),
        makeCtx({ target: "ssr" }),
      );

      assertEquals(
        result.specifier,
        "http://localhost:3000/_vf_modules/pages/component.js",
      );
    });

    it("should bind the SSR module URL to the dependency snapshot via a query token", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./child.ts"),
        makeCtx({ target: "ssr", dependencyPinningCacheKey: "on:snapshot-a" }),
      );

      assertEquals(
        result.specifier,
        "http://localhost:3000/_vf_modules/pages/child.js?pins=on%3Asnapshot-a",
        "SSR child modules carry the snapshot as a pins query token",
      );
    });

    it("should keep the .mdx extension on relative imports", () => {
      const moduleServerResult = relativeStrategy.rewrite(
        makeInfo("./post.mdx"),
        makeCtx({ target: "browser" }),
      );
      const inlineResult = relativeStrategy.rewrite(
        makeInfo("./post.mdx"),
        makeCtx({ target: "browser", moduleServerUrl: undefined }),
      );

      assertEquals(
        moduleServerResult.specifier,
        "http://localhost:3000/_vf_modules/pages/post.mdx",
        "a relative MDX import keeps its .mdx extension in the module server URL",
      );
      assertEquals(
        inlineResult.specifier,
        "./post.mdx",
        "a relative MDX import is left untouched when there is no module server",
      );
    });

    it("should normalize .tsx extension to .js for SSR when no moduleServerUrl", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./component.tsx"),
        makeCtx({ target: "ssr", moduleServerUrl: undefined }),
      );

      assertEquals(result.specifier, "./component.js");
    });

    it("should normalize .ts extension to .js for SSR when no moduleServerUrl", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./utils.ts"),
        makeCtx({ target: "ssr", moduleServerUrl: undefined }),
      );

      assertEquals(result.specifier, "./utils.js");
    });

    it("should return null for .js in SSR when no moduleServerUrl (no change needed)", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./utils.js"),
        makeCtx({ target: "ssr", moduleServerUrl: undefined }),
      );

      assertEquals(result.specifier, null);
    });

    it("should resolve to module server URL for browser", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./utils.ts"),
        makeCtx({
          target: "browser",
          filePath: "/project/pages/index.tsx",
          moduleServerUrl: "http://localhost:3000/_vf_modules",
        }),
      );

      assertEquals(
        result.specifier?.startsWith("http://localhost:3000/_vf_modules"),
        true,
      );
    });

    it("should preserve the captured snapshot on a browser child-module URL", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./child.ts"),
        makeCtx({
          target: "browser",
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );

      assertEquals(
        result.specifier,
        "http://localhost:3000/_vf_modules/_pins/on%3Asnapshot-a/pages/child.js",
      );
    });

    it("should resolve a root module child without truncating the parent filename", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./child.ts"),
        makeCtx({
          target: "browser",
          filePath: "/project/page.ts",
          moduleServerUrl: "/_vf_modules",
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );

      assertEquals(
        result.specifier,
        "/_vf_modules/_pins/on%3Asnapshot-a/child.js",
      );
    });

    it("should preserve the captured snapshot when the browser resolves the child relatively", () => {
      const sourceExtensionResult = relativeStrategy.rewrite(
        makeInfo("./child.ts"),
        makeCtx({
          target: "browser",
          moduleServerUrl: undefined,
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );
      const javascriptResult = relativeStrategy.rewrite(
        makeInfo("./already-compiled.js"),
        makeCtx({
          target: "browser",
          moduleServerUrl: undefined,
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );

      assertEquals(
        sourceExtensionResult.specifier,
        "./child.js",
      );
      assertEquals(javascriptResult.specifier, null);
    });

    it("should return normalized specifier when no moduleServerUrl", () => {
      const result = relativeStrategy.rewrite(
        makeInfo("./component.tsx"),
        makeCtx({ target: "browser", moduleServerUrl: undefined }),
      );

      assertEquals(result.specifier, "./component.js");
    });
  });
});
