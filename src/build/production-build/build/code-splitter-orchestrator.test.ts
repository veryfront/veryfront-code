import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runCodeSplitting } from "./code-splitter-orchestrator.ts";

describe("build/production-build/build/code-splitter-orchestrator", () => {
  describe("runCodeSplitting", () => {
    it("should return null manifest when splitting is disabled", async () => {
      const result = await runCodeSplitting(
        "/tmp/project",
        "/tmp/output",
        [{ path: "/", file: "index.tsx", slug: "index" }],
        false, // enableSplitting = false
        false,
      );
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });

    it("should return null manifest during dry run", async () => {
      const result = await runCodeSplitting(
        "/tmp/project",
        "/tmp/output",
        [{ path: "/", file: "index.tsx", slug: "index" }],
        true,
        true, // dryRun = true
      );
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });

    it("should return null manifest when routes array is empty", async () => {
      const result = await runCodeSplitting(
        "/tmp/project",
        "/tmp/output",
        [], // empty routes
        true,
        false,
      );
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });

    it("should return null manifest when all three conditions are met", async () => {
      const result = await runCodeSplitting(
        "/tmp/project",
        "/tmp/output",
        [],
        false,
        true,
      );
      assertEquals(result.manifest, null);
      assertEquals(result.chunks, 0);
    });
  });
});
