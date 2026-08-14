import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  getCandidateManifestCacheStats,
  getProjectCandidates,
  getRouteCandidates,
  invalidateProjectCandidateManifests,
} from "./css-candidate-manifest.ts";

function captureLogs(): { entries: LogEntry[]; restore: () => void } {
  const entries: LogEntry[] = [];
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return {
    entries,
    restore: () => {
      __resetLogRecordEmitterForTests();
    },
  };
}

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

    it("bounds cached route candidate sets for high-cardinality production routes", () => {
      invalidateProjectCandidateManifests();
      const files = Array.from({ length: 260 }, (_, index) => ({
        path: `/project/pages/blog/articles/post-${index}.tsx`,
        content: `<div className="route-${index} text-red-500">Post</div>`,
      }));

      for (let index = 0; index < 260; index++) {
        const result = getRouteCandidates({
          projectScope: "test-route-bound",
          projectVersion: "v1",
          projectDir: "/project",
          routeKey: `blog/articles/post-${index}`,
          routeFilePaths: [`/project/pages/blog/articles/post-${index}.tsx`],
          files,
          developmentMode: false,
        });

        assertEquals(result.has(`route-${index}`), true);
      }

      const stats = getCandidateManifestCacheStats();
      assertEquals(stats.routeCandidates.entries, stats.routeCandidates.maxEntries);
    });

    it("does not retain duplicate full-project fallback candidates per route", () => {
      invalidateProjectCandidateManifests();

      for (let index = 0; index < 20; index++) {
        const result = getRouteCandidates({
          projectScope: "test-fallback-bound",
          projectVersion: "v1",
          projectDir: "/project",
          routeKey: `unmapped-route-${index}`,
          routeFilePaths: [`/project/routes/unmapped-${index}.tsx`],
          files: [
            {
              path: "/project/pages/index.tsx",
              content: '<div className="text-red-500 bg-blue-500">Home</div>',
            },
          ],
          developmentMode: false,
        });

        assertEquals(result.has("text-red-500"), true);
      }

      const stats = getCandidateManifestCacheStats();
      assertEquals(stats.routeCandidates.entries, 0);
    });
  });

  describe("getProjectCandidates", () => {
    it("should return all extracted candidates for a project manifest", () => {
      invalidateProjectCandidateManifests();
      const result = getProjectCandidates({
        projectScope: "project-all",
        projectVersion: "v1",
        projectDir: "/project",
        files: [
          {
            path: "/project/pages/index.tsx",
            content: '<div className="text-red-500">Home</div>',
          },
          {
            path: "/project/components/Card.tsx",
            content: '<div className="rounded-lg shadow-sm">Card</div>',
          },
        ],
        developmentMode: false,
      });

      assertEquals(result.has("text-red-500"), true);
      assertEquals(result.has("rounded-lg"), true);
      assertEquals(result.has("shadow-sm"), true);
    });

    it("applies the default style scope conventions when building manifests", () => {
      invalidateProjectCandidateManifests();
      const result = getProjectCandidates({
        projectScope: "project-scope-defaults",
        projectVersion: "v1",
        projectDir: "/project",
        styleProfile: createStyleScopeProfile(),
        files: [
          {
            path: "/project/pages/index.tsx",
            content: '<div className="text-red-500">Home</div>',
          },
          {
            path: "/project/knowledge/reference.tsx",
            content: '<div className="text-blue-500">Reference</div>',
          },
        ],
        developmentMode: false,
      });

      assertEquals(result.has("text-red-500"), true);
      assertEquals(result.has("text-blue-500"), false);
    });

    it("degrades a file that exceeds the candidate-count admission cap instead of throwing", () => {
      invalidateProjectCandidateManifests();
      // >MAX_CSS_SELECTOR_TOKENS (100_000) distinct candidates in one file —
      // the shape of a large minified vendor bundle in project sources.
      const poisonContent = Array.from({ length: 100_001 }, (_, i) => `tok-${i}`).join(" ");
      const options = {
        projectScope: "project-poison-count",
        projectVersion: "v1",
        projectDir: "/project",
        files: [
          { path: "/project/vendor/minified.js", content: poisonContent },
          {
            path: "/project/pages/index.tsx",
            content: '<div className="text-red-500">Home</div>',
          },
        ],
        developmentMode: false,
      };

      const result = getProjectCandidates(options);

      assertEquals(result.has("text-red-500"), true);
      assertEquals(result.has("tok-0"), false);

      // The completed manifest must be cached so the pathological file is not
      // re-scanned (and cannot re-fail) on every request.
      const statsAfterFirst = getCandidateManifestCacheStats();
      assertEquals(statsAfterFirst.manifests.entries, 1);
      const second = getProjectCandidates(options);
      assertEquals(second.has("text-red-500"), true);
    });

    it("logs rejected source files without exposing absolute project paths", () => {
      invalidateProjectCandidateManifests();
      const captured = captureLogs();
      try {
        const projectDir = "/Users/someone/private/path/my-project";
        const absoluteSourcePath = `${projectDir}/vendor/minified.js`;
        const poisonContent = Array.from({ length: 100_001 }, (_, i) => `tok-${i}`).join(" ");

        getProjectCandidates({
          projectScope: "project-poison-log-redaction",
          projectVersion: "v1",
          projectDir,
          files: [
            { path: absoluteSourcePath, content: poisonContent },
          ],
          developmentMode: false,
        });

        const warning = captured.entries.find((entry) =>
          entry.message === "Skipping file rejected by candidate extraction"
        );
        assertEquals(warning !== undefined, true, "the warning must be emitted");
        assertEquals(warning!.context?.path, "vendor/minified.js");
        assertEquals(JSON.stringify(warning!.context).includes(projectDir), false);
        assertEquals(JSON.stringify(warning!.context).includes(absoluteSourcePath), false);
      } finally {
        captured.restore();
      }
    });

    it("degrades a file that exceeds the byte-size admission cap instead of throwing", () => {
      invalidateProjectCandidateManifests();
      // >MAX_CSS_FILE_BYTES (16MB) — e.g. a giant generated asset in sources.
      const oversized = "x".repeat(16 * 1024 * 1024 + 1);
      const result = getProjectCandidates({
        projectScope: "project-poison-bytes",
        projectVersion: "v1",
        projectDir: "/project",
        files: [
          { path: "/project/generated/blob.js", content: oversized },
          {
            path: "/project/pages/index.tsx",
            content: '<div className="text-red-500">Home</div>',
          },
        ],
        developmentMode: false,
      });

      assertEquals(result.has("text-red-500"), true);
    });

    it("keeps configured runtime roots in the candidate graph", () => {
      invalidateProjectCandidateManifests();
      const result = getProjectCandidates({
        projectScope: "project-scope-protected",
        projectVersion: "v1",
        projectDir: "/project",
        styleProfile: createStyleScopeProfile({
          directories: {
            app: "knowledge/app",
          },
        }),
        files: [
          {
            path: "/project/knowledge/app/page.tsx",
            content: '<div className="text-emerald-500">Hello</div>',
          },
        ],
        developmentMode: false,
      });

      assertEquals(result.has("text-emerald-500"), true);
    });
  });
});
