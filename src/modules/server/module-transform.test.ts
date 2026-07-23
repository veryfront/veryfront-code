import "#veryfront/schemas/_test-setup.ts";
/**
 * module-transform.ts unit tests
 *
 * Tests the SSR-vs-release-rewrite decision in `transformModuleToServable`
 * and the optional `postTransform` hook. Uses a mock adapter so no filesystem
 * access is required; the esbuild transform pipeline is exercised for real,
 * with the esbuild service stopped in afterAll so the sanitizers stay clean.
 *
 * @module modules/server/module-transform.test
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { transformModuleToServable } from "./module-transform.ts";

/** Minimal TypeScript source with a relative import for SSR-rewrite tests. */
const SOURCE_WITH_IMPORT = `import { child } from "./child.js";
export const value = child;
`;

/** Trivial TypeScript source with no imports. */
const SOURCE_NO_IMPORTS = `export const greeting = "hello";
`;

describe(
  "transformModuleToServable",
  () => {
    const adapter = createMockAdapter();
    const projectDir = "/test-project";

    afterAll(async () => {
      await stopEsbuild();
    });

    describe("SSR-vs-release decision", () => {
      it("applies SSR import rewrites when isSSR=true", async () => {
        const code = await transformModuleToServable({
          source: SOURCE_WITH_IMPORT,
          sourceFile: "/test-project/page.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: true },
          isSSR: true,
          ssrRewriteOptions: { projectSlug: "test", branch: null },
        });

        // applySSRImportRewritesAsync appends ?ssr=true&project=<slug> to relative imports
        assertStringIncludes(code, "ssr=true");
        assertStringIncludes(code, "project=test");
      });

      it("does not apply SSR rewrites when isSSR=false", async () => {
        const code = await transformModuleToServable({
          source: SOURCE_WITH_IMPORT,
          sourceFile: "/test-project/page.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: false },
          isSSR: false,
          // ssrRewriteOptions intentionally omitted — should not be called
        });

        assertEquals(code.includes("ssr=true"), false);
      });

      it("skips release dependency rewrite when releaseRewriteOptions is omitted", async () => {
        // Source has no http imports so the release rewrite would be a no-op anyway,
        // but omitting releaseRewriteOptions means the function returns early on the
        // non-SSR path without calling rewriteReleaseDependencyImportsForModule.
        const code = await transformModuleToServable({
          source: SOURCE_NO_IMPORTS,
          sourceFile: "/test-project/greet.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: false },
          isSSR: false,
          // No releaseRewriteOptions — batch-handler behaviour
        });

        assertStringIncludes(code, "greeting");
      });

      it("applies release rewrite when releaseRewriteOptions is provided and isSSR=false", async () => {
        // No real manifest → rewriteReleaseDependencyImportsForModule returns code
        // unchanged (releaseId required; without it the function bails early).
        // This test verifies the non-SSR branch is entered without throwing.
        const code = await transformModuleToServable({
          source: SOURCE_NO_IMPORTS,
          sourceFile: "/test-project/greet.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: false, ssr: false },
          isSSR: false,
          releaseRewriteOptions: {
            releaseId: null, // null → rewriteReleaseDependencyImportsForModule returns early
            readDependencySource: (_path) => Promise.resolve(""),
          },
        });

        assertStringIncludes(code, "greeting");
      });
    });

    describe("postTransform hook", () => {
      it("calls postTransform between transformToESM and SSR rewrites", async () => {
        const marker = "/* postTransform-was-called */";
        let postTransformInput = "";

        const code = await transformModuleToServable({
          source: SOURCE_NO_IMPORTS,
          sourceFile: "/test-project/greet.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: false },
          isSSR: false,
          postTransform: (c) => {
            postTransformInput = c;
            return c + "\n" + marker;
          },
        });

        // The hook received output from transformToESM
        assertStringIncludes(postTransformInput, "greeting");
        // The hook's output is part of the final code
        assertStringIncludes(code, marker);
      });

      it("postTransform result is passed into SSR rewrites", async () => {
        const injected = "/* injected */";

        const code = await transformModuleToServable({
          source: SOURCE_WITH_IMPORT,
          sourceFile: "/test-project/page.ts",
          projectDir,
          adapter,
          transformOpts: { projectId: "test", dev: true, ssr: true },
          isSSR: true,
          postTransform: (c) => c + "\n" + injected,
          ssrRewriteOptions: { projectSlug: "test", branch: null },
        });

        // Both the injected marker and SSR rewrites are present
        assertStringIncludes(code, injected);
        assertStringIncludes(code, "ssr=true");
      });
    });
  },
);
