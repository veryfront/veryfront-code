import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSROrchestrator, type SSROrchestratorConfig } from "./ssr-orchestrator.ts";
import * as React from "react";

function createMockConfig(overrides: Partial<SSROrchestratorConfig> = {}): SSROrchestratorConfig {
  return {
    mode: "production",
    debugMode: false,
    elementValidator: {
      ensureValidReactElement: (el: React.ReactElement) => el,
      validateReactTree: () => ({ valid: true, issues: [] }),
    } as SSROrchestratorConfig["elementValidator"],
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
        } as SSROrchestratorConfig["elementValidator"],
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
  });
});
