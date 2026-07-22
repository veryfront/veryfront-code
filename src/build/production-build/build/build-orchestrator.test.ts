import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertBuildProducedOutput,
  buildProduction,
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
} from "./build-orchestrator.ts";
import type { BuildStats } from "#veryfront/server/build-types.ts";
import type { CollectedRoutes } from "./route-collector.ts";

describe("build/production-build/build/build-orchestrator", () => {
  describe("re-exports", () => {
    it("should export cleanupCaches function", () => {
      assertEquals(typeof cleanupCaches, "function");
    });

    it("should export cleanupRenderer function", () => {
      assertEquals(typeof cleanupRenderer, "function");
    });

    it("should export logBuildCompletion function", () => {
      assertEquals(typeof logBuildCompletion, "function");
    });
  });

  describe("buildProduction", () => {
    it("should reject when project directory does not exist", async () => {
      await assertRejects(
        () =>
          buildProduction({
            projectDir: "/tmp/nonexistent-project-" + Date.now(),
          }),
      );
    });

    it("should be a function", () => {
      assertEquals(typeof buildProduction, "function");
    });
  });

  describe("assertBuildProducedOutput", () => {
    const emptyStats: BuildStats = {
      pages: 0,
      components: 0,
      chunks: 0,
      assets: 0,
      totalSize: 0,
      duration: 0,
    };
    const noRoutes: CollectedRoutes = { pages: [], app: [] };
    const someRoutes: CollectedRoutes = {
      pages: [{ path: "/", file: "pages/index.tsx", slug: "index" }],
      app: [],
    };

    it("throws when SSG is disabled and nothing was built", () => {
      let error: Error | undefined;
      try {
        assertBuildProducedOutput(emptyStats, noRoutes, false, false);
      } catch (e) {
        error = e as Error;
      }
      assertEquals(error !== undefined, true);
      assertEquals(
        error?.message.includes("static site generation is disabled"),
        true,
      );
    });

    it("throws when SSG is enabled but no routes were found", () => {
      let error: Error | undefined;
      try {
        assertBuildProducedOutput(emptyStats, noRoutes, true, false);
      } catch (e) {
        error = e as Error;
      }
      assertEquals(error?.message.includes("no routes were found"), true);
    });

    it("throws when routes were collected but no pages were generated", () => {
      let error: Error | undefined;
      try {
        assertBuildProducedOutput(emptyStats, someRoutes, true, false);
      } catch (e) {
        error = e as Error;
      }
      assertEquals(error?.message.includes("1 route(s) were collected"), true);
    });

    it("does not throw for dry runs", () => {
      assertBuildProducedOutput(emptyStats, noRoutes, false, true);
    });

    it("does not throw when pages were built", () => {
      assertBuildProducedOutput(
        { ...emptyStats, pages: 2 },
        someRoutes,
        true,
        false,
      );
    });

    it("does not throw when chunks were built", () => {
      assertBuildProducedOutput(
        { ...emptyStats, chunks: 3 },
        someRoutes,
        true,
        false,
      );
    });
  });
});
