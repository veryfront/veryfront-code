import "#veryfront/schemas/_test-setup.ts";
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
        mode: "production",
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
        mode: "production",
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
    it("includes candidates from component files outside the route module graph", async () => {
      const classes = await extractProjectClassesForRoute(
        {
          projectDir: "/project",
          adapter: {
            fs: {
              getUnderlyingAdapter: () => ({
                getAllSourceFiles: () =>
                  Promise.resolve([
                    {
                      path: "/project/pages/docs.tsx",
                      content: `export default () => <div className="text-sm">Docs</div>;`,
                    },
                    {
                      path: "/project/components/header.tsx",
                      content:
                        `export const Header = () => <header className="h-16 md:pr-8">Nav</header>;`,
                    },
                  ]),
              }),
            },
          } as any,
          config: {} as any,
          mode: "production",
        },
        {
          slug: "docs",
          pageInfo: { entity: { path: "/project/pages/docs.tsx" } },
          nestedLayouts: [],
          options: { projectSlug: "route-scope-regression" },
        } as any,
        undefined,
        {
          getProjectContentVersion: () => "v1",
        },
      );

      assertEquals(classes.has("text-sm"), true);
      // Classes from shared components must be present even when the route
      // module manifest has never observed them (cold pod, first render).
      assertEquals(classes.has("h-16"), true);
      assertEquals(classes.has("md:pr-8"), true);
    });

    it("delegates project metadata and returns the candidate set", async () => {
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
          getProjectCandidates: (input) => {
            calls.push(input as unknown as Record<string, unknown>);
            return new Set(["prose", "docs-page"]);
          },
          createStyleScopeProfile: () => ({ mode: "test" }) as any,
          getProjectContentVersion: () => "version-123",
        },
      );

      assertEquals([...classes], ["prose", "docs-page"]);
      assertEquals(calls.length, 1);
      assertEquals(calls[0]?.projectScope, "demo-project");
      assertEquals(calls[0]?.projectVersion, "version-123");
      assertEquals(calls[0]?.projectDir, "/project");
      assertEquals(calls[0]?.developmentMode, false);
    });
  });
});
