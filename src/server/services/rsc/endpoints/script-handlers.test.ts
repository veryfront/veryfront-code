import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleClientScript, handleDomScript } from "./script-handlers.ts";
import { CLIENT_BOOT_BUNDLE, CLIENT_DOM_BUNDLE } from "./rsc-bundles.generated.ts";
import { ERROR_REGISTRY } from "#veryfront/errors/error-registry.ts";
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

/**
 * Definitions a browser can never reach that the served bundle carries anyway.
 * A `port-in-use` or `release-build-timeout` in there means an import found its
 * way back to the composed registry, at which point the bundle holds all of it
 * and every future registry entry is paid for on every RSC page load.
 */
function embeddedNonGeneralSlugs(bundle: string): string[] {
  return Object.values(ERROR_REGISTRY)
    .filter((definition) => definition.category !== "GENERAL")
    .map((definition) => definition.slug)
    .filter((slug) => bundle.includes(`"${slug}"`));
}

describe("script-handlers", () => {
  describe("handleClientScript", () => {
    it("serves the compiled bundle without touching the filesystem", async () => {
      // The generated bundle is non-empty in a source checkout and in a compiled
      // binary alike, so the handler must serve it verbatim and never read source.
      let readFileCalls = 0;
      const adapter = createMockAdapter({
        readFile: () => {
          readFileCalls += 1;
          return Promise.resolve("const boot = () => {};");
        },
      });
      const response = await handleClientScript(adapter);
      assertEquals(response.status, 200, "the compiled bundle is served with 200");
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript", "the compiled bundle is JavaScript");
      assertEquals(CLIENT_BOOT_BUNDLE.length > 0, true, "the generated bundle must not be empty");
      assertEquals(
        await response.text(),
        CLIENT_BOOT_BUNDLE,
        "the pre-built bundle is served verbatim",
      );
      assertEquals(readFileCalls, 0, "the pre-built bundle must not read project source");
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

    it("does not embed unsafe eval in the compiled fallback bundle", async () => {
      const adapter = createMockAdapter();
      const response = await handleClientScript(adapter);
      const body = await response.text();

      assertEquals(body.includes('new Function("specifier"'), false);
    });

    it("does not ship server-only error definitions to the browser", async () => {
      const adapter = createMockAdapter();
      const response = await handleClientScript(adapter);
      const body = await response.text();

      // Checked before the scan, because both a failure response and an empty
      // one carry no slugs and would satisfy the assertion without the bundle
      // ever having been examined.
      assertEquals(response.ok, true);
      assertEquals(body.length > 0, true);
      assertEquals(embeddedNonGeneralSlugs(body), []);
    });
  });

  describe("handleDomScript", () => {
    it("serves the compiled bundle without touching the filesystem", async () => {
      let readFileCalls = 0;
      const adapter = createMockAdapter({
        readFile: () => {
          readFileCalls += 1;
          return Promise.resolve("const dom = () => {};");
        },
      });
      const response = await handleDomScript(adapter);
      assertEquals(response.status, 200, "the compiled bundle is served with 200");
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript", "the compiled bundle is JavaScript");
      assertEquals(CLIENT_DOM_BUNDLE.length > 0, true, "the generated bundle must not be empty");
      assertEquals(
        await response.text(),
        CLIENT_DOM_BUNDLE,
        "the pre-built bundle is served verbatim",
      );
      assertEquals(readFileCalls, 0, "the pre-built bundle must not read project source");
    });

    it("should return JavaScript content-type", async () => {
      const adapter = createMockAdapter({
        readFile: () => Promise.resolve('console.log("dom")'),
      });
      const response = await handleDomScript(adapter);
      const contentType = response.headers.get("content-type");
      assertStringIncludes(contentType ?? "", "javascript");
    });

    it("does not ship server-only error definitions to the browser", async () => {
      const adapter = createMockAdapter();
      const response = await handleDomScript(adapter);
      const body = await response.text();

      // See the client-script case: an unsuccessful or empty response would
      // pass the slug scan without proving anything about the bundle.
      assertEquals(response.ok, true);
      assertEquals(body.length > 0, true);
      assertEquals(embeddedNonGeneralSlugs(body), []);
    });
  });
});
