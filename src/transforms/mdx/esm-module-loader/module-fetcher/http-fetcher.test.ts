import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";
import { MAX_MDX_MODULE_CODE_BYTES, MAX_MDX_MODULE_TRANSFORM_CONCURRENCY } from "./limits.ts";
import { HttpModuleBodyTooLargeError } from "../../../shared/http-module-response.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { buildMissingModuleError } from "../missing-module.ts";

describe("module-fetcher/http-fetcher", () => {
  it("falls back to bare localhost, carrying the project slug, when the subdomain will not resolve", async () => {
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: (k: string) => (k === "VERYFRONT_DEV_PORT" ? "3001" : undefined) },
    } as RuntimeAdapter;

    const attempts: { url: string; projectSlug: string | null }[] = [];
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const projectSlug = new Headers(init?.headers).get("x-project-slug");
      attempts.push({ url, projectSlug });
      if (attempts.length === 1) {
        // Shape of a Deno resolver failure on a glibc-only NSS setup.
        return Promise.reject(
          new TypeError("error sending request: dns error: failed to lookup address"),
        );
      }
      return Promise.resolve(new Response("export const ok = 1;"));
    }) as unknown as typeof fetch;

    await fetchModuleViaHTTP("mod.js", adapter, async () => null, logger, "docs", true, undefined, {
      fetchFn,
    });

    assertEquals(attempts.length, 2);
    assertEquals(new URL(attempts[0]!.url).hostname, "docs.localhost");
    assertEquals(attempts[0]!.projectSlug, null);
    // The retry must reach a name that always resolves, without losing the tenant.
    assertEquals(new URL(attempts[1]!.url).hostname, "localhost");
    assertEquals(attempts[1]!.projectSlug, "docs");
  });

  it("does not retry when the fetch was aborted", async () => {
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: { get: (k: string) => (k === "VERYFRONT_DEV_PORT" ? "3001" : undefined) },
    } as RuntimeAdapter;

    let calls = 0;
    const fetchFn = (() => {
      calls += 1;
      return Promise.reject(new DOMException("Local module fetch timed out", "AbortError"));
    }) as unknown as typeof fetch;

    await assertRejects(() =>
      fetchModuleViaHTTP("mod.js", adapter, async () => null, logger, "docs", true, undefined, {
        fetchFn,
      })
    );
    // A timeout must not be re-issued against localhost; that would double the wait.
    assertEquals(calls, 1);
  });

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

  it("preserves side-effect import syntax in the HTTP fallback", async () => {
    const fetchedPaths: string[] = [];
    const result = await fetchModuleViaHTTP(
      "_vf_modules/pages/index.js",
      { env: { get: () => undefined } } as unknown as RuntimeAdapter,
      (path) => {
        fetchedPaths.push(path);
        return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
      },
      { debug: () => {}, warn: () => {} } as unknown as Logger,
      "docs",
      true,
      undefined,
      {
        fetchFn: (() =>
          Promise.resolve(
            new Response([
              `import "/_vf_modules/setup.js";`,
              `export const ready = true;`,
            ].join("\n")),
          )) as typeof fetch,
      },
    );

    assertEquals(fetchedPaths, ["_vf_modules/setup.js"]);
    assertEquals(
      result,
      [
        `import "file:///cache/_vf_modules__setup.js.mjs";`,
        `export const ready = true;`,
      ].join("\n"),
    );
  });

  it("preserves suffixes while mapping nested HTTP fallback imports", async () => {
    const fetchedPaths: string[] = [];
    const result = await fetchModuleViaHTTP(
      "_vf_modules/pages/index.js",
      { env: { get: () => undefined } } as unknown as RuntimeAdapter,
      (path) => {
        fetchedPaths.push(path);
        return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
      },
      { debug: () => {}, warn: () => {} } as unknown as Logger,
      "docs",
      true,
      undefined,
      {
        fetchFn: (() =>
          Promise.resolve(
            new Response([
              `import data from "/_vf_modules/data.json?raw#payload";`,
              `import "/_vf_modules/setup.js#bootstrap";`,
              `export const lazy = () => import("./Lazy.js?client");`,
            ].join("\n")),
          )) as typeof fetch,
      },
    );

    assertEquals(fetchedPaths, [
      "_vf_modules/data.json",
      "_vf_modules/setup.js",
      "./Lazy.js",
    ]);
    assertEquals(
      result,
      [
        `import data from "file:///cache/_vf_modules__data.json.mjs?raw#payload";`,
        `import "file:///cache/_vf_modules__setup.js.mjs#bootstrap";`,
        `export const lazy = () => import("file:///cache/.__Lazy.js.mjs?client");`,
      ].join("\n"),
    );
  });

  it("defers a missing dynamic import fetched through the HTTP fallback", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-http-dynamic-cache-" });
    const source =
      `export const load = (enabled) => enabled ? import("./optional.js") : Promise.resolve("skipped");`;

    try {
      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/index.js",
        { env: { get: () => undefined } } as unknown as RuntimeAdapter,
        (path) => {
          throw buildMissingModuleError({
            modulePath: path,
            importer: "_vf_modules/pages/index.js",
            importStatement: `import("./optional.js")`,
            code: source,
            projectSlug: "docs",
          });
        },
        { debug: () => {}, warn: () => {} } as unknown as Logger,
        "docs",
        true,
        undefined,
        {
          esmCacheDir,
          fetchFn: (() => Promise.resolve(new Response(source))) as typeof fetch,
          strictMissingModules: true,
        },
      );
      const parentPath = join(esmCacheDir, "http-parent.mjs");
      await Deno.writeTextFile(parentPath, result!);
      const loaded = await import(
        `${toFileUrl(parentPath).href}?test=${crypto.randomUUID()}`
      ) as { load(enabled: boolean): Promise<unknown> };

      assertEquals(await loaded.load(false), "skipped");
      await assertRejects(
        () => loaded.load(true),
        Error,
        "Missing module: ./optional.js",
      );
    } finally {
      await remove(esmCacheDir, { recursive: true });
    }
  });

  // A single-quoted specifier may legally contain a double quote, and a cache
  // path may contain a backslash. Interpolating either into a hand-written
  // double-quoted literal emits a module that fails to parse, which takes down
  // every other import in the file, not just the offending one.
  it("escapes quotes and backslashes in emitted HTTP fallback import literals", async () => {
    const result = await fetchModuleViaHTTP(
      "_vf_modules/pages/index.js",
      { env: { get: () => undefined } } as unknown as RuntimeAdapter,
      () => Promise.resolve(`/cache/we"ird\\path.mjs`),
      { debug: () => {}, warn: () => {} } as unknown as Logger,
      "docs",
      true,
      undefined,
      {
        fetchFn: (() =>
          Promise.resolve(
            new Response([
              `import a from '/_vf_modules/a.js?label="x"';`,
              `import '/_vf_modules/b.js?label="y"';`,
              `export const lazy = () => import('./c.js?label="z"');`,
            ].join("\n")),
          )) as typeof fetch,
      },
    );

    assertEquals(
      result,
      [
        `import a from "file:///cache/we\\"ird\\\\path.mjs?label=\\"x\\"";`,
        `import "file:///cache/we\\"ird\\\\path.mjs?label=\\"y\\"";`,
        `export const lazy = () => import("file:///cache/we\\"ird\\\\path.mjs?label=\\"z\\"");`,
      ].join("\n"),
    );
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
