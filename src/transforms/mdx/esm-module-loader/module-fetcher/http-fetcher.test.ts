import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";
import { MAX_MDX_MODULE_CODE_BYTES, MAX_MDX_MODULE_TRANSFORM_CONCURRENCY } from "./limits.ts";
import { HttpModuleBodyTooLargeError } from "../../../shared/http-module-response.ts";

describe("module-fetcher/http-fetcher", () => {
  it("rewrites the matched import instead of the same text in an earlier comment", async () => {
    const originalFetch = globalThis.fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          if (key === "VERYFRONT_DEV_PORT") return "3001";
          return undefined;
        },
      },
    } as RuntimeAdapter;

    try {
      let requestedUrl = "";
      globalThis.fetch = async (input) => {
        requestedUrl = String(input);
        return await Promise.resolve(
          new Response([
            `// Previous example: from "./local.js"`,
            `import local from "./local.js";`,
            `export { local };`,
          ].join("\n")),
        );
      };

      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/index.js",
        adapter,
        (path) => Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`),
        logger,
        "docs",
        true,
        "on:pins-a",
      );

      assertEquals(
        result,
        [
          `// Previous example: from "./local.js"`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { local };`,
        ].join("\n"),
      );
      assertEquals(
        requestedUrl,
        "http://docs.localhost:3001/_vf_modules/pages/index.js?ssr=true&pins=on%3Apins-a",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the request origin for pinned local module fetches", async () => {
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          if (key === "VERYFRONT_DEV_PORT") return "3001";
          return undefined;
        },
      },
    } as RuntimeAdapter;
    let requestedUrl = "";

    const result = await fetchModuleViaHTTP(
      "_vf_modules/shared/Absolute.js",
      adapter,
      (path) => Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`),
      logger,
      "docs",
      true,
      "on:pins-a",
      {
        moduleServerOrigin: "http://93.184.216.34:3000",
        fetchFn: ((input) => {
          requestedUrl = String(input);
          return Promise.resolve(new Response(`export const value = "abs";`));
        }) as typeof fetch,
      },
    );

    assertEquals(result, `export const value = "abs";`);
    assertEquals(
      requestedUrl,
      "http://93.184.216.34:3000/_vf_modules/shared/Absolute.js?ssr=true&pins=on%3Apins-a",
    );
  });

  it("uses an explicit module server origin without validating fallback host inputs", async () => {
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          return key === "PORT" ? "not-a-port" : undefined;
        },
      },
    } as RuntimeAdapter;
    let requestedUrl = "";

    const result = await fetchModuleViaHTTP(
      "_vf_modules/shared/Explicit.js",
      adapter,
      () => Promise.resolve(null),
      logger,
      "docs.example",
      true,
      undefined,
      {
        moduleServerOrigin: "https://preview.example.test:8443",
        fetchFn: ((input) => {
          requestedUrl = String(input);
          return Promise.resolve(new Response(`export const value = "explicit";`));
        }) as typeof fetch,
      },
    );

    assertEquals(result, `export const value = "explicit";`);
    assertEquals(
      requestedUrl,
      "https://preview.example.test:8443/_vf_modules/shared/Explicit.js?ssr=true",
    );
  });

  it("strips credentials, path, query, and fragment from the module server origin", async () => {
    const warnings: string[] = [];
    const logger = {
      debug: () => {},
      warn: (message: string) => warnings.push(message),
    } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          if (key === "VERYFRONT_DEV_PORT") return "3001";
          return undefined;
        },
      },
    } as RuntimeAdapter;
    let requestedUrl = "";

    const result = await fetchModuleViaHTTP(
      "_vf_modules/shared/Secret.js",
      adapter,
      () => Promise.resolve(null),
      logger,
      "docs",
      true,
      "on:pins-a",
      {
        moduleServerOrigin:
          "https://user:pass@example.test:8443/debug/source.js?token=secret#fragment",
        fetchFn: ((input) => {
          requestedUrl = String(input);
          return Promise.resolve(new Response("missing", { status: 404 }));
        }) as typeof fetch,
      },
    );

    assertEquals(result, null);
    assertEquals(
      requestedUrl,
      "https://example.test:8443/_vf_modules/shared/Secret.js?ssr=true&pins=on%3Apins-a",
    );
    assertEquals(warnings.length, 1);
    assertEquals(warnings[0]?.includes("user:pass"), false);
    assertEquals(warnings[0]?.includes("token=secret"), false);
    assertEquals(warnings[0]?.includes("#fragment"), false);
  });

  it("resolves nested HTTP imports with bounded concurrency", async () => {
    const importCount = MAX_MDX_MODULE_TRANSFORM_CONCURRENCY + 4;
    const moduleCode = Array.from(
      { length: importCount },
      (_, index) => `import value${index} from "./dependency-${index}.js";`,
    ).join("\n");
    let active = 0;
    let peak = 0;

    const result = await fetchModuleViaHTTP(
      "_vf_modules/pages/index.js",
      { env: { get: () => undefined } } as unknown as RuntimeAdapter,
      async (path) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return `/cache/${path.replaceAll("/", "__")}.mjs`;
      },
      { debug: () => {}, warn: () => {} } as unknown as Logger,
      "docs",
      true,
      undefined,
      { fetchFn: (() => Promise.resolve(new Response(moduleCode))) as typeof fetch },
    );

    assertEquals(peak, MAX_MDX_MODULE_TRANSFORM_CONCURRENCY);
    assertEquals(result?.includes("file:///cache/.__dependency-0.js.mjs"), true);
  });

  it("rejects and cancels an oversized local module response", async () => {
    let cancelled = false;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () =>
        fetchModuleViaHTTP(
          "_vf_modules/pages/index.js",
          adapter,
          () => Promise.resolve(null),
          logger,
          "docs",
          true,
          undefined,
          {
            fetchFn: (() =>
              Promise.resolve(
                new Response(
                  new ReadableStream({
                    cancel() {
                      cancelled = true;
                    },
                  }),
                  {
                    headers: {
                      "content-length": String(MAX_MDX_MODULE_CODE_BYTES + 1),
                    },
                  },
                ),
              )) as typeof fetch,
          },
        ),
      HttpModuleBodyTooLargeError,
      `exceeds ${MAX_MDX_MODULE_CODE_BYTES} bytes`,
    );
    assertEquals(cancelled, true);
  });

  it("times out and cancels a stalled local module body", async () => {
    let cancelled = false;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () =>
        fetchModuleViaHTTP(
          "_vf_modules/pages/index.js",
          adapter,
          () => Promise.resolve(null),
          logger,
          "docs",
          true,
          undefined,
          {
            timeoutMs: 5,
            fetchFn: (() =>
              Promise.resolve(
                new Response(
                  new ReadableStream({
                    pull() {
                      return new Promise(() => {});
                    },
                    cancel() {
                      cancelled = true;
                    },
                  }),
                ),
              )) as typeof fetch,
          },
        ),
      DOMException,
      "timed out after 5ms",
    );
    assertEquals(cancelled, true);
  });

  it("rejects an invalid local development port before fetching", async () => {
    let fetched = false;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          return key === "PORT" ? "not-a-port" : undefined;
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () =>
        fetchModuleViaHTTP(
          "_vf_modules/pages/index.js",
          adapter,
          () => Promise.resolve(null),
          logger,
          "docs.example",
          true,
          undefined,
          {
            fetchFn: (() => {
              fetched = true;
              return Promise.resolve(new Response(""));
            }) as typeof fetch,
          },
        ),
      TypeError,
    );
    assertEquals(fetched, false);
  });

  it("rejects an invalid project slug before fetching", async () => {
    let fetched = false;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () =>
        fetchModuleViaHTTP(
          "_vf_modules/pages/index.js",
          adapter,
          () => Promise.resolve(null),
          logger,
          "docs.example",
          true,
          undefined,
          {
            fetchFn: (() => {
              fetched = true;
              return Promise.resolve(new Response(""));
            }) as typeof fetch,
          },
        ),
      TypeError,
      "valid DNS label",
    );
    assertEquals(fetched, false);
  });
});
