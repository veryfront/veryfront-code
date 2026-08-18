import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";
import {
  generateProdHydrationModule,
  getProdHydrationModulePath,
  getProdScripts,
  getProdScriptsForPath,
  PROD_HYDRATION_MODULE_PATH,
} from "./prod-scripts.ts";

async function bundleHydrationModuleAgainstLegacyRouter(hydrationModule: string): Promise<void> {
  const fixtureModules = new Map([
    ["react", "export function createElement() { return null; }"],
    ["react-dom/client", "export function createRoot() { return { render() {} }; }"],
    [
      "veryfront/router",
      [
        "export function RouterProvider({ children }) { return children; }",
        "export function useRouter() { return {}; }",
      ].join("\n"),
    ],
    [
      "veryfront/context",
      "export function PageContextProvider({ children }) { return children; }",
    ],
  ]);

  await esbuild.build({
    stdin: {
      contents: hydrationModule,
      sourcefile: "hydration-runtime.js",
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    // A missing namespace property is the compatibility path under test, so the
    // expected esbuild warning is intentionally quiet. Any static named import
    // still fails the build.
    logLevel: "silent",
    plugins: [{
      name: "legacy-router-fixture",
      setup(build) {
        build.onResolve(
          { filter: /^(react|react-dom\/client|veryfront\/router|veryfront\/context)$/ },
          (args) => ({ path: args.path, namespace: "legacy-router-fixture" }),
        );
        build.onLoad(
          { filter: /.*/, namespace: "legacy-router-fixture" },
          (args) => ({ contents: fixtureModules.get(args.path), loader: "js" }),
        );
      },
    }],
  });
}

function extractModuleScript(scriptTag: string): string {
  const start = scriptTag.indexOf(">") + 1;
  const end = scriptTag.lastIndexOf("</script>");
  if (start === 0 || end < start) throw new Error("Expected a module script tag");
  return scriptTag.slice(start, end);
}

describe("hydration-script-builder/prod-scripts", () => {
  describe("getProdScripts", () => {
    it("should return an external module script tag with the versioned runtime path", () => {
      const result = getProdScripts("my-page");
      const runtimePath = getProdHydrationModulePath();
      assertEquals(
        result.includes(`<script type="module" src="${runtimePath}"`),
        true,
      );
      assertEquals(result.includes(PROD_HYDRATION_MODULE_PATH), false);
      assertEquals(result.includes("</script>"), true);
      assertEquals(result.includes("renderPage"), false);
    });

    it("should derive a stable content-addressed runtime path", () => {
      const runtimePath = getProdHydrationModulePath();

      assertEquals(
        /^\/_veryfront\/hydration-runtime\.[0-9a-f]+\.js$/.test(runtimePath),
        true,
      );
      assertEquals(getProdHydrationModulePath(), runtimePath);
      assertEquals(runtimePath === PROD_HYDRATION_MODULE_PATH, false);
    });

    it("should include nonce attribute when provided", () => {
      const result = getProdScripts("page", undefined, undefined, "nonce-abc");
      assertEquals(result.includes('nonce="nonce-abc"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = getProdScripts("page");
      assertEquals(result.includes("nonce="), false);
    });

    it("should use an explicitly selected release runtime path", () => {
      const releaseRuntimePath = "/_veryfront/hydration-runtime.1a2b3c4d.js";
      const result = getProdScriptsForPath(releaseRuntimePath, "nonce-abc");

      assertEquals(result.includes(`src="${releaseRuntimePath}"`), true);
      assertEquals(result.includes(getProdHydrationModulePath()), false);
    });

    it("should use the rollout-stable unversioned runtime path", () => {
      const result = getProdScriptsForPath(PROD_HYDRATION_MODULE_PATH, "nonce-abc");

      assertEquals(result.includes(`src="${PROD_HYDRATION_MODULE_PATH}"`), true);
      assertEquals(result.includes(getProdHydrationModulePath()), false);
    });

    it("should reject an invalid selected runtime path", () => {
      const error = assertThrows(
        () => getProdScriptsForPath('"><script>alert(1)</script>'),
        Error,
      );

      assertEquals((error as { slug?: unknown }).slug, "render-error");
    });
  });

  describe("generateProdHydrationModule", () => {
    it("should import React", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes('import * as React from "react"'), true);
    });

    it("should import createRoot for RSC module client rendering", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes('import { createRoot } from "react-dom/client"'), true);
    });

    it("should import RouterProvider from veryfront/router", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes('from "veryfront/router"'), true);
    });

    it("should import PageContextProvider from veryfront/context", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes('from "veryfront/context"'), true);
    });

    it("should read getNavigationStore off the namespace so legacy assets still link", () => {
      const result = generateProdHydrationModule();
      // A static named import would fail to link against a release-pinned
      // router asset that predates the export; a namespace read degrades.
      assertEquals(result.includes('import * as RouterRuntime from "veryfront/router"'), true);
      assertEquals(/import \{[^}]*getNavigationStore[^}]*\} from/.test(result), false);
    });

    it("should include the router runtime", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("createRouterRuntime"), true);
      assertEquals(result.includes("navigateSPA"), true);
    });

    it("should include the component loader", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("loadComponent"), true);
    });

    it("should include the hydration renderer and start it", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("renderPage"), true);
      assertEquals(result.includes("createHydrationRenderer"), true);
    });

    it("should not ship the type-only hydration data contract", () => {
      const result = generateProdHydrationModule();
      assertEquals(result.includes("HydrationDataStructure"), false);
    });
  });
});

Deno.test({
  name: "generated hydration modules link against router assets from existing releases",
  async fn() {
    try {
      await bundleHydrationModuleAgainstLegacyRouter(generateProdHydrationModule());
      await bundleHydrationModuleAgainstLegacyRouter(
        extractModuleScript(generateDevClientRendererScript()),
      );
    } finally {
      await esbuild.stop();
    }
  },
});
