import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type SSRIsolationOptions,
  SSROrchestrator,
  type SSROrchestratorConfig,
  type SSROrchestratorDependencies,
} from "./ssr-orchestrator.ts";
import * as React from "react";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  clearAllManifests,
  getRouteManifest,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import {
  recordModuleToSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/render-sessions.ts";
import { createImportMapIdentity } from "#veryfront/modules/import-map/index.ts";
import { __resetPoolForTests, getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import { join } from "node:path";

const TEST_SOURCE_INTEGRATION_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;

function createMockConfig(overrides: Partial<SSROrchestratorConfig> = {}): SSROrchestratorConfig {
  return {
    mode: "production",
    debugMode: false,
    elementValidator: {
      ensureValidReactElement: (el: React.ReactElement) => el,
      validateReactTree: () => ({ valid: true, issues: [] }),
    } as unknown as SSROrchestratorConfig["elementValidator"],
    ssrRenderer: {
      renderToHTML: async () => ({
        html: "<div>rendered</div>",
        stream: null,
      }),
    } as unknown as SSROrchestratorConfig["ssrRenderer"],
    htmlGenerator: {
      generateFullHTML: async (ctx: { html: string; ssrHash: string }) =>
        `<!DOCTYPE html><html><body>${ctx.html}</body></html>`,
      generateHTMLStream: async () => new ReadableStream(),
    } as unknown as SSROrchestratorConfig["htmlGenerator"],
    ...overrides,
  };
}

function createGenerationContext() {
  return {
    meta: { title: "Test", slug: "/test" },
    pageBundle: {
      compiledCode: "",
      frontmatter: {},
      globals: {},
      headings: [],
      nodeMap: new Map(),
    },
  } as any;
}

describe("rendering/orchestrator/ssr-orchestrator", () => {
  describe("SSROrchestrator constructor", () => {
    it("should create with valid config", () => {
      const config = createMockConfig();
      const orchestrator = new SSROrchestrator(config);
      assertEquals(orchestrator instanceof SSROrchestrator, true);
    });
  });

  describe("performSSRRendering", () => {
    it("should render a simple element to full HTML", async () => {
      const config = createMockConfig();
      const orchestrator = new SSROrchestrator(config);
      const element = React.createElement("div", null, "hello") as React.ReactElement;

      const result = await orchestrator.performSSRRendering(
        element,
        {
          meta: { title: "Test", slug: "/test" },
          pageBundle: {
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          },
        } as any,
      );

      assertEquals(typeof result.fullHtml, "string");
      assertEquals(result.fullHtml.includes("<div>rendered</div>"), true);
      assertEquals(typeof result.ssrHash, "string");
      assertEquals(result.ssrHash.length > 0, true);
    });

    it("should return null stream when delivery is not stream", async () => {
      const config = createMockConfig();
      const orchestrator = new SSROrchestrator(config);
      const element = React.createElement("div", null, "test") as React.ReactElement;

      const result = await orchestrator.performSSRRendering(
        element,
        {
          meta: { title: "Test", slug: "/test" },
          pageBundle: {
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          },
        } as any,
      );

      assertEquals(result.finalStream, null);
    });

    it("should use element validator", async () => {
      let validatorCalled = false;
      const config = createMockConfig({
        elementValidator: {
          ensureValidReactElement: (el: React.ReactElement) => {
            validatorCalled = true;
            return el;
          },
          validateReactTree: () => ({ valid: true, issues: [] }),
        } as unknown as SSROrchestratorConfig["elementValidator"],
      });

      const orchestrator = new SSROrchestrator(config);
      const element = React.createElement("div") as React.ReactElement;

      await orchestrator.performSSRRendering(
        element,
        {
          meta: { title: "Test", slug: "/" },
          pageBundle: {
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          },
        } as any,
      );

      assertEquals(validatorCalled, true);
    });

    it("should handle streaming mode", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<div>streaming</div>"));
          controller.close();
        },
      });

      const config = createMockConfig({
        ssrRenderer: {
          renderToHTML: async () => ({
            html: "<div>streamed</div>",
            stream: mockStream,
          }),
        } as unknown as SSROrchestratorConfig["ssrRenderer"],
        htmlGenerator: {
          generateFullHTML: async () => "",
          generateHTMLStream: async () => new ReadableStream(),
        } as unknown as SSROrchestratorConfig["htmlGenerator"],
      });

      const orchestrator = new SSROrchestrator(config);
      const element = React.createElement("div") as React.ReactElement;

      const result = await orchestrator.performSSRRendering(
        element,
        {
          meta: { title: "Stream", slug: "/stream" },
          pageBundle: {
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          },
        } as any,
        { delivery: "stream" },
      );

      assertEquals(result.finalStream instanceof ReadableStream, true);
      assertEquals(typeof result.ssrHash, "string");
    });

    it("preserves stream readiness metadata through HTML shell generation", async () => {
      const allReady = Promise.resolve();
      const mockStream = Object.assign(new ReadableStream(), { allReady });
      const finalStream = new ReadableStream();

      const config = createMockConfig({
        ssrRenderer: {
          renderToHTML: async () => ({
            html: "",
            stream: mockStream,
          }),
        } as unknown as SSROrchestratorConfig["ssrRenderer"],
        htmlGenerator: {
          generateFullHTML: async () => "",
          generateHTMLStream: async () => finalStream,
        } as unknown as SSROrchestratorConfig["htmlGenerator"],
      });

      const orchestrator = new SSROrchestrator(config);
      const element = React.createElement("div") as React.ReactElement;

      const result = await orchestrator.performSSRRendering(
        element,
        {
          meta: { title: "Stream", slug: "/stream" },
          pageBundle: {
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          },
        } as any,
        { delivery: "stream" },
      );

      assertEquals((result.finalStream as { allReady?: Promise<unknown> }).allReady, allReady);
    });

    it("admits isolated string rendering through WorkerPool.execute", async () => {
      let observed:
        | { projectId: string; readPaths: string[]; delivery: string }
        | undefined;
      let evictedWorkerId: string | undefined;
      const workerPool: ReturnType<
        NonNullable<SSROrchestratorDependencies["getWorkerPool"]>
      > = {
        execute: async (projectId, readPaths, request) => {
          if (request.type !== "render-ssr") throw new Error("expected an SSR request");
          observed = { projectId, readPaths, delivery: request.delivery };
          return {
            type: "ssr-result",
            id: request.id,
            html: "<main>isolated</main>",
          };
        },
        executeStream: () => {
          throw new Error("stream execution must not be used");
        },
        evictWorker: (projectId) => {
          evictedWorkerId = projectId;
        },
      };
      const orchestrator = new SSROrchestrator(createMockConfig(), {
        getWorkerPool: () => workerPool,
        isSSRIsolationEnabled: () => true,
      });

      const result = await runWithExactSourceIntegrationPolicy(
        TEST_SOURCE_INTEGRATION_POLICY,
        () =>
          orchestrator.performSSRRendering(
            React.createElement("div"),
            createGenerationContext(),
            undefined,
            {
              projectDir: "/tmp/project",
              pageModulePath: "/tmp/project/page.tsx",
              layoutModulePaths: [],
              pageProps: {},
              layoutProps: [],
            },
          ),
      );

      assert(observed);
      assertMatch(observed.projectId, /^ssr-ephemeral-[0-9a-f-]{36}$/);
      assertEquals(observed.readPaths, ["/tmp/project"]);
      assertEquals(observed.delivery, "string");
      assertEquals(evictedWorkerId, observed.projectId);
      assertEquals(result.fullHtml.includes("<main>isolated</main>"), true);
      assertEquals(result.finalStream, null);
    });

    it("admits isolated streaming through WorkerPool.executeStream", async () => {
      const workerStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<main>isolated stream</main>"));
          controller.close();
        },
      });
      let observed:
        | { projectId: string; readPaths: string[]; delivery: string }
        | undefined;
      let evictedWorkerId: string | undefined;
      const workerPool: ReturnType<
        NonNullable<SSROrchestratorDependencies["getWorkerPool"]>
      > = {
        execute: () => {
          throw new Error("string execution must not be used");
        },
        executeStream: (projectId, readPaths, request) => {
          if (request.type !== "render-ssr") throw new Error("expected an SSR request");
          observed = { projectId, readPaths, delivery: request.delivery };
          return workerStream;
        },
        evictWorker: (projectId) => {
          evictedWorkerId = projectId;
        },
      };
      const config = createMockConfig({
        htmlGenerator: {
          generateFullHTML: async () => "",
          generateHTMLStream: async (stream: ReadableStream) => stream,
        } as unknown as SSROrchestratorConfig["htmlGenerator"],
      });
      const orchestrator = new SSROrchestrator(config, {
        getWorkerPool: () => workerPool,
        isSSRIsolationEnabled: () => true,
      });

      const result = await runWithExactSourceIntegrationPolicy(
        TEST_SOURCE_INTEGRATION_POLICY,
        () =>
          orchestrator.performSSRRendering(
            React.createElement("div"),
            createGenerationContext(),
            { delivery: "stream" },
            {
              projectDir: "/tmp/project",
              pageModulePath: "/tmp/project/page.tsx",
              layoutModulePaths: [],
              pageProps: {},
              layoutProps: [],
            },
          ),
      );

      assert(observed);
      assertMatch(observed.projectId, /^ssr-ephemeral-[0-9a-f-]{36}$/);
      assertEquals(observed.readPaths, ["/tmp/project"]);
      assertEquals(observed.delivery, "stream");
      assertEquals(evictedWorkerId, observed.projectId);
      assertEquals(result.finalStream, workerStream);
    });

    it("snapshots the complete isolated request before resolving its Worker generation", async () => {
      let projectDir = "/tmp/original-project";
      let pageModulePath = "/tmp/original-project/page.tsx";
      const layoutModulePaths = ["/tmp/original-project/layout.tsx"];
      const pageProps = { title: "original", nested: { count: 1 } };
      const layoutProps = [{ theme: "original", nested: { count: 2 } }];
      const reads = {
        projectDir: 0,
        pageModulePath: 0,
        layoutModulePaths: 0,
        pageProps: 0,
        layoutProps: 0,
        workerScopeId: 0,
        workerGenerationId: 0,
      };
      let mutationScheduled = false;
      const isolation = {
        get projectDir() {
          reads.projectDir++;
          return projectDir;
        },
        get pageModulePath() {
          reads.pageModulePath++;
          return pageModulePath;
        },
        get layoutModulePaths() {
          reads.layoutModulePaths++;
          return layoutModulePaths;
        },
        get pageProps() {
          reads.pageProps++;
          return pageProps;
        },
        get layoutProps() {
          reads.layoutProps++;
          return layoutProps;
        },
        get workerScopeId() {
          reads.workerScopeId++;
          return "ssr-snapshot-scope";
        },
        get workerGenerationId() {
          reads.workerGenerationId++;
          if (!mutationScheduled) {
            mutationScheduled = true;
            queueMicrotask(() => {
              projectDir = "/tmp/mutated-project";
              pageModulePath = "/tmp/mutated-project/page.tsx";
              layoutModulePaths[0] = "/tmp/mutated-project/layout.tsx";
              pageProps.title = "mutated";
              pageProps.nested.count = 10;
              layoutProps[0]!.theme = "mutated";
              layoutProps[0]!.nested.count = 20;
            });
          }
          return "release-1";
        },
      } satisfies SSRIsolationOptions;
      let observed:
        | {
          readPaths: string[];
          pageModulePath: string;
          layoutModulePaths: string[];
          pageProps: Record<string, unknown>;
          layoutProps: Record<string, unknown>[];
        }
        | undefined;
      const workerPool: ReturnType<
        NonNullable<SSROrchestratorDependencies["getWorkerPool"]>
      > = {
        execute: async (_workerId, readPaths, request) => {
          if (request.type !== "render-ssr") throw new Error("expected an SSR request");
          observed = {
            readPaths,
            pageModulePath: request.pageModulePath,
            layoutModulePaths: request.layoutModulePaths,
            pageProps: request.pageProps,
            layoutProps: request.layoutProps,
          };
          return {
            type: "ssr-result",
            id: request.id,
            html: "<main>isolated</main>",
          };
        },
        executeStream: () => {
          throw new Error("stream execution must not be used");
        },
        evictWorker: () => {},
      };
      const orchestrator = new SSROrchestrator(createMockConfig(), {
        getWorkerPool: () => workerPool,
        isSSRIsolationEnabled: () => true,
      });

      await runWithExactSourceIntegrationPolicy(
        TEST_SOURCE_INTEGRATION_POLICY,
        () =>
          orchestrator.performSSRRendering(
            React.createElement("div"),
            createGenerationContext(),
            undefined,
            isolation,
          ),
      );

      assertEquals(projectDir, "/tmp/mutated-project");
      assertEquals(observed, {
        readPaths: ["/tmp/original-project"],
        pageModulePath: "/tmp/original-project/page.tsx",
        layoutModulePaths: ["/tmp/original-project/layout.tsx"],
        pageProps: { title: "original", nested: { count: 1 } },
        layoutProps: [{ theme: "original", nested: { count: 2 } }],
      });
      assertEquals(reads, {
        projectDir: 1,
        pageModulePath: 1,
        layoutModulePaths: 1,
        pageProps: 1,
        layoutProps: 1,
        workerScopeId: 1,
        workerGenerationId: 1,
      });
    });

    it("rejects inconsistent isolated layout data before Worker admission", async () => {
      let poolResolved = false;
      const orchestrator = new SSROrchestrator(createMockConfig(), {
        getWorkerPool: () => {
          poolResolved = true;
          throw new Error("worker pool must not be resolved");
        },
        isSSRIsolationEnabled: () => true,
      });
      let failure: unknown;

      try {
        await orchestrator.performSSRRendering(
          React.createElement("div"),
          createGenerationContext(),
          undefined,
          {
            projectDir: "/tmp/project",
            pageModulePath: "/tmp/project/page.tsx",
            layoutModulePaths: ["/tmp/project/layout.tsx"],
            pageProps: {},
            layoutProps: [],
          },
        );
      } catch (error) {
        failure = error;
      }

      assert(failure instanceof TypeError);
      assertEquals(
        failure.message,
        "SSR isolation layoutProps must have one entry per layoutModulePath",
      );
      assertEquals(poolResolved, false);
    });

    it("loads a fresh isolated dependency graph when the source generation changes", async () => {
      const projectDir = await Deno.realPath(
        await Deno.makeTempDir({ prefix: "vf-isolated-ssr-" }),
      );
      const pageModulePath = join(projectDir, "page.mjs");
      const dependencyPath = join(projectDir, "dependency.mjs");
      const workerScopeId = `ssr-generation-${crypto.randomUUID()}`;
      await Deno.writeTextFile(
        pageModulePath,
        `import { label } from "./dependency.mjs";
         export default function Page() { return label; }`,
      );
      await Deno.writeTextFile(
        dependencyPath,
        `export const label = "first generation";`,
      );
      const orchestrator = new SSROrchestrator(createMockConfig(), {
        getWorkerPool,
        isSSRIsolationEnabled: () => true,
      });
      const renderGeneration = (workerGenerationId: string) =>
        runWithExactSourceIntegrationPolicy(
          TEST_SOURCE_INTEGRATION_POLICY,
          () =>
            orchestrator.performSSRRendering(
              React.createElement("div"),
              createGenerationContext(),
              undefined,
              {
                projectDir,
                pageModulePath,
                layoutModulePaths: [],
                pageProps: {},
                layoutProps: [],
                workerScopeId,
                workerGenerationId,
              },
            ),
        );

      try {
        const first = await renderGeneration("release-1");
        await Deno.writeTextFile(
          dependencyPath,
          `export const label = "second generation";`,
        );
        const second = await renderGeneration("release-2");

        assert(first.fullHtml.includes("first generation"));
        assert(second.fullHtml.includes("second generation"));
      } finally {
        getWorkerPool().evictWorkerScope(workerScopeId);
        __resetPoolForTests();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("finalizes the render session before HTML shell generation", async () => {
      clearAllManifests();
      startRenderSession("render-session-1", "project-slug", "test-page");

      const config = createMockConfig({
        ssrRenderer: {
          renderToHTML: async () => {
            recordModuleToSession("_vf_modules/components/TestWidget.tsx");
            return { html: "<div>rendered</div>", stream: null };
          },
        } as unknown as SSROrchestratorConfig["ssrRenderer"],
        htmlGenerator: {
          generateFullHTML: async () => {
            const manifest = getRouteManifest("project-slug", "test-page");
            assertEquals(manifest?.moduleCount, 1);
            assertEquals(manifest?.modules[0]?.path, "components/TestWidget.js");
            return "<!DOCTYPE html><html><body><div>rendered</div></body></html>";
          },
          generateHTMLStream: async () => new ReadableStream(),
        } as unknown as SSROrchestratorConfig["htmlGenerator"],
      });

      const orchestrator = new SSROrchestrator(config);
      const element = React.createElement("div") as React.ReactElement;

      await orchestrator.performSSRRendering(
        element,
        {
          meta: { title: "Test", slug: "test-page" },
          pageBundle: {
            compiledCode: "",
            frontmatter: {},
            globals: {},
            headings: [],
            nodeMap: new Map(),
          },
        } as any,
        { projectSlug: "project-slug", renderSessionId: "render-session-1" },
      );

      clearAllManifests();
    });

    it("renders app-router error boundaries inside route layouts with request options", async () => {
      const pageError = new Error("page failed");
      let renderCount = 0;
      let wrappedProps: unknown;
      let wrappedUrl: URL | undefined;
      let wrappedParams: Record<string, string | string[]> | undefined;
      let wrappedRequestIdentity: unknown;
      let wrappedLayoutDataMap: unknown;
      let wrappedClientPageIsland: unknown;
      let wrappedFrontmatter: Record<string, unknown> | undefined;
      const layoutRequestIdentity = {
        projectId: "project-id",
        projectSlug: "docs",
        contentSourceId: "content-source",
        importMapIdentity: await createImportMapIdentity({ imports: {} }),
      };
      const layoutDataMap = new Map([
        ["/project/app/layout.tsx", { navigation: ["Docs"] }],
      ]);

      const config = createMockConfig({
        ssrRenderer: {
          renderToHTML: async (element: React.ReactElement) => {
            renderCount += 1;
            if (renderCount === 1) throw pageError;
            assertEquals(element.type, "section");
            return {
              html: "<section data-boundary>wrapped error</section>",
              stream: null,
            };
          },
        } as unknown as SSROrchestratorConfig["ssrRenderer"],
        htmlGenerator: {
          resolveErrorComponent: async () => ({
            element: React.createElement("div", { id: "error-boundary" }),
            path: "/project/app/blog/error.tsx",
          }),
          generateFullHTML: async (ctx: { html: string }) =>
            `<!doctype html><html><body>${ctx.html}</body></html>`,
          generateHTMLStream: async () => new ReadableStream(),
        } as unknown as SSROrchestratorConfig["htmlGenerator"],
        layoutOrchestrator: {
          applyLayoutsAndWrappers: async (
            element: unknown,
            _pageInfo: unknown,
            _layoutBundle: unknown,
            _nestedLayouts: unknown,
            requestIdentity: unknown,
            receivedLayoutDataMap: unknown,
            url: URL | undefined,
            params: Record<string, string | string[]> | undefined,
            frontmatter: Record<string, unknown> | undefined,
            _headings: unknown,
            clientPageIsland: unknown,
            props: Record<string, unknown> | undefined,
          ) => {
            wrappedUrl = url;
            wrappedParams = params;
            wrappedRequestIdentity = requestIdentity;
            wrappedLayoutDataMap = receivedLayoutDataMap;
            wrappedClientPageIsland = clientPageIsland;
            wrappedProps = props;
            wrappedFrontmatter = frontmatter;
            return React.createElement("section", null, element as React.ReactNode);
          },
        } as unknown as SSROrchestratorConfig["layoutOrchestrator"],
      });

      const orchestrator = new SSROrchestrator(config);
      const url = new URL("http://localhost/blog/hello?draft=1");
      const clientPageIsland = { mode: "client-page" };
      let signal: (Error & { errorBoundaryHtml?: string }) | undefined;

      try {
        await orchestrator.performSSRRendering(
          React.createElement("main"),
          {
            meta: { title: "Blog", slug: "/blog/hello" },
            pageInfo: {
              entity: {
                path: "/project/app/blog/[slug]/page.tsx",
                frontmatter: { section: "blog" },
              },
            } as any,
            pageBundle: {
              compiledCode: "",
              frontmatter: { title: "Hello" },
              globals: {},
              headings: [{ id: "intro", text: "Intro", level: 2 }],
              nodeMap: new Map(),
            },
            layoutBundle: undefined,
            nestedLayouts: [{ kind: "tsx", componentPath: "/project/app/layout.tsx" }],
            layoutRequestIdentity,
            layoutDataMap,
            collectedMetadata: {},
            slug: "/blog/hello",
            cssImports: [],
            options: {
              url,
              params: { slug: "hello" },
              props: { preview: true },
              projectSlug: "docs",
              clientPageIsland: clientPageIsland as any,
            },
          } as any,
        );
      } catch (error) {
        signal = error as Error & { errorBoundaryHtml?: string };
      }

      assert(signal);
      assertEquals(signal.message, "app-router-error-boundary-rendered");
      assertEquals(signal.errorBoundaryHtml?.includes("wrapped error"), true);
      assertEquals(renderCount, 2);
      assertEquals(wrappedUrl, url);
      assertEquals(wrappedParams, { slug: "hello" });
      assertEquals(wrappedRequestIdentity, layoutRequestIdentity);
      assertEquals(wrappedLayoutDataMap, layoutDataMap);
      assertEquals(wrappedClientPageIsland, clientPageIsland);
      assertEquals(wrappedProps, { preview: true });
      assertEquals(wrappedFrontmatter, { section: "blog", title: "Hello" });
    });

    it("fails closed when an error-boundary layout identity is unavailable", async () => {
      const pageError = new Error("page failed");
      let layoutApplied = false;
      const config = createMockConfig({
        ssrRenderer: {
          renderToHTML: () => Promise.reject(pageError),
        } as unknown as SSROrchestratorConfig["ssrRenderer"],
        htmlGenerator: {
          resolveErrorComponent: async () => ({
            element: React.createElement("div", { id: "error-boundary" }),
            path: "/project/app/error.tsx",
          }),
        } as unknown as SSROrchestratorConfig["htmlGenerator"],
        layoutOrchestrator: {
          applyLayoutsAndWrappers: async (element: React.ReactElement) => {
            layoutApplied = true;
            return element;
          },
        } as unknown as SSROrchestratorConfig["layoutOrchestrator"],
      });

      let failure: unknown;
      try {
        await new SSROrchestrator(config).performSSRRendering(
          React.createElement("main"),
          {
            pageInfo: { entity: { path: "/project/app/page.tsx" } },
            pageBundle: { frontmatter: {}, headings: [] },
            layoutBundle: undefined,
            nestedLayouts: [],
            collectedMetadata: {},
            slug: "/",
          } as any,
        );
      } catch (error) {
        failure = error;
      }

      assert(failure instanceof Error);
      assertEquals(
        failure.message,
        "Cannot render an app-router error boundary without the preloaded layout request identity",
      );
      assertEquals(failure.cause, pageError);
      assertEquals(layoutApplied, false);
    });
  });
});
