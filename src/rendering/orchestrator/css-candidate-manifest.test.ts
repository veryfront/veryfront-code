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

function buildLargeCandidateSource(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const identity = `${prefix}-${index}-`;
    return identity + "x".repeat(900 - identity.length);
  }).join(" ");
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

    it("rejects overlong manifest identities before cache-key stringification", () => {
      invalidateProjectCandidateManifests();
      const nativeStringify = JSON.stringify;
      let stringifyCalls = 0;
      JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
        stringifyCalls++;
        return nativeStringify(...args);
      }) as typeof JSON.stringify;

      try {
        assertThrows(
          () =>
            getProjectCandidates({
              projectScope: "x".repeat(4_097),
              projectVersion: "v1",
              projectDir: "/project",
              files: [],
              developmentMode: false,
            }),
          TypeError,
          "4096 characters",
        );
        assertEquals(stringifyCalls, 0);
      } finally {
        JSON.stringify = nativeStringify;
      }
    });
  });

  describe("getRouteCandidates", () => {
    it("rejects an overlong route identity before inspecting manifest files", () => {
      let fileAccessorCalls = 0;
      const files = [{ path: "/project/pages/index.tsx", content: "ignored" }];
      Object.defineProperty(files, "0", {
        enumerable: true,
        get() {
          fileAccessorCalls++;
          return { path: "/project/pages/index.tsx", content: "ignored" };
        },
      });

      assertThrows(
        () =>
          getRouteCandidates({
            projectScope: "overlong-route-identity",
            projectVersion: "v1",
            projectDir: "/project",
            routeKey: "x".repeat(4_097),
            routeFilePaths: [],
            files,
            developmentMode: false,
          }),
        TypeError,
        "4096 characters",
      );
      assertEquals(fileAccessorCalls, 0);
    });

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

    it("skips a route candidate set above its retained-byte admission limit", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "oversized-route-candidates",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: ["/project/pages/index.tsx"],
        files: [{
          path: "/project/pages/index.tsx",
          content: buildLargeCandidateSource("route-byte", 2_500),
        }],
        developmentMode: false,
      });

      assertEquals(result.size, 2_500);
      assertEquals(getCandidateManifestCacheStats().routeCandidates.entries, 0);
    });

    it("keeps a mapped source with zero candidates empty instead of falling back", () => {
      invalidateProjectCandidateManifests();
      const options = {
        projectScope: "mapped-empty-route",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "empty",
        routeFilePaths: ["/project/pages/empty.tsx"],
        files: [
          { path: "/project/pages/empty.tsx", content: "" },
          {
            path: "/project/pages/other.tsx",
            content: '<div className="unrelated-project-candidate" />',
          },
        ],
        developmentMode: false,
      };

      assertEquals(getRouteCandidates(options).size, 0);
      assertEquals(getRouteCandidates(options).size, 0);
    });

    it("falls back only when no admitted route source is mapped", () => {
      invalidateProjectCandidateManifests();
      const result = getRouteCandidates({
        projectScope: "truly-unmapped-route",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "missing",
        routeFilePaths: ["/project/pages/missing.tsx"],
        files: [{
          path: "/project/pages/other.tsx",
          content: '<div className="project-fallback-candidate" />',
        }],
        developmentMode: false,
      });

      assertEquals(result.has("project-fallback-candidate"), true);
    });

    it("rejects proxied and accessor-backed route path arrays without invoking hooks", () => {
      invalidateProjectCandidateManifests();
      let proxyTraps = 0;
      const proxiedPaths = new Proxy(["/project/pages/index.tsx"], {
        get() {
          proxyTraps++;
          throw new Error("must not run");
        },
        ownKeys() {
          proxyTraps++;
          throw new Error("must not run");
        },
      });
      assertThrows(
        () =>
          getRouteCandidates({
            projectScope: "proxied-route-paths",
            projectVersion: "v1",
            projectDir: "/project",
            routeKey: "index",
            routeFilePaths: proxiedPaths,
            files: [],
            developmentMode: false,
          }),
        TypeError,
        "must not be a Proxy",
      );
      assertEquals(proxyTraps, 0);

      let getterCalls = 0;
      const accessorPaths = ["/project/pages/index.tsx"];
      Object.defineProperty(accessorPaths, "0", {
        enumerable: true,
        get() {
          getterCalls++;
          return "/project/pages/unsafe.tsx";
        },
      });
      assertThrows(
        () =>
          getRouteCandidates({
            projectScope: "accessor-route-paths",
            projectVersion: "v1",
            projectDir: "/project",
            routeKey: "index",
            routeFilePaths: accessorPaths,
            files: [],
            developmentMode: false,
          }),
        TypeError,
        "dense data-property array",
      );
      assertEquals(getterCalls, 0);

      assertThrows(
        () =>
          getRouteCandidates({
            projectScope: "sparse-route-paths",
            projectVersion: "v1",
            projectDir: "/project",
            routeKey: "index",
            routeFilePaths: new Array(1),
            files: [],
            developmentMode: false,
          }),
        TypeError,
        "dense data-property array",
      );
    });
  });

  describe("getProjectCandidates", () => {
    it("rejects absolute and relative aliases of the same canonical source path", () => {
      invalidateProjectCandidateManifests();

      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "duplicate-canonical-path",
            projectVersion: "v1",
            projectDir: "/project",
            files: [
              {
                path: "pages/index.tsx",
                content: '<div className="first-candidate" />',
              },
              {
                path: "/project/pages/index.tsx",
                content: '<div className="second-candidate" />',
              },
            ],
            developmentMode: false,
          }),
        TypeError,
        "duplicate canonical path",
      );
    });

    it("rejects proxied source collections and entries without invoking traps", () => {
      invalidateProjectCandidateManifests();
      let collectionTraps = 0;
      const proxiedFiles = new Proxy([], {
        get() {
          collectionTraps++;
          throw new Error("must not run");
        },
        ownKeys() {
          collectionTraps++;
          throw new Error("must not run");
        },
      });
      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "proxied-files",
            projectVersion: "v1",
            projectDir: "/project",
            files: proxiedFiles,
            developmentMode: false,
          }),
        TypeError,
        "must not be a Proxy",
      );
      assertEquals(collectionTraps, 0);

      let entryTraps = 0;
      const proxiedEntry = new Proxy({
        path: "/project/pages/index.tsx",
        content: "export default null;",
      }, {
        get() {
          entryTraps++;
          throw new Error("must not run");
        },
        ownKeys() {
          entryTraps++;
          throw new Error("must not run");
        },
      });
      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "proxied-entry",
            projectVersion: "v1",
            projectDir: "/project",
            files: [proxiedEntry],
            developmentMode: false,
          }),
        TypeError,
        "must not be a Proxy",
      );
      assertEquals(entryTraps, 0);
    });

    it("rejects sparse and accessor-backed source collections without invoking accessors", () => {
      invalidateProjectCandidateManifests();
      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "sparse-files",
            projectVersion: "v1",
            projectDir: "/project",
            files: new Array(1),
            developmentMode: false,
          }),
        TypeError,
        "dense data-property array",
      );

      let getterCalls = 0;
      const entry = {} as { path: string; content?: string };
      Object.defineProperty(entry, "path", {
        enumerable: true,
        get() {
          getterCalls++;
          return "/project/pages/index.tsx";
        },
      });
      assertThrows(
        () =>
          getProjectCandidates({
            projectScope: "accessor-entry",
            projectVersion: "v1",
            projectDir: "/project",
            files: [entry],
            developmentMode: false,
          }),
        TypeError,
        "data properties",
      );
      assertEquals(getterCalls, 0);
    });

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

    it("accounts detached candidates independently of a large parent source", () => {
      invalidateProjectCandidateManifests();
      const options = {
        projectScope: "detached-parent-candidates",
        projectVersion: "v1",
        projectDir: "/project",
        files: [{
          path: "/project/pages/index.tsx",
          content: `${" ".repeat(4 * 1024 * 1024)}<div className="detached-parent-token" />`,
        }],
        developmentMode: false,
      };
      const first = getProjectCandidates(options);
      const retainedBytes = getCandidateManifestCacheStats().manifests.estimatedSizeBytes;
      options.files[0]!.content = "";
      first.clear();
      first.add("caller-mutated-token");

      assertEquals(getProjectCandidates(options).has("detached-parent-token"), true);
      assertEquals(getProjectCandidates(options).has("caller-mutated-token"), false);
      assertEquals(retainedBytes < 1024 * 1024, true);
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

    it("evicts the least-recently-used manifest under retained-byte pressure", () => {
      invalidateProjectCandidateManifests();
      const sourceA = buildLargeCandidateSource("manifest-a", 7_500);
      const sourceB = buildLargeCandidateSource("manifest-b", 7_500);
      const sourceC = buildLargeCandidateSource("manifest-c", 7_500);
      const options = (projectScope: string, content: string) => ({
        projectScope,
        projectVersion: "v1",
        projectDir: "/project",
        files: [{ path: "/project/pages/index.tsx", content }],
        developmentMode: false,
      });

      getProjectCandidates(options("manifest-byte-a", sourceA));
      getProjectCandidates(options("manifest-byte-b", sourceB));
      assertEquals(
        getProjectCandidates(options("manifest-byte-a", "manifest-a-replacement")).has(
          "manifest-a-0-" + "x".repeat(887),
        ),
        true,
      );
      getProjectCandidates(options("manifest-byte-c", sourceC));

      assertEquals(getCandidateManifestCacheStats().manifests.entries, 2);
      assertEquals(
        getProjectCandidates(options("manifest-byte-a", "manifest-a-replacement")).has(
          "manifest-a-0-" + "x".repeat(887),
        ),
        true,
      );
      assertEquals(
        getProjectCandidates(options("manifest-byte-b", "manifest-b-replacement")).has(
          "manifest-b-replacement",
        ),
        true,
      );
    });

    it("does not retain one manifest above its retained-byte admission limit", () => {
      invalidateProjectCandidateManifests();
      const options = (content: string) => ({
        projectScope: "manifest-single-byte-limit",
        projectVersion: "v1",
        projectDir: "/project",
        files: [{ path: "/project/pages/index.tsx", content }],
        developmentMode: false,
      });

      assertEquals(
        getProjectCandidates(options(buildLargeCandidateSource("manifest-single", 9_500))).size,
        9_500,
      );
      assertEquals(getCandidateManifestCacheStats().manifests.entries, 0);
      assertEquals(
        getProjectCandidates(options("manifest-single-replacement")).has(
          "manifest-single-replacement",
        ),
        true,
      );
    });

    it("returns an uncacheable manifest result without a cache-owned Set clone", () => {
      invalidateProjectCandidateManifests();
      const NativeSet = globalThis.Set;
      let setConstructions = 0;
      class RecordingSet<T> extends NativeSet<T> {
        constructor(values?: readonly T[] | null) {
          super(values);
          setConstructions++;
        }
      }
      Object.defineProperty(globalThis, "Set", {
        configurable: true,
        value: RecordingSet,
        writable: true,
      });

      let resultSize = 0;
      let cacheEntries = -1;
      try {
        resultSize = getProjectCandidates({
          projectScope: "manifest-copy-admission",
          projectVersion: "v1",
          projectDir: "/project",
          files: [{
            path: "/project/pages/index.tsx",
            content: buildLargeCandidateSource("manifest-copy", 9_500),
          }],
          developmentMode: false,
        }).size;
        cacheEntries = getCandidateManifestCacheStats().manifests.entries;
      } finally {
        Object.defineProperty(globalThis, "Set", {
          configurable: true,
          value: NativeSet,
          writable: true,
        });
      }

      assertEquals(resultSize, 9_500);
      assertEquals(cacheEntries, 0);
      // Source snapshot, aggregate result, tokenizer uniqueness, and per-file view.
      assertEquals(setConstructions, 4);
    });

    it("reports retained bytes and byte ceilings for both candidate caches", () => {
      invalidateProjectCandidateManifests();
      getRouteCandidates({
        projectScope: "candidate-byte-stats",
        projectVersion: "v1",
        projectDir: "/project",
        routeKey: "index",
        routeFilePaths: ["/project/pages/index.tsx"],
        files: [{
          path: "/project/pages/index.tsx",
          content: '<div className="candidate-byte-stats" />',
        }],
        developmentMode: false,
      });
      const stats = getCandidateManifestCacheStats() as {
        manifests: { estimatedSizeBytes?: number; maxSizeBytes?: number };
        routeCandidates: { estimatedSizeBytes?: number; maxSizeBytes?: number };
      };

      assertEquals(typeof stats.manifests.estimatedSizeBytes, "number");
      assertEquals(typeof stats.manifests.maxSizeBytes, "number");
      assertEquals((stats.manifests.estimatedSizeBytes ?? 0) > 0, true);
      assertEquals(typeof stats.routeCandidates.estimatedSizeBytes, "number");
      assertEquals(typeof stats.routeCandidates.maxSizeBytes, "number");
      assertEquals((stats.routeCandidates.estimatedSizeBytes ?? 0) > 0, true);
    });
  });
});
