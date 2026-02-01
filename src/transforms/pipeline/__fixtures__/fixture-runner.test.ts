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
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import * as esbuild from "esbuild";
import { runPipeline } from "../index.ts";

const FIXTURES_DIR = new URL(".", import.meta.url).pathname;

async function readFixture(name: string, file: string): Promise<string> {
  return await readTextFile(`${FIXTURES_DIR}${name}/${file}`);
}

const TEST_OPTIONS = {
  projectId: "test-project",
  dev: true,
  moduleServerUrl: "http://localhost:3001/_vf_modules",
};

describe("transform pipeline fixtures", { sanitizeResources: false, sanitizeOps: false }, () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  describe("react-only", () => {
    it("transforms JSX and uses esm.sh React imports for browser", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(input, "/project/components/Counter.tsx", "/project", {
        ...TEST_OPTIONS,
        ssr: false,
      });

      assertStringIncludes(result.code, "jsx");
      assertStringIncludes(result.code, "esm.sh/react");
      assertEquals(result.code.includes('from "react"'), false);
    });

    it("resolves React for SSR (npm: on Deno, file:// on Node/Bun)", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(input, "/project/components/Counter.tsx", "/project", {
        ...TEST_OPTIONS,
        ssr: true,
      });

      assertStringIncludes(result.code, "jsx");

      // SSR on all platforms uses cached file:// paths for HTTP bundles
      assertStringIncludes(result.code, "file://");

      assertEquals(result.code.includes('from "react"'), false);
    });
  });

  describe("react-query (npm packages)", () => {
    it("converts to esm.sh URL with React externalized for browser", async () => {
      const input = await readFixture("react-query", "input.tsx");

      const result = await runPipeline(input, "/project/components/UserProfile.tsx", "/project", {
        ...TEST_OPTIONS,
        ssr: false,
      });

      assertStringIncludes(result.code, "esm.sh/@tanstack/react-query");
      assertStringIncludes(result.code, "external=react");
    });

    // Skip this test on Node.js - SSR module resolution differs by runtime
    (isDeno ? it : it.skip)(
      "resolves React to cached file:// URLs for SSR (Deno only)",
      async () => {
        const input = await readFixture("react-query", "input.tsx");

        const result = await runPipeline(input, "/project/components/UserProfile.tsx", "/project", {
          ...TEST_OPTIONS,
          ssr: true,
        });

        // SSR uses cached file:// paths for HTTP bundles
        assertStringIncludes(result.code, "file://");
        assertStringIncludes(result.code, "jsx");
      },
    );
  });

  describe("relative imports", () => {
    it("resolves @/ alias to module server URLs for browser", async () => {
      const input = await readFixture("relative-imports", "input.tsx");

      const result = await runPipeline(input, "/project/pages/index.tsx", "/project", {
        ...TEST_OPTIONS,
        ssr: false,
      });

      assertEquals(result.code.includes('from "@/'), false);
    });
  });

  describe("pipeline result", () => {
    it("returns code, content hash, and timing", async () => {
      const input = await readFixture("react-only", "input.tsx");

      const result = await runPipeline(input, "/project/components/Counter.tsx", "/project", {
        ...TEST_OPTIONS,
        ssr: false,
      });

      assertEquals(typeof result.code, "string");
      assertEquals(result.code.length > 0, true);

      assertEquals(typeof result.contentHash, "string");
      assertEquals(result.contentHash.length > 0, true);

      assertEquals(result.totalMs >= 0, true);
    });
  });
});
