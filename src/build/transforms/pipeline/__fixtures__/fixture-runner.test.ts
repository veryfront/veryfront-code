/**
 * Fixture-based tests for the transform pipeline.
 *
 * Tests transform behavior for common scenarios:
 * - React-only components
 * - NPM packages (react-query, etc.)
 * - MDX pages
 * - Relative imports
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { runPipeline } from "../index.ts";

const FIXTURES_DIR = new URL(".", import.meta.url).pathname;

async function readFixture(name: string, file: string): Promise<string> {
  const path = `${FIXTURES_DIR}${name}/${file}`;
  return await Deno.readTextFile(path);
}

const TEST_OPTIONS = {
  projectId: "test-project",
  dev: true,
  moduleServerUrl: "http://localhost:3001/_vf_modules",
};

// Note: esbuild spawns subprocesses that cause resource leaks in Deno tests
// We disable resource/ops sanitization for these tests
const testOpts = { sanitizeResources: false, sanitizeOps: false };

// ============================================================================
// React-only fixture tests
// ============================================================================

Deno.test({
  name: "transform: react-only (browser)",
  ...testOpts,
  async fn() {
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
  },
});

Deno.test({
  name: "transform: react-only (ssr)",
  ...testOpts,
  async fn() {
    const input = await readFixture("react-only", "input.tsx");

    const result = await runPipeline(
      input,
      "/project/components/Counter.tsx",
      "/project",
      { ...TEST_OPTIONS, ssr: true },
    );

    // Should transform JSX
    assertStringIncludes(result.code, "jsx");

    // SSR now uses esm.sh URLs (same as browser) for dynamic file:// import compatibility
    // This ensures imports work in Docker without needing node_modules
    assertStringIncludes(result.code, "esm.sh/react@18.3.1");

    // Should NOT have bare "react" import (would fail in Docker)
    assertEquals(result.code.includes('from "react"'), false);
  },
});

// ============================================================================
// React Query fixture tests (npm packages)
// ============================================================================

Deno.test({
  name: "transform: react-query converts to esm.sh URL (browser)",
  ...testOpts,
  async fn() {
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
  },
});

Deno.test({
  name: "transform: react-query leaves bare specifier for SSR (deno resolves)",
  ...testOpts,
  async fn() {
    const input = await readFixture("react-query", "input.tsx");

    const result = await runPipeline(
      input,
      "/project/components/UserProfile.tsx",
      "/project",
      { ...TEST_OPTIONS, ssr: true },
    );

    // SSR leaves npm packages as bare specifiers for Deno's import map to resolve
    assertStringIncludes(result.code, '@tanstack/react-query"');
    // Should NOT be converted to esm.sh URL (Deno resolves via its import map)
    assertEquals(result.code.includes("esm.sh/@tanstack/react-query"), false);
  },
});

// ============================================================================
// Relative imports fixture tests
// ============================================================================

Deno.test({
  name: "transform: relative-imports resolves @/ alias (browser)",
  ...testOpts,
  async fn() {
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
  },
});

// ============================================================================
// Pipeline result tests
// ============================================================================

Deno.test({
  name: "transform: pipeline returns code",
  ...testOpts,
  async fn() {
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
  },
});
