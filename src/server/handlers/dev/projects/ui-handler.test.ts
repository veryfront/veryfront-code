import "#veryfront/schemas/_test-setup.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __getProjectsUICacheSizeForTests,
  __injectProjectsUIDepsForTests,
  __resetProjectsUICacheForTests,
  handleProjectsUI,
} from "./ui-handler.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.8.0";

function injectContainedFilesystem(
  transform: (filePath: string, source: string, relativePath: string) => Promise<string> = (
    filePath,
  ) => Promise.resolve(`export default ${JSON.stringify(filePath)};`),
): void {
  __injectProjectsUIDepsForTests({
    getUiDirectory: () => "/safe/dev-ui",
    readTextFile: () => Promise.resolve("export default true;"),
    realPath: (path) => Promise.resolve(path.replace("/safe/dev-ui", "/canonical/dev-ui")),
    stat: () => Promise.resolve({ isFile: true, size: 20 }),
    transformUiModule: transform,
  });
}

afterEach(() => {
  __injectProjectsUIDepsForTests(null);
  __resetProjectsUICacheForTests();
});

describe("handleProjectsUI", () => {
  it("rejects non-local and cross-origin browser requests", async () => {
    const remote = await handleProjectsUI(
      new Request("http://devbox.example/_projects/ui/index.js"),
    );
    const crossOrigin = await handleProjectsUI(
      new Request("http://lvh.me:3000/_projects/ui/index.js", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    assertEquals(remote?.status, 401);
    assertEquals(crossOrigin?.status, 401);
    assertEquals(remote?.headers.get("cache-control"), "no-store");
    assertEquals(remote?.headers.get("x-content-type-options"), "nosniff");
  });

  it("allows only GET", async () => {
    const response = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/index.js", { method: "POST" }),
    );

    assertEquals(response?.status, 405);
    assertEquals(response?.headers.get("allow"), "GET");
  });

  it("rejects encoded traversal and oversized paths before filesystem access", async () => {
    let reads = 0;
    __injectProjectsUIDepsForTests({
      getUiDirectory: () => "/safe/dev-ui",
      readTextFile: () => {
        reads++;
        return Promise.resolve("private source");
      },
    });

    const traversal = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/..%2fsecret.js"),
    );
    const oversized = await handleProjectsUI(
      new Request(`http://lvh.me/_projects/ui/${"a".repeat(1_024)}.js`),
    );

    assertEquals(traversal?.status, 400);
    assertEquals(oversized?.status, 400);
    assertEquals(reads, 0);
  });

  it("rejects a filesystem module whose canonical path escapes the UI directory", async () => {
    let reads = 0;
    __injectProjectsUIDepsForTests({
      getUiDirectory: () => "/safe/dev-ui",
      realPath: (path) =>
        Promise.resolve(path === "/safe/dev-ui" ? "/canonical/dev-ui" : "/private/secret.tsx"),
      readTextFile: () => {
        reads++;
        return Promise.resolve("private source");
      },
    });

    const response = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/components/ProjectCard.js"),
    );

    assertEquals(response?.status, 400);
    assertEquals(reads, 0);
  });

  it("distinguishes unavailable source metadata from a missing source file", async () => {
    __injectProjectsUIDepsForTests({
      getUiDirectory: () => "/safe/dev-ui",
      realPath: (path) => {
        if (path === "/safe/dev-ui") return Promise.resolve("/canonical/dev-ui");
        return Promise.reject(new Deno.errors.PermissionDenied("denied at /private/source"));
      },
    });

    const unavailable = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/index.js"),
    );

    __injectProjectsUIDepsForTests({
      getUiDirectory: () => "/missing/dev-ui",
      realPath: () => Promise.reject(FILE_NOT_FOUND.create({ message: "missing" })),
      transformUiModule: (_filePath, _source, relativePath) =>
        Promise.resolve(`export default ${JSON.stringify(relativePath)};`),
    });
    const manifestFallback = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/index.js"),
    );

    assertEquals(unavailable?.status, 500);
    assertEquals(await unavailable?.text(), "// Projects module unavailable");
    assertEquals(manifestFallback?.status, 200);
  });

  it("passes only a logical path to transforms and keeps failures private", async () => {
    let transformPath = "";
    injectContainedFilesystem((filePath) => {
      transformPath = filePath;
      throw new Error("transform failed at /private/workspace/projects/index.tsx");
    });

    const response = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/index.js"),
    );

    assertEquals(response?.status, 500);
    assertEquals(await response?.text(), "// Projects module transform failed");
    assertEquals(transformPath, "projects/index.tsx");
    assertEquals(transformPath.includes("/safe/"), false);
  });

  it("does not attach requested module paths to handler spans", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    setGlobalTracerProvider(
      provider as unknown as Parameters<typeof setGlobalTracerProvider>[0],
    );
    injectContainedFilesystem();

    try {
      const response = await handleProjectsUI(
        new Request("http://lvh.me/_projects/ui/PRIVATE_PROJECTS_MODULE.js"),
      );
      assertEquals(response?.status, 200);
      await provider.forceFlush();

      const spans = JSON.stringify(
        exporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
        })),
      );
      assertEquals(spans.includes("PRIVATE_PROJECTS_MODULE"), false);
    } finally {
      _resetShimForTests();
      await provider.shutdown();
    }
  });

  it("bounds transformed modules retained in memory", async () => {
    injectContainedFilesystem();

    for (let index = 0; index < 160; index++) {
      const response = await handleProjectsUI(
        new Request(`http://lvh.me/_projects/ui/module-${index}.js`),
      );
      assertEquals(response?.status, 200);
    }

    assertEquals(__getProjectsUICacheSizeForTests(), 128);
  });

  it("rejects oversized transform output without caching it", async () => {
    injectContainedFilesystem(() => Promise.resolve("x".repeat(2_097_153)));

    const response = await handleProjectsUI(
      new Request("http://lvh.me/_projects/ui/index.js"),
    );

    assertEquals(response?.status, 500);
    assertEquals(__getProjectsUICacheSizeForTests(), 0);
  });
});
