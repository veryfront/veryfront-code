import "#veryfront/schemas/_test-setup.ts";
/**
 * Fixture-based tests for the transform pipeline.
 *
 * Tests transform behavior for common scenarios:
 * - React-only components
 * - NPM packages (react-query, etc.)
 * - MDX pages
 * - Relative imports
 */

import { assertEquals, assertNotEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/testing/deno-compat.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { runPipeline } from "../index.ts";
import {
  CSSTYPE_VERSION,
  DEFAULT_REACT_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";

const FIXTURES_DIR = new URL(".", import.meta.url).pathname;

async function readFixture(name: string, file: string): Promise<string> {
  return await readTextFile(`${FIXTURES_DIR}${name}/${file}`);
}

const TEST_OPTIONS = {
  projectId: "test-project",
  dev: true,
  moduleServerUrl: "http://localhost:3001/_vf_modules",
};

describe("transform pipeline fixtures", () => {
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
      // Pin the fixture's own React import, version included: the auto-injected
      // jsx-runtime import alone would satisfy a bare "esm.sh/react" match, and
      // a browser React version that drifts from SSR breaks hydration.
      assertStringIncludes(
        result.code,
        `import { useState } from "https://esm.sh/react@${DEFAULT_REACT_VERSION}?target=es2022&deps=csstype@${CSSTYPE_VERSION}"`,
        "the browser artifact must import React from the default pinned esm.sh URL",
      );
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
      assertStringIncludes(
        result.code,
        'from "http://localhost:3001/_vf_modules/lib/utils.js"',
        "@/ alias must resolve to the module server URL",
      );
      assertStringIncludes(
        result.code,
        'from "http://localhost:3001/_vf_modules/pages/components/Button"',
        "a sibling relative import must resolve to the module server URL",
      );
      assertStringIncludes(
        result.code,
        'from "http://localhost:3001/_vf_modules/hooks/useAuth"',
        "a parent relative import must resolve to the module server URL",
      );
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

    it("derives the content hash from the source, not the path", async () => {
      const input = await readFixture("react-only", "input.tsx");
      const filePath = "/project/components/Counter.tsx";
      const options = { ...TEST_OPTIONS, ssr: false };

      const first = await runPipeline(input, filePath, "/project", options);
      const second = await runPipeline(
        `${input}\nexport const marker = 1;\n`,
        filePath,
        "/project",
        options,
      );
      const third = await runPipeline(input, filePath, "/project", options);

      assertNotEquals(
        second.contentHash,
        first.contentHash,
        "content hash must change when the source changes",
      );
      assertEquals(
        third.contentHash,
        first.contentHash,
        "content hash must be stable for identical source",
      );
    });
  });
});
