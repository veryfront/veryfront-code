/**
 * Fixture-based tests for the transform pipeline.
 *
 * Tests transform behavior for common scenarios:
 * - React-only components
 * - React Query (context packages)
 * - MDX pages
 * - Relative imports
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { runPipeline } from "../index.ts";
import {
  getContextPackageUrlBrowser,
  getContextPackageUrlSSR,
} from "../../esm/package-registry.ts";

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
  },
});

// ============================================================================
// React Query fixture tests (context packages)
// ============================================================================

Deno.test({
  name: "transform: react-query resolves to esm.sh URL (browser)",
  ...testOpts,
  async fn() {
    const input = await readFixture("react-query", "input.tsx");

    const result = await runPipeline(
      input,
      "/project/components/UserProfile.tsx",
      "/project",
      { ...TEST_OPTIONS, ssr: false },
    );

    // Should resolve @tanstack/react-query to esm.sh URL for browser
    const expectedUrl = getContextPackageUrlBrowser("@tanstack/react-query");
    assertStringIncludes(result.code, expectedUrl);
  },
});

Deno.test({
  name: "transform: react-query resolves to npm specifier (ssr)",
  ...testOpts,
  async fn() {
    const input = await readFixture("react-query", "input.tsx");

    const result = await runPipeline(
      input,
      "/project/components/UserProfile.tsx",
      "/project",
      { ...TEST_OPTIONS, ssr: true },
    );

    // SSR uses npm: specifiers so Deno import map resolves React properly
    const expectedUrl = getContextPackageUrlSSR("@tanstack/react-query");
    assertStringIncludes(result.code, expectedUrl);
  },
});

Deno.test({
  name: "transform: SSR and browser use different context package resolution",
  ...testOpts,
  async fn() {
    const input = await readFixture("react-query", "input.tsx");

    const ssrResult = await runPipeline(
      input,
      "/project/components/UserProfile.tsx",
      "/project",
      { ...TEST_OPTIONS, ssr: true },
    );

    const browserResult = await runPipeline(
      input,
      "/project/components/UserProfile.tsx",
      "/project",
      { ...TEST_OPTIONS, ssr: false },
    );

    // SSR uses npm: specifiers (Deno's import map handles React)
    const ssrExpectedUrl = getContextPackageUrlSSR("@tanstack/react-query");
    assertStringIncludes(ssrResult.code, ssrExpectedUrl);

    // Browser uses esm.sh with ?external= (browser import map provides React)
    const browserExpectedUrl = getContextPackageUrlBrowser("@tanstack/react-query");
    assertStringIncludes(browserResult.code, browserExpectedUrl);
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
