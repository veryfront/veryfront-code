import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import {
  clearProjectManifests,
  recordSSRModules,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import {
  getCandidateManifestCacheStats,
  getProjectCandidates,
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

    it("invalidates only the exact project scope", () => {
      invalidateProjectCandidateManifests();
      const projectOptions = {
        projectVersion: "v1",
        projectDir: "/project",
        developmentMode: false,
      };

      getProjectCandidates({
        ...projectOptions,
        projectScope: "tenant",
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="tenant-old">Tenant</div>',
        }],
      });
      getProjectCandidates({
        ...projectOptions,
        projectScope: "tenant:child",
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="child-old">Child</div>',
        }],
      });

      invalidateProjectCandidateManifests("tenant");

      const tenant = getProjectCandidates({
        ...projectOptions,
        projectScope: "tenant",
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="tenant-new">Tenant</div>',
        }],
      });
      const child = getProjectCandidates({
        ...projectOptions,
        projectScope: "tenant:child",
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="child-new">Child</div>',
        }],
      });

      assertEquals(tenant.has("tenant-new"), true);
      assertEquals(child.has("child-old"), true);
      assertEquals(child.has("child-new"), false);
    });

    it("keeps delimiter-containing project identities distinct", () => {
      invalidateProjectCandidateManifests();
      const common = {
        projectDir: "/project",
        developmentMode: false,
      };

      const first = getProjectCandidates({
        ...common,
        projectScope: "tenant:release",
        projectVersion: "v1",
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="first-project">First</div>',
        }],
      });
      const second = getProjectCandidates({
        ...common,
        projectScope: "tenant",
        projectVersion: "release:v1",
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="second-project">Second</div>',
        }],
      });

      assertEquals(first.has("first-project"), true);
      assertEquals(second.has("second-project"), true);
      assertEquals(second.has("first-project"), false);
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

    it("rejects prefix-collision route paths outside the project", () => {
      invalidateProjectCandidateManifests();

      assertThrows(
        () =>
          getRouteCandidates({
            projectScope: "prefix-collision",
            projectVersion: "v1",
            projectDir: "/project",
            routeKey: "index",
            routeFilePaths: [
              "/project/pages/index.tsx",
              "/project2/app.tsx",
            ],
            files: [
              {
                path: "/project/pages/index.tsx",
                content: '<div className="legitimate-route" />',
              },
              {
                path: "/project/2/app.tsx",
                content: '<div className="prefix-alias" />',
              },
            ],
            developmentMode: false,
          }),
        TypeError,
        "within the project",
      );
    });

    it("rejects overlong route file paths before normalization", () => {
      invalidateProjectCandidateManifests();

      assertThrows(
        () =>
          getRouteCandidates({
            projectScope: "overlong-route-path",
            projectVersion: "v1",
            projectDir: "/project",
            routeKey: "index",
            routeFilePaths: [`/project/${"x".repeat(4_096)}.tsx`],
            files: [],
            developmentMode: false,
          }),
        TypeError,
        "4096 characters",
      );
    });

    it("rejects overlong recorded route-module paths before normalization", () => {
      invalidateProjectCandidateManifests();
      const projectScope = "overlong-route-module";
      const routeKey = "index";
      recordSSRModules(projectScope, routeKey, [`${"x".repeat(4_096)}.js`]);

      try {
        assertThrows(
          () =>
            getRouteCandidates({
              projectScope,
              projectVersion: "v1",
              projectDir: "/project",
              routeKey,
              routeFilePaths: [],
              files: [],
              developmentMode: false,
            }),
          TypeError,
          "4096 characters",
        );
      } finally {
        clearProjectManifests(projectScope);
      }
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
    it("rejects a relative project directory before path normalization", () => {
      invalidateProjectCandidateManifests();

      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "relative-project-dir",
            projectVersion: "v1",
            projectDir: "relative/project",
            files: [{
              path: "pages/index.tsx",
              content: '<div className="relative" />',
            }],
            developmentMode: false,
          }),
        TypeError,
        "must be absolute",
      );
    });

    it("does not cache a manifest whose aggregate candidate set exceeds 100,000", () => {
      invalidateProjectCandidateManifests();
      const first = Array.from({ length: 100_000 }, (_, index) => `first-${index}`).join(" ");

      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "project-candidate-overflow",
            projectVersion: "v1",
            projectDir: "/project",
            files: [
              { path: "/project/pages/first.tsx", content: first },
              { path: "/project/pages/second.tsx", content: "one-more-candidate" },
            ],
            developmentMode: false,
          }),
        TypeError,
        "100000 candidates",
      );

      assertEquals(getCandidateManifestCacheStats().manifests.entries, 0);
    });

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

    it("bounds retained manifests across project versions", () => {
      invalidateProjectCandidateManifests();

      for (let index = 0; index < 201; index++) {
        const result = getProjectCandidates({
          projectScope: `project-${index}`,
          projectVersion: `release-${index}`,
          projectDir: "/project",
          files: [{
            path: "/project/pages/index.tsx",
            content: `<div className="project-${index}">Project</div>`,
          }],
          developmentMode: false,
        });
        assertEquals(result.has(`project-${index}`), true);
      }

      const stats = getCandidateManifestCacheStats();
      assertEquals(stats.manifests.entries <= 200, true);
    });
  });
});
