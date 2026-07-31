import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createScriptHandlers, handleClientScript, handleDomScript } from "./script-handlers.ts";
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
      readFile: fsOverrides.readFile ??
        (() =>
          Promise.reject(
            Object.assign(new Error("path not found"), { code: "ENOENT" }),
          )),
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
  describe("handleClientScript", () => {
    it("serves the generated first-party bundle without reading source", async () => {
      let sourceReads = 0;
      const adapter = createMockAdapter({
        readFile: () => {
          sourceReads++;
          return Promise.reject(new Error("source should not be read"));
        },
      });
      const response = await handleClientScript(adapter);

      assertEquals(response.status, 200);
      assertStringIncludes(response.headers.get("content-type") ?? "", "javascript");
      assertEquals(sourceReads, 0);
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

    it("uses the explicitly loaded Bundler extension for a development build", async () => {
      const handlers = createScriptHandlers({
        clientBundle: "",
        loadBundler: () =>
          Promise.resolve(
            {
              build: () =>
                Promise.resolve({
                  outputFiles: [{ text: 'console.log("bundled")' }],
                }),
            } as unknown as typeof import("veryfront/extensions/bundler"),
          ),
      });
      const adapter = createMockAdapter({
        readFile: () => Promise.resolve("const boot: boolean = true;"),
      });
      const response = await handlers.handleClientScript(adapter);

      assertEquals(response.status, 200);
      assertEquals(await response.text(), 'console.log("bundled")');
      assertStringIncludes(response.headers.get("content-type") ?? "", "javascript");
    });

    it("returns a no-store 404 when development source is genuinely missing", async () => {
      const handlers = createScriptHandlers({ clientBundle: "" });
      const response = await handlers.handleClientScript(createMockAdapter());

      assertEquals(response.status, 404);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(await response.text(), "Not Found");
    });

    it("sanitizes operational source read failures as no-store 500", async () => {
      const handlers = createScriptHandlers({ clientBundle: "" });
      const adapter = createMockAdapter({
        readFile: () => Promise.reject(new Error("storage credential leaked")),
      });
      const response = await handlers.handleClientScript(adapter);
      const body = await response.text();

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(body, "Internal Server Error");
      assertEquals(body.includes("credential"), false);
      assertEquals(body.includes("source not available"), false);
    });

    it("does not serve raw TypeScript when Bundler loading fails", async () => {
      let sourceReads = 0;
      const handlers = createScriptHandlers({
        clientBundle: "",
        loadBundler: () => Promise.reject(new Error("extension import secret")),
      });
      const adapter = createMockAdapter({
        readFile: () => {
          sourceReads++;
          return Promise.resolve("const typed: string = 'raw secret';");
        },
      });
      const response = await handlers.handleClientScript(adapter);
      const body = await response.text();

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(response.headers.get("content-type"), "text/plain; charset=utf-8");
      assertEquals(body, "Internal Server Error");
      assertEquals(sourceReads, 1);
      assertEquals(body.includes("raw secret"), false);
      assertEquals(body.includes("extension import secret"), false);
    });

    it("does not serve raw TypeScript when the Bundler build rejects", async () => {
      let stopped = 0;
      const handlers = createScriptHandlers({
        clientBundle: "",
        loadBundler: () =>
          Promise.resolve(
            {
              build: () => Promise.reject(new Error("build internals leaked")),
              stop: () => {
                stopped++;
                return Promise.resolve();
              },
            } as unknown as typeof import("veryfront/extensions/bundler"),
          ),
      });
      const response = await handlers.handleClientScript(
        createMockAdapter({
          readFile: () => Promise.resolve("const typed: string = 'raw secret';"),
        }),
      );
      const body = await response.text();

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(body, "Internal Server Error");
      assertEquals(body.includes("raw secret"), false);
      assertEquals(body.includes("build internals"), false);
      assertEquals(stopped, 1);
    });

    it("keeps dependencies isolated across concurrently used handler instances", async () => {
      const first = createScriptHandlers({ clientBundle: 'console.log("first")' });
      const second = createScriptHandlers({ clientBundle: 'console.log("second")' });

      const [firstResponse, secondResponse] = await Promise.all([
        first.handleClientScript(createMockAdapter()),
        second.handleClientScript(createMockAdapter()),
      ]);

      assertEquals(await firstResponse.text(), 'console.log("first")');
      assertEquals(await secondResponse.text(), 'console.log("second")');
    });

    it("decodes file-URL paths before reading development source", async () => {
      let sourcePath = "";
      const handlers = createScriptHandlers({
        clientBundle: "",
        moduleUrl:
          "file:///workspace%20source/src/server/services/rsc/endpoints/script-handlers.ts",
      });
      const response = await handlers.handleClientScript(
        createMockAdapter({
          readFile: (path) => {
            sourcePath = path;
            return Promise.reject(
              Object.assign(new Error("path not found"), { code: "ENOENT" }),
            );
          },
        }),
      );

      assertEquals(response.status, 404);
      assertEquals(sourcePath, "/workspace source/src/rendering/rsc/client-boot.ts");
    });

    it("converts Windows file URLs with the platform path converter", async () => {
      if (Deno.build.os !== "windows") return;

      let sourcePath = "";
      const handlers = createScriptHandlers({
        clientBundle: "",
        moduleUrl: "file:///C:/workspace/src/server/services/rsc/endpoints/script-handlers.ts",
      });
      await handlers.handleClientScript(
        createMockAdapter({
          readFile: (path) => {
            sourcePath = path;
            return Promise.reject(
              Object.assign(new Error("path not found"), { code: "ENOENT" }),
            );
          },
        }),
      );

      assertEquals(sourcePath, String.raw`C:\workspace\src\rendering\rsc\client-boot.ts`);
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
