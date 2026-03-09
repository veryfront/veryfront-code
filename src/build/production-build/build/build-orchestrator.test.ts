import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildProduction,
  cleanupCaches,
  cleanupRenderer,
  logBuildCompletion,
} from "./build-orchestrator.ts";

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
});
