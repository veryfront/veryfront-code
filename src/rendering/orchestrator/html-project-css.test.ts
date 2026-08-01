import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRouteManifestKey,
  extractProjectClassesForRoute,
  getProjectContentVersion,
  startPreparedCSSWarmup,
  startProjectCSSPreparation,
} from "./html-project-css.ts";
import { CSS_GENERATION_SESSION } from "./css-generation-session.ts";
import { acquireCSSGenerationSession } from "#veryfront/html/styles-builder/css-compiler.ts";
import { type CSSProcessor, CSSProcessorName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../tests/_helpers/css-optimization-engine.ts";
import {
  createProjectStyleSourceSnapshot,
  snapshotResolvedStyleContentContext,
} from "#veryfront/html/styles-builder/project-style-source-snapshot.ts";

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
      const version = getProjectContentVersion(
        createProjectStyleSourceSnapshot(
          "provider",
          snapshotResolvedStyleContentContext({
            sourceType: "branch",
            projectSlug: "demo",
            branch: "feature/refactor",
          }),
          null,
          "2025-01-01T00:00:00Z",
        ),
      );

      assertEquals(version, "branch:feature/refactor");
    });

    it("falls back to project updated_at when no content context is available", () => {
      const version = getProjectContentVersion(
        createProjectStyleSourceSnapshot(
          "provider",
          null,
          null,
          "2025-01-01T00:00:00Z",
        ),
      );

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

    it("passes the render-captured CSS session through project generation", async () => {
      const previousProcessor = tryResolve<CSSProcessor>(CSSProcessorName);
      unregister(CSSProcessorName);
      register(CSSProcessorName, {
        cacheIdentity: "test-render-css-processor@1",
        defaultStylesheet: "",
        compile: () => Promise.resolve({ build: () => "" }),
      });
      try {
        await withTestCSSOptimizationEngine(
          createTestCSSOptimizationEngine(),
          async () => {
            const generationSession = await acquireCSSGenerationSession(true);
            let receivedSession: unknown;
            const result = startProjectCSSPreparation(
              {
                slug: "docs",
                options: { [CSS_GENERATION_SESSION]: generationSession },
              } as any,
              {
                environment: "production",
                isLocalProject: false,
                projectSlug: "demo",
                globalCSS: "body{}",
                projectClasses: new Set(["prose"]),
                mode: "production",
              } as any,
              {
                getProjectCSS: (
                  _scope,
                  _stylesheet,
                  _candidates,
                  _options,
                  dependencies,
                ) => {
                  receivedSession = dependencies?.generationSession;
                  return Promise.resolve({ css: "", hash: "abc123", fromCache: false });
                },
              },
            );

            await result;
            assertStrictEquals(receivedSession, generationSession);
          },
        );
      } finally {
        unregister(CSSProcessorName);
        if (previousProcessor !== undefined) {
          register(CSSProcessorName, previousProcessor);
        }
      }
    });
  });

  describe("extractProjectClassesForRoute", () => {
    it("reuses one provider snapshot for route candidates and prepared warmup", async () => {
      let underlyingCalls = 0;
      let contextCalls = 0;
      let listingCalls = 0;
      let candidateFiles: unknown;
      let warmupFiles: unknown;
      let resolveWarmup!: () => void;
      const warmed = new Promise<void>((resolve) => {
        resolveWarmup = resolve;
      });
      const adapter = {
        fs: {
          getUnderlyingAdapter() {
            underlyingCalls++;
            return {
              getContentContext() {
                contextCalls++;
                return {
                  sourceType: "branch" as const,
                  projectSlug: "demo",
                  branch: "main",
                };
              },
              getAllSourceFiles() {
                listingCalls++;
                return [
                  {
                    path: "/project/app/page.tsx",
                    content: '<main className="safe" />',
                  },
                  {
                    path: "/project/styles/theme.css",
                    content: ".safe { color: green; }",
                  },
                ];
              },
            };
          },
        },
      } as any;
      const config = {
        projectDir: "/project",
        adapter,
        config: {},
        mode: "development" as const,
      };
      const context = {
        slug: "docs",
        pageInfo: { entity: { path: "/project/app/page.tsx" } },
        nestedLayouts: [],
        options: { projectSlug: "demo" },
      } as any;

      await extractProjectClassesForRoute(config, context, undefined, {
        getProjectCandidates: (input) => {
          candidateFiles = input.files;
          return new Set(["safe"]);
        },
      });
      startPreparedCSSWarmup(
        config,
        context,
        {
          environment: "preview",
          isLocalProject: false,
          projectSlug: "demo",
          mode: "production",
        } as any,
        {
          warmPreparedCSSArtifactFromFiles: (input) => {
            warmupFiles = input.files;
            resolveWarmup();
            return Promise.resolve(true);
          },
        },
      );
      await warmed;

      assertEquals(underlyingCalls, 1);
      assertEquals(contextCalls, 1);
      assertEquals(listingCalls, 1);
      assertStrictEquals(candidateFiles, warmupFiles);
      assertEquals(Object.isFrozen(candidateFiles), true);
      assertEquals(
        (warmupFiles as Array<{ path: string }>).some((file) =>
          file.path === "/project/styles/theme.css"
        ),
        true,
      );
    });

    it("keeps warmup diagnostics hook-free for hostile throwables", async () => {
      let trapCalls = 0;
      const failure = new Proxy(new Error("source scan failed"), {
        get(target, property, receiver) {
          trapCalls++;
          return Reflect.get(target, property, receiver);
        },
        getPrototypeOf(target) {
          trapCalls++;
          return Reflect.getPrototypeOf(target);
        },
      });
      const context = { slug: "docs", options: { projectSlug: "demo" } } as any;
      startPreparedCSSWarmup(
        {
          projectDir: "/project",
          adapter: {
            fs: {
              getUnderlyingAdapter: () => ({
                getAllSourceFiles: () => Promise.reject(failure),
              }),
            },
          } as any,
          config: {} as any,
          mode: "development",
        },
        context,
        {
          environment: "preview",
          isLocalProject: false,
          projectSlug: "demo",
          mode: "production",
        } as any,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(trapCalls, 0);
    });

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
                getAllSourceFiles: () =>
                  Promise.resolve([{
                    path: "/project/pages/docs.tsx",
                    content: "export default null;",
                  }]),
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
