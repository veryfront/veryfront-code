import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderHandler } from "./render-handler.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RSCRenderer } from "#veryfront/rendering/rsc/server-renderer/index.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";
import { type MDXLoadModuleOptions, mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";

describe("server/services/rsc/orchestrators/render-handler", () => {
  describe("handle", () => {
    it("returns error response when component is not found", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent-project",
        () => null,
        "production",
      );

      const response = await handler.handle("/nonexistent", new URLSearchParams());
      // Should get an error response (component not found or renderer not initialized)
      assertEquals(response.status >= 400, true);
    });

    it("returns error response when renderer is null", async () => {
      // RenderHandler with a getRenderer that returns null
      // The component path won't resolve, so we get "Component not found"
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        "production",
      );

      const response = await handler.handle("/some-page", new URLSearchParams());
      assertEquals(response.status >= 400, true);
      const body = await response.text();
      // Should include error information
      assertEquals(body.length > 0, true);
    });

    it("returns error response as JSON with proper content type", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        "production",
      );

      const response = await handler.handle("/test", new URLSearchParams());
      const contentType = response.headers.get("content-type");
      // Error responses should be JSON
      assertEquals(contentType?.includes("json") ?? false, true);
    });

    it("handles root pathname", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        "production",
      );

      const response = await handler.handle("/", new URLSearchParams());
      // Should fail gracefully since project doesn't exist
      assertEquals(response.status >= 400, true);
    });

    it("handles pathname with search params", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        "production",
      );

      const params = new URLSearchParams({ foo: "bar", baz: "qux" });
      const response = await handler.handle("/page", params);
      assertEquals(response.status >= 400, true);
    });

    it("preserves application pins in app props because transport uses a header", () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        "production",
      );
      const props = (handler as unknown as {
        buildProps: (
          pathname: string,
          searchParams: URLSearchParams,
        ) => { searchParams: Record<string, string> };
      }).buildProps(
        "/page",
        new URLSearchParams({
          query: "visible",
          pins: "on:internal-snapshot",
        }),
      );

      assertEquals(props.searchParams, {
        query: "visible",
        pins: "on:internal-snapshot",
      });
    });

    it("uses the historical snapshot loader when no adapter was supplied", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-runtime-adapter-" });
      const packageJsonPath = `${projectDir}/package.json`;
      const pagePath = `${projectDir}/app/page.tsx`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      await Deno.mkdir(`${projectDir}/app`);
      await Deno.writeTextFile(
        pagePath,
        `import value from "example-package"; export default function Page() { return value; }`,
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
        await getDependencyPinningSnapshot(projectDir);

        const adapter = createMockAdapter();
        adapter.fs.files.set(
          pagePath,
          `import value from "example-package"; export default function Page() { return value; }`,
        );
        let observedVersion: string | undefined;
        let observedServerExternalPackages: readonly string[] | undefined;
        const observedOrigins: Array<string | undefined> = [];
        const Page = () => null;
        const renderer = {
          renderToPayload: () => Promise.resolve({ html: "<div></div>", clientRefs: {} }),
        } as unknown as RSCRenderer;
        const handler = new RenderHandler(
          projectDir,
          () => renderer,
          "development",
          "app",
          {
            runtimeAdapter: () => Promise.resolve(adapter),
            moduleLoader: (_source, _path, _projectDir, _adapter, options) => {
              observedVersion = options?.dependencyPinningDependencies?.["example-package"];
              observedServerExternalPackages = options?.serverExternalPackages;
              observedOrigins.push(options?.moduleServerOrigin);
              return Promise.resolve({ default: Page });
            },
            serverExternalPackages: ["knex"],
            reactVersion: (snapshot) => Promise.resolve(snapshot.dependencies?.react ?? "19.1.1"),
          },
        );

        const response = await handler.handle(
          "/",
          new URLSearchParams({ pins: "application-value" }),
          new Request(
            "https://preview-a.example/_veryfront/rsc/render?pins=application-value",
            {
              headers: { [RSC_DEPENDENCY_PINNING_HEADER]: snapshotA.cacheKey },
            },
          ),
        );
        const secondOriginResponse = await handler.handle(
          "/",
          new URLSearchParams({ pins: "application-value" }),
          new Request(
            "https://preview-b.example/_veryfront/rsc/render?pins=application-value",
            {
              headers: { [RSC_DEPENDENCY_PINNING_HEADER]: snapshotA.cacheKey },
            },
          ),
        );
        assertEquals(response.status, 200);
        assertEquals(secondOriginResponse.status, 200);
        assertEquals(
          response.headers.get("vary"),
          RSC_DEPENDENCY_PINNING_HEADER,
        );
        assertEquals(observedVersion, "1.0.0");
        assertEquals(observedServerExternalPackages, ["knex"]);
        assertEquals(observedOrigins, [
          "https://preview-a.example",
          "https://preview-b.example",
        ]);
        const payload = await response.json();
        assertEquals(payload.dependencyPinningCacheKey, snapshotA.cacheKey);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("resolves the current render token on a fresh worker", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-fresh-render-pins-" });
      const packageJsonPath = `${projectDir}/package.json`;
      const pagePath = `${projectDir}/app/page.tsx`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      await Deno.mkdir(`${projectDir}/app`);
      await Deno.writeTextFile(pagePath, `export default function Page() { return null; }`);

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
        const currentSnapshot = await getDependencyPinningSnapshot(projectDir);

        // Simulate a load-balanced worker whose in-process snapshot registry
        // has not seen the token emitted by the page-rendering worker.
        clearReactVersionCache();
        const adapter = createMockAdapter();
        adapter.fs.files.set(pagePath, `export default function Page() { return null; }`);
        let observedVersion: string | undefined;
        const renderer = {
          renderToPayload: () => Promise.resolve({ html: "<div></div>", clientRefs: {} }),
        } as unknown as RSCRenderer;
        const handler = new RenderHandler(
          projectDir,
          () => renderer,
          "development",
          "app",
          {
            runtimeAdapter: () => Promise.resolve(adapter),
            moduleLoader: (_source, _path, _projectDir, _adapter, options) => {
              observedVersion = options?.dependencyPinningDependencies?.["example-package"];
              return Promise.resolve({ default: () => null });
            },
          },
        );

        const response = await handler.handle(
          "/",
          new URLSearchParams({ pins: "application-value" }),
          new Request("http://localhost/_veryfront/rsc/render?pins=application-value", {
            headers: { [RSC_DEPENDENCY_PINNING_HEADER]: currentSnapshot.cacheKey },
          }),
        );
        const payload = await response.json();

        assertEquals(response.status, 200);
        assertEquals(observedVersion, "1.0.0");
        assertEquals(payload.dependencyPinningCacheKey, currentSnapshot.cacheKey);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("threads trusted project options into RSC MDX loading", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-local-mdx-" });
      await Deno.mkdir(`${projectDir}/app`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/app/page.mdx`, "# Local RSC page");

      const originalLoadModuleESM = mdxRenderer.loadModuleESM;
      const mutableRenderer = mdxRenderer as unknown as {
        loadModuleESM: typeof mdxRenderer.loadModuleESM;
      };
      let observedIsLocalProject: unknown;
      let observedServerExternalPackages: readonly string[] | undefined;
      mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
        const loadOptions = options as MDXLoadModuleOptions | undefined;
        observedIsLocalProject = loadOptions?.isLocalProject;
        observedServerExternalPackages = loadOptions?.serverExternalPackages;
        return Promise.resolve({ default: () => null });
      };

      try {
        const snapshot = await getDependencyPinningSnapshot(projectDir);
        const handler = new RenderHandler(
          projectDir,
          () => null,
          "development",
          "app",
          {
            adapter: denoAdapter,
            projectId: "local-project",
            projectSlug: "local-project",
            contentSourceId: "local-main",
            isLocalProject: true,
            serverExternalPackages: ["knex"],
          },
        );
        await (handler as unknown as {
          loadComponent: (
            pathname: string,
            dependencySnapshot: typeof snapshot,
            reactVersion?: string,
            moduleServerOrigin?: string,
          ) => Promise<unknown>;
        }).loadComponent("/", snapshot, "19.1.1", "http://localhost");

        assertEquals(observedIsLocalProject, true);
        assertEquals(observedServerExternalPackages, ["knex"]);
      } finally {
        mutableRenderer.loadModuleESM = originalLoadModuleESM;
        await Deno.remove(projectDir, { recursive: true });
        const esbuild = await import("veryfront/extensions/bundler");
        await esbuild.stop();
      }
    });
  });
});
