import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { afterAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RSCDevServerHandler } from "./handler.ts";

describe(
  "RSCDevServerHandler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let handler: RSCDevServerHandler;

    afterAll(async () => {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
    });

    beforeEach(() => {
      handler = new RSCDevServerHandler("/tmp/test-project");
    });

    describe("constructor", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should create handler with project directory", () => {
        expect(handler).toBeDefined();
      });
    });

    describe("handlePage", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should return page response for valid pathname", async () => {
        const response = await handler.handlePage("/test", new URLSearchParams());

        expect(response).toBeInstanceOf(Response);
        expect(response.headers.get("content-type")).toContain("text/html");
      });

      it("should return page response for root pathname", async () => {
        const response = await handler.handlePage("/", new URLSearchParams());

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(200);
      });

      it("should handle search params", async () => {
        const response = await handler.handlePage(
          "/",
          new URLSearchParams({ page: "/custom" }),
        );

        expect(response).toBeInstanceOf(Response);
      });

      it("uses the React version detected from package.json for hydration", async () => {
        const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-react-version-" });
        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ dependencies: { react: "18.3.1" } }),
        );

        try {
          const packageHandler = new RSCDevServerHandler(projectDir, {
            isLocalProject: true,
            mode: "production",
          });
          const response = await packageHandler.handlePage("/", new URLSearchParams());
          const html = await response.text();

          expect(html).toContain('"reactVersion":"18.3.1"');
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    });

    describe("handleManifest", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should return manifest response", async () => {
        const response = await handler.handleManifest();

        expect(response).toBeInstanceOf(Response);
        expect(response.headers.get("content-type")).toContain("application/json");
      });

      it("should return empty manifest when not initialized", async () => {
        const response = await handler.handleManifest();
        const text = await response.text();

        expect(() => JSON.parse(text)).not.toThrow();
      });

      it("uses the configured app directory for manifests and route rendering", async () => {
        const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-custom-app-" });
        const appDir = `${projectDir}/frontend`;
        await Deno.mkdir(appDir, { recursive: true });
        await Deno.writeTextFile(
          `${appDir}/Counter.tsx`,
          `'use client';\nexport default function Counter() { return null; }`,
        );
        await Deno.writeTextFile(
          `${appDir}/page.tsx`,
          `export default function Page() { return null; }`,
        );

        try {
          const customHandler = new RSCDevServerHandler(projectDir, {
            config: { directories: { app: "frontend" } },
            isLocalProject: true,
          });
          const manifestResponse = await customHandler.handleManifest();
          const manifest = await manifestResponse.json();
          const renderResponse = await customHandler.handleRender("/", new URLSearchParams());

          expect(manifest.components.Counter).toBeDefined();
          expect(renderResponse.status).toBe(200);
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("reuses preview manifests until explicit source invalidation", async () => {
        const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-preview-refresh-" });
        const appDir = `${projectDir}/app`;
        const clientPath = `${appDir}/Counter.tsx`;
        await Deno.mkdir(appDir, { recursive: true });
        await Deno.writeTextFile(
          clientPath,
          `'use client';\nexport default function Counter() { return 1; }`,
        );
        await Deno.writeTextFile(
          `${appDir}/page.tsx`,
          `export default function Page() { return null; }`,
        );

        try {
          const previewHandler = new RSCDevServerHandler(projectDir, {
            isLocalProject: false,
            mode: "development",
          });
          await previewHandler.handleRender("/", new URLSearchParams());
          const firstRenderer = (previewHandler as unknown as {
            renderer: { clientManifest: Map<string, { path: string }> };
          }).renderer;
          const firstPath = firstRenderer.clientManifest.get("Counter")?.path;

          await Deno.writeTextFile(
            clientPath,
            `'use client';\nexport default function Counter() { return 2; }`,
          );
          await previewHandler.handleRender("/", new URLSearchParams());
          const secondRenderer = (previewHandler as unknown as {
            renderer: { clientManifest: Map<string, { path: string }> };
          }).renderer;
          const secondPath = secondRenderer.clientManifest.get("Counter")?.path;

          previewHandler.invalidate();
          await previewHandler.handleRender("/", new URLSearchParams());
          const refreshedRenderer = (previewHandler as unknown as {
            renderer: { clientManifest: Map<string, { path: string }> };
          }).renderer;
          const refreshedPath = refreshedRenderer.clientManifest.get("Counter")?.path;

          expect(firstPath).toContain("/_veryfront/rsc/module?");
          expect(secondPath).toContain("/_veryfront/rsc/module?");
          expect(secondRenderer).toBe(firstRenderer);
          expect(secondPath).toBe(firstPath);
          expect(refreshedRenderer).not.toBe(firstRenderer);
          expect(refreshedPath).not.toBe(firstPath);
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    });
  },
);
