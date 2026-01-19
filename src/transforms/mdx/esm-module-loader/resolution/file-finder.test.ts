/**
 * Tests for framework file resolution in the MDX module loader.
 *
 * These tests ensure that framework files (react/*, lib/*, exports/*) are
 * properly resolved from the framework source directory, consistent with
 * the module server's findSourceFile behavior.
 */
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveModuleFile } from "./file-finder.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

const mockAdapter = createMockAdapter();

describe("resolveModuleFile", () => {
  it("resolves framework react/* files", async () => {
    // react/router/index.js should resolve to src/react/router/index.ts
    const result = await resolveModuleFile(
      "_vf_modules/react/router/index.js",
      mockAdapter,
      undefined,
    );

    assertExists(result, "Should resolve framework react/router/index file");
    assertEquals(
      result.actualFilePath.endsWith("src/react/router/index.ts"),
      true,
      `Expected path to end with src/react/router/index.ts, got: ${result.actualFilePath}`,
    );
    assertExists(result.sourceCode, "Should have source code");
    assertEquals(
      result.sourceCode.includes("useRouter"),
      true,
      "Should contain useRouter export",
    );
  });

  it("resolves framework react/context files", async () => {
    const result = await resolveModuleFile(
      "_vf_modules/react/context/index.js",
      mockAdapter,
      undefined,
    );

    assertExists(result, "Should resolve framework react/context/index file");
    assertEquals(
      result.actualFilePath.endsWith("src/react/context/index.ts"),
      true,
      `Expected path to end with src/react/context/index.ts, got: ${result.actualFilePath}`,
    );
    assertExists(result.sourceCode, "Should have source code");
    assertEquals(
      result.sourceCode.includes("usePageContext"),
      true,
      "Should contain usePageContext export",
    );
  });

  it("resolves framework react/components/Head files", async () => {
    const result = await resolveModuleFile(
      "_vf_modules/react/components/Head.js",
      mockAdapter,
      undefined,
    );

    assertExists(result, "Should resolve framework react/components/Head file");
    assertEquals(
      result.actualFilePath.endsWith("src/react/components/Head.tsx"),
      true,
      `Expected path to end with src/react/components/Head.tsx, got: ${result.actualFilePath}`,
    );
    assertExists(result.sourceCode, "Should have source code");
    assertEquals(
      result.sourceCode.includes("Head"),
      true,
      "Should contain Head export",
    );
  });

  it("resolves framework lib/* files", async () => {
    const result = await resolveModuleFile(
      "_vf_modules/lib/Router.js",
      mockAdapter,
      undefined,
    );

    assertExists(result, "Should resolve framework lib/Router file");
    assertEquals(
      result.actualFilePath.endsWith("src/lib/Router.tsx"),
      true,
      `Expected path to end with src/lib/Router.tsx, got: ${result.actualFilePath}`,
    );
    assertExists(result.sourceCode, "Should have source code");
  });

  it("resolves framework react/fonts files", async () => {
    const result = await resolveModuleFile(
      "_vf_modules/react/fonts/index.js",
      mockAdapter,
      undefined,
    );

    assertExists(result, "Should resolve framework react/fonts/index file");
    assertEquals(
      result.actualFilePath.endsWith("src/react/fonts/index.ts"),
      true,
      `Expected path to end with src/react/fonts/index.ts, got: ${result.actualFilePath}`,
    );
    assertExists(result.sourceCode, "Should have source code");
  });
});
