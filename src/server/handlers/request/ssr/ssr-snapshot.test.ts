import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import type { SSRRenderOptions } from "../../../services/rendering/ssr.service.ts";
import { createMockAdapter, createMockSSRService, makeCtx } from "./ssr.handler.test-helpers.ts";
import { SSRHandler } from "./ssr.handler.ts";

const DEPENDENCY_PINNING_RESPONSE_HEADER = "x-veryfront-dependency-pins";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe("server/handlers/request/ssr/ssr snapshot boundary", () => {
  it("sheds preview requests without refreshing source and retains dependency pinning", async () => {
    // This fails if strict whole-tree snapshot freshness moves ahead of the
    // memory-pressure decision: the rejected response must not do refresh work.
    const projectDir = await makeTempDirWithOptions({ prefix: "vf-ssr-shed-pins-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let refreshCalls = 0;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      const adapter = createMockAdapter();
      adapter.fs.ensureSourceSnapshotFresh = () => {
        refreshCalls++;
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService({
        checkMemoryPressure: () => ({
          shouldReject: true,
          heapUsedMB: 450,
          heapLimitMB: 500,
          heapUsedPercent: 90,
        }),
      }));

      const result = await handler.handle(
        new Request("http://localhost/preview"),
        makeCtx({
          projectDir,
          adapter,
          projectSlug: "preview-project",
          requestContext: {
            token: "",
            slug: "preview-project",
            branch: "main",
            mode: "preview",
          },
        }),
      );

      assertEquals(result.response?.status, 503);
      assertEquals(refreshCalls, 0, "a shed request must not refresh the source snapshot");
      assertEquals(
        result.response?.headers.get(DEPENDENCY_PINNING_RESPONSE_HEADER)?.startsWith("on:"),
        true,
        "the shed response must retain the dependency snapshot header",
      );
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps explicit history exact, captures current for new documents, and rejects bad tokens", async () => {
    const projectDir = await makeTempDirWithOptions({ prefix: "vf-ssr-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    const observedOptions: SSRRenderOptions[] = [];

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "18.3.1" } }),
      );
      const snapshotA = await getDependencyPinningSnapshot(projectDir);

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      const future = new Date(Date.now() + 2_000);
      await Deno.utime(packageJsonPath, future, future);
      const snapshotB = await getDependencyPinningSnapshot(projectDir);
      assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

      const service = createMockSSRService({
        renderPage: (_ctx, options) => {
          observedOptions.push(options);
          const key = options.dependencyPinningCacheKey;
          return Promise.resolve({
            status: 200,
            html: `<html><body><script id="veryfront-hydration-data" type="application/json">${
              JSON.stringify({ dependencyPinningCacheKey: key })
            }</script></body></html>`,
            isStreaming: false,
            cacheStrategy: "short",
            slug: options.slug,
          });
        },
      });
      const handler = new SSRHandler(service);
      const ctx = makeCtx({ projectDir });

      const historical = await handler.handle(
        new Request(
          "http://localhost/docs?view=full&pins=app-value",
          {
            headers: {
              [DEPENDENCY_PINNING_RESPONSE_HEADER]: snapshotA.cacheKey,
            },
          },
        ),
        ctx,
      );
      const historicalBody = await historical.response!.text();

      assertEquals(historical.response?.status, 200);
      assertEquals(
        historical.response?.headers.get(DEPENDENCY_PINNING_RESPONSE_HEADER),
        snapshotA.cacheKey,
      );
      assertStringIncludes(
        historicalBody,
        JSON.stringify({ dependencyPinningCacheKey: snapshotA.cacheKey }),
      );
      assertEquals(observedOptions[0]?.dependencyPinningCacheKey, snapshotA.cacheKey);
      assertEquals(observedOptions[0]?.dependencyPinningDependencies?.react, "18.3.1");
      assertEquals(
        observedOptions[0]?.url.href,
        "http://localhost/docs?view=full&pins=app-value",
      );
      assertEquals(
        observedOptions[0]?.request.url,
        "http://localhost/docs?view=full&pins=app-value",
      );
      assertEquals(
        observedOptions[0]?.request.headers.get(
          DEPENDENCY_PINNING_RESPONSE_HEADER,
        ),
        null,
      );
      assertEquals(
        historical.response?.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_RESPONSE_HEADER,
        ),
        true,
      );

      const current = await handler.handle(
        new Request(
          "http://localhost/docs?view=current&pins=another-app-value",
        ),
        ctx,
      );
      assertEquals(current.response?.status, 200);
      assertEquals(
        current.response?.headers.get(DEPENDENCY_PINNING_RESPONSE_HEADER),
        snapshotB.cacheKey,
      );
      assertEquals(observedOptions[1]?.dependencyPinningCacheKey, snapshotB.cacheKey);
      assertEquals(observedOptions[1]?.dependencyPinningDependencies?.react, "19.2.4");
      assertEquals(
        observedOptions[1]?.url.href,
        "http://localhost/docs?view=current&pins=another-app-value",
      );

      const unknown = await handler.handle(
        new Request("http://localhost/docs?pins=app-value", {
          headers: {
            [DEPENDENCY_PINNING_RESPONSE_HEADER]: "on:unknown",
          },
        }),
        ctx,
      );
      assertEquals(unknown.response?.status, 409);
      assertEquals(unknown.response?.headers.get("cache-control"), "no-store");
      assertEquals(
        unknown.response?.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_RESPONSE_HEADER,
        ),
        true,
      );

      const malformed = await handler.handle(
        new Request("http://localhost/docs?pins=app-a&pins=app-b", {
          headers: {
            [DEPENDENCY_PINNING_RESPONSE_HEADER]: `${snapshotA.cacheKey}, ${snapshotA.cacheKey}`,
          },
        }),
        ctx,
      );
      assertEquals(malformed.response?.status, 409);
      assertEquals(malformed.response?.headers.get("cache-control"), "no-store");
      assertEquals(observedOptions.length, 2);
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps application pins visible and adds no snapshot header while disabled", async () => {
    const projectDir = await makeTempDirWithOptions({ prefix: "vf-ssr-pins-off-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedOptions: SSRRenderOptions | undefined;

    try {
      deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      clearReactVersionCache();
      const service = createMockSSRService({
        renderPage: (_ctx, options) => {
          observedOptions = options;
          return Promise.resolve({
            status: 200,
            html: "<html><body>off</body></html>",
            isStreaming: false,
            cacheStrategy: "short",
            slug: options.slug,
          });
        },
      });
      const handler = new SSRHandler(service);

      const result = await handler.handle(
        new Request("http://localhost/?pins=app-value"),
        makeCtx({ projectDir }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(observedOptions?.dependencyPinningCacheKey, "off");
      assertEquals(
        observedOptions?.url.href,
        "http://localhost/?pins=app-value",
      );
      assertEquals(
        observedOptions?.request.url,
        "http://localhost/?pins=app-value",
      );
      assertEquals(
        result.response?.headers.get(DEPENDENCY_PINNING_RESPONSE_HEADER),
        null,
      );
      assertEquals(
        result.response?.headers.get("vary")?.toLowerCase().includes(
          DEPENDENCY_PINNING_RESPONSE_HEADER,
        ),
        true,
      );
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
