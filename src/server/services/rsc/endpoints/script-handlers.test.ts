import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { buildOrServeScript, handleClientScript, handleDomScript } from "./script-handlers.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

/**
 * Minimal mock adapter for script handler tests.
 * By default, readFile rejects to simulate the compiled binary
 * where source .ts files are not embedded.
 */
function createMockAdapter(
  fsOverrides: {
    readFile?: (path: string) => Promise<string>;
  } = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: fsOverrides.readFile ?? (() => Promise.reject(new Error("path not found"))),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: {
      createHandler: () => () => new Response(),
    },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

describe("script-handlers", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  const testBuildOptions = {
    bundle: true,
    write: false,
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2020",
    stdin: {
      contents: "",
      loader: "ts" as const,
      resolveDir: new URL(".", import.meta.url).pathname,
      sourcefile: "script-handler-test.ts",
    },
  };

  describe("buildOrServeScript", () => {
    it("fails closed when neither a generated bundle nor source is available", async () => {
      const response = await buildOrServeScript(
        createMockAdapter(),
        "missing-client-script.ts",
        "",
        testBuildOptions,
      );

      assertEquals(response.status, 500);
      assertEquals(await response.text(), "Required client script is unavailable.");
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    });

    it("does not serve raw TypeScript when bundling fails", async () => {
      const source = "const privateRawSourceMarker: string = ;";
      const response = await buildOrServeScript(
        createMockAdapter({ readFile: () => Promise.resolve(source) }),
        "invalid-client-script.ts",
        "",
        testBuildOptions,
      );
      const body = await response.text();

      assertEquals(response.status, 500);
      assertEquals(body.includes("privateRawSourceMarker"), false);
      assertStringIncludes(response.headers.get("content-type") ?? "", "text/plain");
    });
  });

  describe("handleClientScript", () => {
    it("should not throw when source file is missing (compiled binary)", async () => {
      // Simulates the compiled binary where client-boot.ts is not at the resolved path.
      // The handler should return a response, not throw.
      const adapter = createMockAdapter();
      const response = await handleClientScript(adapter);
      assertEquals(response.status, 200);
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript");
    });

    it("should return JavaScript content-type", async () => {
      const adapter = createMockAdapter({
        readFile: () => Promise.resolve('console.log("boot")'),
      });
      const response = await handleClientScript(adapter);
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript");
    });

    it("serves the canonical client without caching", async () => {
      const adapter = createMockAdapter();
      const response = await handleClientScript(adapter);
      assertStringIncludes(response.headers.get("cache-control") ?? "", "no-cache");
    });

    it("serves the generated bundle without reading raw source", async () => {
      let readCount = 0;
      const adapter = createMockAdapter({
        readFile: () => {
          readCount++;
          return Promise.resolve("const rawSource: string = 'not-browser-output';");
        },
      });
      const response = await handleClientScript(adapter);
      assertEquals(response.status, 200);
      const body = await response.text();
      assertEquals(body.length > 0, true);
      assertEquals(body.includes("not-browser-output"), false);
      assertEquals(readCount, 0);
    });

    it("does not embed unsafe eval in the compiled fallback bundle", async () => {
      const adapter = createMockAdapter();
      const response = await handleClientScript(adapter);
      const body = await response.text();

      assertEquals(body.includes('new Function("specifier"'), false);
    });
  });

  describe("handleDomScript", () => {
    it("should not throw when source file is missing (compiled binary)", async () => {
      const adapter = createMockAdapter();
      const response = await handleDomScript(adapter);
      assertEquals(response.status, 200);
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript");
    });

    it("should return JavaScript content-type", async () => {
      const adapter = createMockAdapter({
        readFile: () => Promise.resolve('console.log("dom")'),
      });
      const response = await handleDomScript(adapter);
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript");
    });
  });
});
