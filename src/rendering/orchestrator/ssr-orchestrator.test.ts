import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSROrchestrator, type SSROrchestratorConfig } from "./ssr-orchestrator.ts";
import * as React from "react";
import {
  clearAllManifests,
  getRouteManifest,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import {
  recordModuleToSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/render-sessions.ts";
import { getHeadCollectorNonce } from "#veryfront/react/head-collector.ts";
import type { SSRRenderOptions } from "../ssr-renderer.ts";

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

describe("rendering/orchestrator/ssr-orchestrator", () => {
  describe("SSROrchestrator constructor", () => {
    it("should create with valid config", () => {
      const config = createMockConfig();
      const orchestrator = new SSROrchestrator(config);
      assertEquals(orchestrator instanceof SSROrchestrator, true);
    });
  });

  describe("performSSRRendering", () => {
    it("binds the response nonce only while the React render is active", async () => {
      let observedNonce: string | undefined;
      let forwardedNonce: string | undefined;
      const config = createMockConfig({
        ssrRenderer: {
          renderToHTML: async (_element: React.ReactElement, options: SSRRenderOptions) => {
            observedNonce = getHeadCollectorNonce();
            forwardedNonce = options.nonce;
            return { html: "<div>rendered</div>", stream: null };
          },
        } as unknown as SSROrchestratorConfig["ssrRenderer"],
      });

      const orchestrator = new SSROrchestrator(config);
      await orchestrator.performSSRRendering(
        React.createElement("div"),
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
        { nonce: "response-nonce" },
      );

      assertEquals(observedNonce, "response-nonce");
      assertEquals(forwardedNonce, "response-nonce");
      assertEquals(getHeadCollectorNonce(), undefined);
    });

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
      let wrappedProjectSlug: string | undefined;
      let wrappedClientPageIsland: unknown;
      let wrappedFrontmatter: Record<string, unknown> | undefined;
      let wrappedSignal: AbortSignal | undefined;

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
            _layoutDataMap: unknown,
            url: URL | undefined,
            params: Record<string, string | string[]> | undefined,
            frontmatter: Record<string, unknown> | undefined,
            _headings: unknown,
            projectSlug: string | undefined,
            clientPageIsland: unknown,
            props: Record<string, unknown> | undefined,
            _pinKey: unknown,
            _dependencies: unknown,
            _source: unknown,
            abortSignal: AbortSignal | undefined,
          ) => {
            wrappedUrl = url;
            wrappedParams = params;
            wrappedProjectSlug = projectSlug;
            wrappedClientPageIsland = clientPageIsland;
            wrappedProps = props;
            wrappedFrontmatter = frontmatter;
            wrappedSignal = abortSignal;
            return React.createElement("section", null, element as React.ReactNode);
          },
        } as unknown as SSROrchestratorConfig["layoutOrchestrator"],
      });

      const orchestrator = new SSROrchestrator(config);
      const url = new URL("http://localhost/blog/hello?draft=1");
      const clientPageIsland = { mode: "client-page" };
      const controller = new AbortController();
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
            collectedMetadata: {},
            slug: "/blog/hello",
            cssImports: [],
            options: {
              url,
              params: { slug: "hello" },
              props: { preview: true },
              projectSlug: "docs",
              clientPageIsland: clientPageIsland as any,
              abortSignal: controller.signal,
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
      assertEquals(wrappedProjectSlug, "docs");
      assertEquals(wrappedClientPageIsland, clientPageIsland);
      assertEquals(wrappedProps, { preview: true });
      assertEquals(wrappedFrontmatter, { section: "blog", title: "Hello" });
      assertEquals(wrappedSignal, controller.signal);
    });
  });
});
