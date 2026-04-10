import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRouteManifestKey,
  extractProjectClassesForRoute,
  getProjectContentVersion,
  startProjectCSSPreparation,
} from "./html-project-css.ts";

describe("rendering/orchestrator/html-project-css", () => {
  describe("buildRouteManifestKey", () => {
    it("strips the project root, extension, and pages prefix", () => {
      assertEquals(
        buildRouteManifestKey("/project/pages/docs/getting-started.tsx", "/project"),
        "docs/getting-started",
      );
    });

    it("preserves app-router paths outside pages/", () => {
      assertEquals(
        buildRouteManifestKey("/project/app/blog/page.tsx", "/project"),
        "app/blog/page",
      );
    });
  });

  describe("getProjectContentVersion", () => {
    it("prefers the adapter content context version", () => {
      const version = getProjectContentVersion({
        adapter: {
          fs: {
            getUnderlyingAdapter: () => ({
              getContentContext: () => ({
                sourceType: "branch",
                projectSlug: "demo",
                branch: "feature/refactor",
              }),
              getProjectData: () => ({ updated_at: "2025-01-01T00:00:00Z" }),
            }),
          },
        } as any,
      });

      assertEquals(version, "branch:feature/refactor");
    });

    it("falls back to project updated_at when no content context is available", () => {
      const version = getProjectContentVersion({
        adapter: {
          fs: {
            getUnderlyingAdapter: () => ({
              getProjectData: () => ({ updated_at: "2025-01-01T00:00:00Z" }),
            }),
          },
        } as any,
      });

      assertEquals(version, "2025-01-01T00:00:00Z");
    });
  });

  describe("startProjectCSSPreparation", () => {
    it("skips project CSS generation outside production published contexts", () => {
      let called = false;

      const result = startProjectCSSPreparation(
        {
          slug: "docs",
        } as any,
        {
          environment: "preview",
          isLocalProject: false,
          projectSlug: "demo",
          globalCSS: "body{}",
          projectClasses: new Set(["prose"]),
          mode: "production",
        } as any,
        {
          getProjectCSS: () => {
            called = true;
            return Promise.resolve({ hash: "abc123" } as any);
          },
        },
      );

      assertEquals(result, undefined);
      assertEquals(called, false);
    });
  });

  describe("extractProjectClassesForRoute", () => {
    it("delegates route metadata and returns the candidate set", async () => {
      const calls: Array<Record<string, unknown>> = [];

      const classes = await extractProjectClassesForRoute(
        {
          projectDir: "/project",
          adapter: {
            fs: {
              getUnderlyingAdapter: () => ({
                getAllSourceFiles: () => Promise.resolve([{ path: "/project/pages/docs.tsx" }]),
              }),
            },
          } as any,
          config: {} as any,
          mode: "production",
        },
        {
          slug: "docs",
          pageInfo: { entity: { path: "/project/pages/docs.tsx" } },
          nestedLayouts: [{
            path: "/project/layouts/docs.tsx",
            componentPath: "/project/layouts/docs.tsx",
          }],
          options: { projectSlug: "demo-project" },
        } as any,
        "/project/app.tsx",
        {
          getRouteCandidates: (input) => {
            calls.push(input as Record<string, unknown>);
            return new Set(["prose", "docs-page"]);
          },
          createStyleScopeProfile: () => ({ mode: "test" }) as any,
          getProjectContentVersion: () => "version-123",
        },
      );

      assertEquals([...classes], ["prose", "docs-page"]);
      assertEquals(calls.length, 1);
      assertEquals(calls[0]?.routeKey, "docs");
      assertEquals(calls[0]?.projectScope, "demo-project");
      assertEquals(calls[0]?.projectVersion, "version-123");
      assertEquals(
        calls[0]?.routeFilePaths,
        ["/project/pages/docs.tsx", "/project/layouts/docs.tsx", "/project/app.tsx"],
      );
    });
  });
});
