/**
 * Tests for framework file resolution in the MDX module loader.
 *
 * These tests ensure that framework files (react/*, lib/*, exports/*) are
 * properly resolved from the framework source directory, consistent with
 * the module server's findSourceFile behavior.
 */
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { resolveModuleFile } from "./file-finder.ts";

const mockAdapter = createMockAdapter();

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

  if (sourceIncludes) {
    assertEquals(
      result.sourceCode.includes(sourceIncludes),
      true,
      `Should contain ${sourceIncludes} export`,
    );
  }
}

describe("resolveModuleFile", () => {
  it("does not call adapter.fs.resolveFile for framework paths", async () => {
    let resolveFileCalled = false;
    const trackingAdapter = {
      ...mockAdapter,
      fs: {
        ...mockAdapter.fs,
        resolveFile: (_path: string) => {
          resolveFileCalled = true;
          return null;
        },
      },
    };

    // Framework paths should skip the API adapter entirely
    const result = await resolveModuleFile(
      "_vf_modules/react/router/index.js",
      trackingAdapter as any,
      "/project",
    );
    assertExists(result, "Should resolve framework path locally");
    assertEquals(
      resolveFileCalled,
      false,
      "Should NOT call adapter.fs.resolveFile for framework paths",
    );
  });

  it("calls adapter.fs.resolveFile for project paths", async () => {
    let resolveFileCalled = false;
    const trackingAdapter = {
      ...mockAdapter,
      fs: {
        ...mockAdapter.fs,
        resolveFile: (_path: string) => {
          resolveFileCalled = true;
          return null;
        },
      },
    };

    await resolveModuleFile("_vf_modules/components/Button.js", trackingAdapter as any, "/project");
    assertEquals(resolveFileCalled, true, "Should call adapter.fs.resolveFile for project paths");
  });

  it("resolves framework react/* files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/react/router/index.js",
      "src/react/router/index.ts",
      "useRouter",
    );
  });

  it("resolves framework react/context files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/react/context/index.js",
      "src/react/context/index.ts",
      "usePageContext",
    );
  });

  it("resolves framework react/components/Head files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/react/components/Head.js",
      "src/react/components/Head.tsx",
      "Head",
    );
  });

  it("resolves framework lib/* files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/lib/Router.js",
      "src/lib/Router.tsx",
    );
  });

  it("resolves framework react/fonts files", async () => {
    await assertResolvedModuleFile(
      "_vf_modules/react/fonts/index.js",
      "src/react/fonts/index.ts",
    );
  });
});
