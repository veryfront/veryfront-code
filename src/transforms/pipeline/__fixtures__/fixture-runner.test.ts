/**
 * Fixture-based tests for the transform pipeline.
 *
 * Tests transform behavior for common scenarios:
 * - React-only components
 * - NPM packages (react-query, etc.)
 * - MDX pages
 * - Relative imports
 */

import { assertEquals, assertStringIncludes } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { readTextFile } from "@veryfront/testing/deno-compat";
import { runPipeline } from "../index.ts";

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

    it("uses esm.sh URLs for SSR (Docker-compatible)", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/Counter.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: true },
      );

      // Should transform JSX
      assertStringIncludes(result.code, "jsx");

      // SSR uses esm.sh URLs (same as browser) for Docker compatibility
      // This ensures imports work without needing node_modules
      assertStringIncludes(result.code, "esm.sh/react");

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

    it("caches npm packages to file:// URLs for SSR", async () => {
      const input = await readFixture("react-query", "input.tsx");

      const result = await runPipeline(
        input,
        "/project/components/UserProfile.tsx",
        "/project",
        { ...TEST_OPTIONS, ssr: true },
      );

      // SSR caches npm packages to local file:// paths for runtime-agnostic loading
      assertStringIncludes(result.code, "file://");
      // Should NOT have bare specifier (not resolvable in Docker without node_modules)
      assertEquals(result.code.includes('@tanstack/react-query"'), false);
      // Should NOT keep esm.sh URL (cached locally)
      assertEquals(result.code.includes("esm.sh/@tanstack/react-query"), false);
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
