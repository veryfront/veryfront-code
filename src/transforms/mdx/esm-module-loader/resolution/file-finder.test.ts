/**
 * Tests for framework file resolution in the MDX module loader.
 *
 * These tests ensure that framework files under _veryfront/ are
 * properly resolved from the framework source directory.
 */
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { resolveModuleFile } from "./file-finder.ts";

const mockAdapter = createMockAdapter();

function createResolveFileTrackingAdapter(): {
  adapter: typeof mockAdapter;
  wasCalled: () => boolean;
} {
  let resolveFileCalled = false;

  const adapter = {
    ...mockAdapter,
    fs: {
      ...mockAdapter.fs,
      resolveFile: async (_path: string): Promise<string | null> => {
        resolveFileCalled = true;
        return null;
      },
    },
  };

  return { adapter, wasCalled: () => resolveFileCalled };
}

async function assertResolvedModuleFile(
  modulePath: string,
  expectedSuffix: string,
  sourceIncludes?: string,
): Promise<void> {
  const result = await resolveModuleFile(modulePath, mockAdapter, undefined);

  assertExists(result, `Should resolve ${modulePath}`);
  assertEquals(
    result.actualFilePath.endsWith(expectedSuffix),
    true,
    `Expected path to end with ${expectedSuffix}, got: ${result.actualFilePath}`,
  );
  assertExists(result.sourceCode, "Should have source code");

  if (!sourceIncludes) return;

  assertEquals(
    result.sourceCode.includes(sourceIncludes),
    true,
    `Should contain ${sourceIncludes} export`,
  );
}

describe("resolveModuleFile", () => {
  it("does not call adapter.fs.resolveFile for framework paths", async () => {
    const { adapter, wasCalled } = createResolveFileTrackingAdapter();

    // Framework paths should skip the API adapter entirely
    const result = await resolveModuleFile(
      "_vf_modules/_veryfront/react/router/index.js",
      adapter as any,
      "/project",
    );

    assertExists(result, "Should resolve framework path locally");
    assertEquals(
      wasCalled(),
      false,
      "Should NOT call adapter.fs.resolveFile for framework paths",
    );
  });

  it("calls adapter.fs.resolveFile for project paths", async () => {
    const { adapter, wasCalled } = createResolveFileTrackingAdapter();

    await resolveModuleFile("_vf_modules/components/Button.js", adapter as any, "/project");
    assertEquals(wasCalled(), true, "Should call adapter.fs.resolveFile for project paths");
  });

  it("resolves framework react/* files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/_veryfront/react/router/index.js",
      "src/react/router/index.tsx",
      "useRouter",
    );
  });

  it("resolves framework react/context files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/_veryfront/react/context/index.js",
      "src/react/context/index.tsx",
      "usePageContext",
    );
  });

  it("resolves framework react/components/Head files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/_veryfront/react/components/Head.js",
      "src/react/components/Head.tsx",
      "Head",
    );
  });

  it("resolves framework react/fonts files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/_veryfront/react/fonts/index.js",
      "src/react/fonts/index.ts",
    );
  });

  // === Production path format tests ===
  // These tests use the EXACT paths that production generates, including:
  // - ?ssr=true query parameters (from SSR import rewriter)
  // This prevents regressions where tests pass but production fails.

  it("resolves paths with ?ssr=true query parameter", async () => {
    // SSR import rewriter appends ?ssr=true to framework imports
    await assertResolvedModuleFile(
      "_vf_modules/_veryfront/react/components/Head.js?ssr=true",
      "src/react/components/Head.tsx",
      "Head",
    );
  });

  it("resolves all production import map paths", async () => {
    // Contract test: verify all paths in default-import-map.ts are resolvable
    // This catches mismatches between import map output and file-finder expectations
    const productionPaths = [
      "/_vf_modules/_veryfront/react/components/Head.js",
      "/_vf_modules/_veryfront/react/router/index.js",
      "/_vf_modules/_veryfront/react/context/index.js",
      "/_vf_modules/_veryfront/react/fonts/index.js",
    ];

    for (const path of productionPaths) {
      // Strip leading slash (file-finder expects paths without leading /)
      const normalizedPath = path.replace(/^\//, "");
      const result = await resolveModuleFile(normalizedPath, mockAdapter, undefined);
      assertExists(result, `Production path should resolve: ${path}`);
    }
  });

  it("resolves all production import map paths with ?ssr=true", async () => {
    // Same as above but with SSR query parameter
    const productionPathsWithSSR = [
      "_vf_modules/_veryfront/react/components/Head.js?ssr=true",
      "_vf_modules/_veryfront/react/router/index.js?ssr=true",
      "_vf_modules/_veryfront/react/context/index.js?ssr=true",
      "_vf_modules/_veryfront/react/fonts/index.js?ssr=true",
    ];

    for (const path of productionPathsWithSSR) {
      const result = await resolveModuleFile(path, mockAdapter, undefined);
      assertExists(result, `Production SSR path should resolve: ${path}`);
    }
  });

  it("handles various query parameter formats", async () => {
    // Edge cases for query parameter stripping
    const pathsWithQueryParams = [
      "_vf_modules/_veryfront/react/router/index.js?ssr=true",
      "_vf_modules/_veryfront/react/router/index.js?ssr=true&cache=false",
      "_vf_modules/_veryfront/react/router/index.js?",
    ];

    for (const path of pathsWithQueryParams) {
      const result = await resolveModuleFile(path, mockAdapter, undefined);
      assertExists(result, `Should resolve path with query params: ${path}`);
    }
  });

  // No legacy prefixes supported.
});
