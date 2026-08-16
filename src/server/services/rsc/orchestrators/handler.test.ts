import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { afterAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { RSCDevServerHandler } from "./handler.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";

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

      it("passes project module options to the render handler", () => {
        const localHandler = new RSCDevServerHandler("/tmp/test-project", {
          isLocalProject: true,
          config: { build: { serverExternalPackages: ["knex"] } },
        });
        const moduleOptions = (localHandler as unknown as {
          renderHandler: {
            moduleOptions: {
              isLocalProject?: boolean;
              serverExternalPackages?: readonly string[];
            };
          };
        }).renderHandler.moduleOptions;

        assertEquals(moduleOptions.isLocalProject, true);
        assertEquals(moduleOptions.serverExternalPackages, ["knex"]);
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

      it("keeps render, React, and manifest module URLs on historical snapshot A after B is current", async () => {
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-rsc-historical-pins-",
        });
        const appDir = `${projectDir}/app`;
        const packageJsonPath = `${projectDir}/package.json`;
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
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
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          await Deno.writeTextFile(
            packageJsonPath,
            JSON.stringify({
              dependencies: {
                react: "18.3.1",
                "example-package": "1.0.0",
              },
            }),
          );
          const snapshotA = await getDependencyPinningSnapshot(projectDir);

          await Deno.writeTextFile(
            packageJsonPath,
            JSON.stringify({
              dependencies: {
                react: "19.2.4",
                "example-package": "2.0.0",
              },
            }),
          );
          const future = new Date(Date.now() + 2_000);
          await Deno.utime(packageJsonPath, future, future);
          const snapshotB = await getDependencyPinningSnapshot(projectDir);
          expect(snapshotB.cacheKey).not.toBe(snapshotA.cacheKey);

          const historicalHandler = new RSCDevServerHandler(projectDir, {
            isLocalProject: false,
            mode: "production",
          });
          const rememberedA = await resolveRequestedDependencyPinningSnapshot(
            projectDir,
            snapshotA.cacheKey,
          );
          expect(rememberedA).toBeDefined();
          const resolveSnapshotReact = (historicalHandler as unknown as {
            renderHandler: {
              moduleOptions: {
                reactVersion: (
                  snapshot: NonNullable<typeof rememberedA>,
                ) => Promise<string>;
              };
            };
          }).renderHandler.moduleOptions.reactVersion;
          expect(await resolveSnapshotReact(rememberedA!)).toBe("18.3.1");

          const renderResponse = await historicalHandler.handleRender(
            "/",
            new URLSearchParams({ pins: "application-value" }),
            new Request("http://localhost/_veryfront/rsc/render?pins=application-value", {
              headers: { [RSC_DEPENDENCY_PINNING_HEADER]: snapshotA.cacheKey },
            }),
          );
          const renderPayload = await renderResponse.json();
          expect(renderResponse.status).toBe(200);
          expect(renderPayload.dependencyPinningCacheKey).toBe(
            snapshotA.cacheKey,
          );

          const manifestResponse = await historicalHandler.handleManifest(
            snapshotA.cacheKey,
          );
          const manifest = await manifestResponse.json();
          expect(manifest.dependencyPinningCacheKey).toBe(snapshotA.cacheKey);
          expect(manifest.components.Counter).toContain(
            `pins=${encodeURIComponent(snapshotA.cacheKey)}`,
          );
          expect(manifest.components.Counter).not.toContain(
            encodeURIComponent(snapshotB.cacheKey),
          );
        } finally {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
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
