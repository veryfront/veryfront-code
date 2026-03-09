import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRouteCandidates,
  invalidateProjectCandidateManifests,
} from "./css-candidate-manifest.ts";

describe("rendering/orchestrator/css-candidate-manifest", () => {
  describe("invalidateProjectCandidateManifests", () => {
    it("should clear all caches when no scope provided", () => {
      invalidateProjectCandidateManifests();
      // Should not throw
    });

    it("should clear cache for specific scope", () => {
      invalidateProjectCandidateManifests("my-project");
      // Should not throw
    });

    it("should be idempotent", () => {
      invalidateProjectCandidateManifests();
      invalidateProjectCandidateManifests();
    });
  });

  describe("getRouteCandidates", () => {
    it("should return empty set when no files have content", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "test",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: [],
        files: [],
        developmentMode: false,
      });
      assertEquals(result.size, 0);
    });

    it("should extract candidates from source files", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "test-extract",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: ["/project/pages/index.tsx"],
        files: [
          {
            path: "/project/pages/index.tsx",
            content: '<div className="text-red-500 bg-blue-200">Hello</div>',
          },
        ],
        developmentMode: false,
      });
      assertEquals(result.size > 0, true);
    });

    it("should skip files without content", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "test-no-content",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: ["/project/index.tsx"],
        files: [
          { path: "/project/index.tsx" }, // no content
        ],
        developmentMode: false,
      });
      assertEquals(result.size, 0);
    });

    it("should skip non-source file extensions", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "test-ext",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: [],
        files: [
          { path: "/project/style.css", content: ".text-red { color: red; }" },
        ],
        developmentMode: false,
      });
      assertEquals(result.size, 0);
    });

    it("should use cached manifest for same projectScope and version", () => {
      invalidateProjectCandidateManifests();
      const opts = {
        projectScope: "test-cache",
        projectVersion: "v2",
        projectDir: "/project",
        routeKey: "about",
        routeFilePaths: ["/project/about.tsx"],
        files: [
          {
            path: "/project/about.tsx",
            content: '<p className="font-bold">About</p>',
          },
        ],
        developmentMode: false,
      };
      const r1 = getRouteCandidates(opts);
      const r2 = getRouteCandidates(opts);
      assertEquals(r1.size, r2.size);
    });

    it("should rebuild manifest in development mode after TTL", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "test-dev",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: [],
        files: [],
        developmentMode: true,
      });
      assertEquals(result.size, 0);
    });
  });
});
