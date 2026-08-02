import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";
import { MAX_MDX_MODULE_CODE_BYTES } from "./limits.ts";
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
        "http://docs.lvh.me:3001/_vf_modules/pages/index.js?ssr=true&pins=on%3Apins-a",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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
