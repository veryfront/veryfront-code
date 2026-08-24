import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runCodeSplitting } from "./code-splitter-orchestrator.ts";

// The end-to-end "splits routes into the chunk output tree" case lives in
// tests/integration/semantic-unit-boundary/src/build/production-build/build/code-splitter-orchestrator.test.ts:
// runCodeSplitting has no splitter seam, so exercising it means running real
// esbuild over an on-disk project tree.

describe("build/production-build/build/code-splitter-orchestrator", () => {
  describe("runCodeSplitting", () => {
    it("should return null manifest and 0 chunks when splitting is disabled", async () => {
      const result = await runCodeSplitting("/project", "/output", [], false, false);
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });

    it("should return null manifest and 0 chunks on dryRun", async () => {
      const routes = [
        { path: "/", file: "/project/src/index.tsx", slug: "index", component: "Index" },
      ];
      // deno-lint-ignore no-explicit-any
      const result = await runCodeSplitting("/project", "/output", routes as any, true, true);
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });

    it("should return null manifest and 0 chunks when routes are empty", async () => {
      const result = await runCodeSplitting("/project", "/output", [], true, false);
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });

    it("should skip when both splitting disabled and dryRun", async () => {
      const result = await runCodeSplitting("/project", "/output", [], false, true);
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });
  });
});
