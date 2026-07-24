import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
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

    it("admits isolated string rendering through WorkerPool.execute", async () => {
      let observed:
        | { projectId: string; readPaths: string[]; delivery: string }
        | undefined;
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

      assertEquals(observed, {
        projectId: "/tmp/project",
        readPaths: ["/tmp/project"],
        delivery: "string",
      });
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

      assertEquals(observed, {
        projectId: "/tmp/project",
        readPaths: ["/tmp/project"],
        delivery: "stream",
      });
      assertEquals(result.finalStream, workerStream);
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
  });
});
