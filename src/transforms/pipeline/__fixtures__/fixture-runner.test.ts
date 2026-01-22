/**
 * Fixture-based tests for the transform pipeline.
 *
 * Tests transform behavior for common scenarios:
 * - React-only components
 * - NPM packages (react-query, etc.)
 * - MDX pages
 * - Relative imports
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/testing/deno-compat.ts";
import { runPipeline } from "../index.ts";
import * as esbuild from "esbuild";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

const FIXTURES_DIR = new URL(".", import.meta.url).pathname;

async function readFixture(name: string, file: string): Promise<string> {
  const path = `${FIXTURES_DIR}${name}/${file}`;
  return await readTextFile(path);
}

const TEST_OPTIONS = {
  projectId: "test-project",
  dev: true,
  moduleServerUrl: "http://localhost:3001/_vf_modules",
};

describe("transform pipeline fixtures", { sanitizeResources: false, sanitizeOps: false }, () => {
  // Clean up esbuild subprocess to prevent resource leaks
  afterAll(async () => {
    await esbuild.stop();
  });

  describe("react-only", () => {
    it("transforms JSX and uses esm.sh React imports for browser", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/Counter.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: false },
      );

      // Should transform JSX
      assertStringIncludes(result.code, "jsx");

      // Should have esm.sh React imports for browser
      assertStringIncludes(result.code, "esm.sh/react");

      // Should not have bare "react" import
      assertEquals(result.code.includes('from "react"'), false);
    });

    it("resolves React for SSR (HTTP URLs on Deno, file:// on Node/Bun)", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/Counter.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: true },
      );

      // Should transform JSX
      assertStringIncludes(result.code, "jsx");

      // SSR behavior depends on runtime:
      // - Deno: keeps esm.sh HTTP URLs (Deno supports HTTP imports natively)
      // - Node/Bun: caches HTTP modules to local file:// paths
      // This enables distributed caching - transformed code is portable across pods.
      if (isDeno) {
        assertStringIncludes(result.code, "esm.sh/react");
      } else {
        assertStringIncludes(result.code, "file://");
      }

      // Should NOT have bare "react" import (would fail in Docker)
      assertEquals(result.code.includes('from "react"'), false);
    });
  });

  describe("react-query (npm packages)", () => {
    it("converts to esm.sh URL with React externalized for browser", async () => {
      const input = await readFixture("react-query", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/UserProfile.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: false },
      );

      // NPM packages should be converted to esm.sh URLs with React externalized
      assertStringIncludes(result.code, "esm.sh/@tanstack/react-query");
      assertStringIncludes(result.code, "external=react");
    });

    it("preserves npm package specifiers for SSR (resolved by runtime)", async () => {
      const input = await readFixture("react-query", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/UserProfile.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: true },
      );

      // For SSR, npm packages are resolved by the runtime's import system:
      // - Deno: uses npm: specifiers or import maps
      // - Node/Bun: uses node_modules
      // The pipeline applies import maps if available but doesn't force esm.sh conversion
      // React is in the import map and gets resolved to esm.sh
      assertStringIncludes(result.code, "esm.sh/react");

      // JSX transforms work correctly
      assertStringIncludes(result.code, "jsx");
    });
  });

  describe("relative imports", () => {
    it("resolves @/ alias to module server URLs for browser", async () => {
      const input = await readFixture("relative-imports", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/pages/index.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: false },
      );

      // @/ imports should be transformed to module server URLs
      // Original: import { formatDate } from "@/lib/utils";
      // Should NOT contain bare @/ import
      assertEquals(result.code.includes('from "@/'), false);
    });
  });

  describe("pipeline result", () => {
    it("returns code, content hash, and timing", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/Counter.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: false },
      );

      // Should return code
      assertEquals(typeof result.code, "string");
      assertEquals(result.code.length > 0, true);

      // Should have content hash
      assertEquals(typeof result.contentHash, "string");
      assertEquals(result.contentHash.length > 0, true);

      // Should have timing
      assertEquals(result.totalMs >= 0, true);
    });
  });
});
