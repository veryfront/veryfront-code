import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import {
  buildRouteManifestKey,
  extractProjectClassesForRoute,
  getProjectContentVersion,
  startPreparedCSSWarmup,
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

    it("generates project CSS for published production pages", async () => {
      const calls: unknown[][] = [];

      const result = startProjectCSSPreparation(
        {
          slug: "docs",
        } as any,
        {
          environment: "production",
          isLocalProject: false,
          projectSlug: "demo",
          projectId: "proj_1",
          globalCSS: "body{}",
          projectClasses: new Set(["prose"]),
          mode: "production",
        } as any,
        {
          getProjectCSS: ((...args: unknown[]) => {
            calls.push(args);
            return Promise.resolve({ hash: "abc123" });
          }) as any,
        },
      );

      assertNotEquals(
        result,
        undefined,
        "a published production page must start project CSS generation",
      );
      assertEquals(
        await result,
        { hash: "abc123" } as any,
        "the generated project CSS is handed back to the caller",
      );
      assertEquals(calls.length, 1, "project CSS is generated exactly once per render");
      assertEquals(
        calls[0]?.[0],
        "demo",
        "projectSlug wins over projectId and context.slug",
      );
      assertEquals(calls[0]?.[1], "body{}", "the project global CSS is forwarded verbatim");
      assertEquals(
        [...(calls[0]?.[2] as Set<string>)],
        ["prose"],
        "the collected project classes are forwarded",
      );
      assertEquals(
        calls[0]?.[3],
        { minify: true, environment: "production", buildMode: "production" },
        "published CSS is minified and built for the request environment",
      );
    });

    it("skips generation when the project scope is the shared default", () => {
      let called = false;

      const result = startProjectCSSPreparation(
        {
          slug: "docs",
        } as any,
        {
          environment: "production",
          isLocalProject: false,
          projectSlug: "default",
          globalCSS: "body{}",
          mode: "production",
        } as any,
        {
          getProjectCSS: (() => {
            called = true;
            return Promise.resolve({ hash: "abc123" });
          }) as any,
        },
      );

      assertEquals(result, undefined, "the shared default scope must not be generated for");
      assertEquals(called, false, "no CSS build runs for the shared default scope");
    });
  });

  describe("startPreparedCSSWarmup", () => {
    function makeConfig(mode: "development" | "production") {
      return {
        projectDir: "/project",
        adapter: {
          fs: {
            getUnderlyingAdapter: () => ({
              getAllSourceFiles: () => [
                {
                  path: "/project/app/page.tsx",
                  content: `<div className="text-red-500" />`,
                },
              ],
            }),
          },
        } as any,
        config: {} as any,
        mode,
      };
    }

    it("warms the preview stylesheet for a preview render", async () => {
      const calls: Array<Record<string, unknown>> = [];

      startPreparedCSSWarmup(
        makeConfig("production"),
        { slug: "docs" } as any,
        { environment: "preview", projectSlug: "p" } as any,
        {
          warmPreparedCSSArtifactFromFiles: ((input: Record<string, unknown>) => {
            calls.push(input);
            return Promise.resolve(undefined);
          }) as any,
          getProjectContentVersion: () => "content-v1",
          createStyleScopeProfile: (() => ({ mode: "test" })) as any,
        },
      );

      await waitFor(() => calls.length === 1, {
        interval: 5,
        message: "a preview render must warm the prepared CSS artifact",
      });
      assertEquals(calls[0]?.projectSlug, "p", "the warmup is scoped to the project slug");
      assertEquals(
        calls[0]?.projectVersion,
        "content-v1",
        "the warmup keys on the resolved project content version",
      );
      assertEquals(calls[0]?.environment, "preview", "the warmed artifact is the preview one");
      assertEquals(calls[0]?.buildMode, "production", "preview artifacts are built for production");
    });

    it("does not warm the preview stylesheet for a published production render", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const deps = {
        warmPreparedCSSArtifactFromFiles: ((input: Record<string, unknown>) => {
          calls.push(input);
          return Promise.resolve(undefined);
        }) as any,
        getProjectContentVersion: () => "content-v1",
        createStyleScopeProfile: (() => ({ mode: "test" })) as any,
      };

      startPreparedCSSWarmup(
        makeConfig("production"),
        { slug: "docs" } as any,
        { environment: "production", isLocalProject: false, projectSlug: "p" } as any,
        deps,
      );

      // A preview warmup started afterwards is the time barrier: once it has
      // landed, any warmup the published render would have started has had
      // its chance to land too.
      startPreparedCSSWarmup(
        makeConfig("production"),
        { slug: "docs" } as any,
        { environment: "preview", projectSlug: "control" } as any,
        deps,
      );

      await waitFor(() => calls.some((call) => call.projectSlug === "control"), {
        interval: 5,
        message: "the control preview warmup must land",
      });
      assertEquals(
        calls.filter((call) => call.projectSlug === "p").length,
        0,
        "a published production render must not warm the preview stylesheet",
      );
    });

    it("falls back to the dev version marker when no content version is known", async () => {
      const calls: Array<Record<string, unknown>> = [];

      startPreparedCSSWarmup(
        makeConfig("development"),
        { slug: "docs" } as any,
        { environment: "preview", projectSlug: "p" } as any,
        {
          warmPreparedCSSArtifactFromFiles: ((input: Record<string, unknown>) => {
            calls.push(input);
            return Promise.resolve(undefined);
          }) as any,
          getProjectContentVersion: () => undefined,
          createStyleScopeProfile: (() => ({ mode: "test" })) as any,
        },
      );

      await waitFor(() => calls.length === 1, {
        interval: 5,
        message: "a preview render must warm the prepared CSS artifact",
      });
      assertEquals(
        calls[0]?.projectVersion,
        "dev",
        "an unknown content version must never key the artifact cache as undefined",
      );
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
