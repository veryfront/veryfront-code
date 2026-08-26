import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  installMockFetch,
  observeFetchRequestInit,
  restoreMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { computeIntegrity, type LockfileManager } from "#veryfront/utils";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { createHTTPPlugin } from "./esbuild-plugin.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type {
  OnLoadArgs,
  OnResolveArgs,
  PluginBuild,
  ResolveResult,
} from "veryfront/extensions/bundler";

function createMockBuild(
  onResolve: PluginBuild["onResolve"],
  onLoad: PluginBuild["onLoad"],
): PluginBuild {
  const resolveResult: ResolveResult = {
    errors: [],
    warnings: [],
    path: "",
    external: false,
    sideEffects: false,
    namespace: "",
    pluginData: null,
  };

  return {
    initialOptions: {},
    resolve: () => Promise.resolve(resolveResult),
    onStart: () => {},
    onEnd: () => {},
    onResolve,
    onLoad,
    onDispose: () => {},
    esbuild,
  } as unknown as PluginBuild;
}

describe("routing/api/module-loader/esbuild-plugin", () => {
  describe("createHTTPPlugin()", () => {
    it("should create a plugin with correct name", () => {
      const plugin = createHTTPPlugin([]);
      assertEquals(plugin.name, "vf-api-http-fetch");
    });

    it("should accept array shorthand for allowed hosts", () => {
      const plugin = createHTTPPlugin(["https://esm.sh"]);
      assertExists(plugin.setup);
    });

    it("should accept options object", () => {
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        strict: true,
      });
      assertExists(plugin.setup);
    });

    it("should have a setup function", () => {
      const plugin = createHTTPPlugin([]);
      assertEquals(typeof plugin.setup, "function");
    });

    it("should register onResolve and onLoad handlers during setup", () => {
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });

      const resolveHandlers: Array<{ filter: RegExp }> = [];
      const loadHandlers: Array<{ filter: RegExp; namespace?: string }> = [];

      const mockBuild = createMockBuild(
        (opts) => {
          resolveHandlers.push(opts);
        },
        (opts) => {
          loadHandlers.push(opts);
        },
      );

      plugin.setup(mockBuild);

      assertEquals(resolveHandlers.length >= 3, true);
      assertEquals(loadHandlers.length >= 1, true);
    });

    it("should register HTTP URL resolver for http:// and https:// patterns", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const httpFilter = resolveFilters[0];
      assertExists(httpFilter);
      assertEquals(httpFilter.test("https://esm.sh/react"), true);
      assertEquals(httpFilter.test("http://cdn.example.com/lib.js"), true);
      assertEquals(httpFilter.test("HTTPS://esm.sh/react"), true);
      assertEquals(httpFilter.test("HTTP://cdn.example.com/lib.js"), true);
    });

    it("should register React JSX runtime resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolvers: Array<{
        filter: RegExp;
        fn: (args: OnResolveArgs) => unknown;
      }> = [];
      const mockBuild = createMockBuild(
        (opts, fn) => {
          resolvers.push({ filter: opts.filter, fn });
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const reactResolver = resolvers[1];
      assertExists(reactResolver);
      assertEquals(reactResolver.filter.test("react/jsx-runtime"), true);
      assertEquals(reactResolver.filter.test("react/jsx-dev-runtime"), true);

      const resolve = (path: string) =>
        reactResolver.fn({
          path,
          importer: "",
          namespace: "",
          resolveDir: "",
          kind: "import-statement",
          pluginData: undefined,
        });

      assertEquals(
        resolve("react/jsx-runtime"),
        { path: "https://esm.sh/react@18/jsx-runtime", namespace: "http-url" },
        "JSX runtime must map to the pinned React 18 runtime in the http-url namespace",
      );
      assertEquals(
        resolve("react/jsx-dev-runtime"),
        { path: "https://esm.sh/react@18/jsx-dev-runtime", namespace: "http-url" },
        "JSX dev runtime must map to the pinned React 18 dev runtime in the http-url namespace",
      );
    });

    it("should register Node core module resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const nodeFilter = resolveFilters[2];
      assertExists(nodeFilter);
      assertEquals(nodeFilter.test("node:path"), true);
      assertEquals(nodeFilter.test("node:fs"), true);
      assertEquals(nodeFilter.test("buffer"), true);
      assertEquals(nodeFilter.test("path"), true);
      assertEquals(nodeFilter.test("fs"), true);
    });

    it("should return external: true for bare Node builtins", () => {
      const plugin = createHTTPPlugin([]);

      const resolvers: Array<{
        filter: RegExp;
        fn: (args: OnResolveArgs) => unknown;
      }> = [];

      const mockBuild = createMockBuild(
        (opts, fn) => {
          resolvers.push({ filter: opts.filter, fn });
        },
        () => {},
      );

      plugin.setup(mockBuild);

      // Find the Node builtin resolver (3rd registered)
      const nodeResolver = resolvers[2];
      assertExists(nodeResolver);

      const bareBuiltins = ["fs", "http", "crypto", "path", "buffer", "stream", "url", "util"];
      for (const name of bareBuiltins) {
        const result = nodeResolver.fn({
          path: name,
          importer: "",
          namespace: "",
          resolveDir: "",
          kind: "import-statement",
          pluginData: undefined,
        }) as { path: string; external: boolean };

        assertEquals(result.external, true, `Expected ${name} to be marked external`);
        assertEquals(result.path, name, `Expected path to be "${name}"`);
      }
    });

    it("should return external: true for node:-prefixed imports", () => {
      const plugin = createHTTPPlugin([]);

      const resolvers: Array<{
        filter: RegExp;
        fn: (args: OnResolveArgs) => unknown;
      }> = [];

      const mockBuild = createMockBuild(
        (opts, fn) => {
          resolvers.push({ filter: opts.filter, fn });
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const nodeResolver = resolvers[2];
      assertExists(nodeResolver);

      const prefixedBuiltins = ["node:fs", "node:path", "node:crypto", "node:http"];
      for (const name of prefixedBuiltins) {
        const result = nodeResolver.fn({
          path: name,
          importer: "",
          namespace: "",
          resolveDir: "",
          kind: "import-statement",
          pluginData: undefined,
        }) as { path: string; external: boolean };

        assertEquals(result.external, true, `Expected ${name} to be marked external`);
        assertEquals(result.path, name, `Expected path to be "${name}"`);
      }
    });

    it("should not match non-builtin module names", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const nodeFilter = resolveFilters[2];
      assertExists(nodeFilter);

      // These should NOT match the Node builtin pattern
      assertEquals(nodeFilter.test("pdf-parse"), false);
      assertEquals(nodeFilter.test("lodash"), false);
      assertEquals(nodeFilter.test("express"), false);
      assertEquals(nodeFilter.test("fsevents"), false); // starts with "fs" but is not "fs"
    });

    it("should resolve HTTP URLs to http-url namespace", () => {
      const plugin = createHTTPPlugin([]);

      const resolvers: Array<{
        filter: RegExp;
        fn: (args: OnResolveArgs) => unknown;
      }> = [];

      const mockBuild = createMockBuild(
        (opts, fn) => {
          resolvers.push({ filter: opts.filter, fn });
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const httpResolver = resolvers.find((r) => r.filter.test("https://esm.sh/react"));
      assertExists(httpResolver);

      const result = httpResolver.fn({
        path: "https://esm.sh/react",
        importer: "",
        namespace: "",
        resolveDir: "",
        kind: "import-statement",
        pluginData: undefined,
      });

      assertEquals((result as { path: string }).path, "https://esm.sh/react");
      assertEquals((result as { namespace: string }).namespace, "http-url");
    });

    it("blocks prefix-domain bypasses of the allowed host list", async () => {
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);

      try {
        installMockFetch(
          (() => {
            throw new Error("disallowed host should not be fetched");
          }) as typeof fetch,
        );

        const result = await loadHandler({
          path: "https://esm.sh.evil.example/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        const errors = (result as { errors?: Array<{ text: string }> }).errors;
        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("Remote import blocked by allow-list"), true);
      } finally {
        restoreMockFetch();
      }
    });

    it("blocks every remote module when the allowed host list is empty", async () => {
      let fetchCalls = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin([]);
      plugin.setup(createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      ));
      assertExists(loadHandler);

      try {
        installMockFetch(
          (() => {
            fetchCalls += 1;
            return Promise.resolve(new Response("unexpected"));
          }) as typeof fetch,
        );
        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        const errors = (result as { errors?: Array<{ text: string }> }).errors;
        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("Remote import blocked by allow-list"), true);
        assertEquals(fetchCalls, 0);
      } finally {
        restoreMockFetch();
      }
    });

    it("validates executable capabilities in a fetched remote module", async () => {
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin(["https://esm.sh"]);
      plugin.setup(createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      ));
      assertExists(loadHandler);

      try {
        installMockFetch(
          (async () =>
            new Response(`export const load = (url) => import(url);`, {
              status: 200,
            })) as typeof fetch,
        );
        await assertRejects(
          async () =>
            await loadHandler!({
              path: "https://esm.sh/unsafe-module",
              namespace: "http-url",
              pluginData: undefined,
              suffix: "",
            }),
          Error,
          "unconstrained dynamic import",
          "remote source must be validated after fetching, not only its URL",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("preserves the fetched remote module URL while bundling", async () => {
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin(["https://esm.sh"]);
      plugin.setup(createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      ));
      assertExists(loadHandler);

      const resolvedUrl = "https://esm.sh/module?target=es2020&bundle=true";
      try {
        installMockFetch(
          (async () => {
            return new Response(`export const moduleUrl = import.meta.url;`, {
              status: 200,
            });
          }) as typeof fetch,
        );
        const result = await loadHandler({
          path: "https://esm.sh/module",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals(
          (result as { contents: string }).contents,
          `export const moduleUrl = ${JSON.stringify(resolvedUrl)};`,
          "a remote dependency must not resolve import.meta.url to the requesting route",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("rejects local Worker entries declared by a fetched remote module", async () => {
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin(["https://esm.sh"]);
      plugin.setup(createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      ));
      assertExists(loadHandler);

      try {
        installMockFetch(
          (async () =>
            new Response(
              `new Worker("./worker.ts", { type: "module" }); export const ok = true;`,
              { status: 200 },
            )) as typeof fetch,
        );
        await assertRejects(
          async () =>
            await loadHandler!({
              path: "https://esm.sh/module-with-worker",
              namespace: "http-url",
              pluginData: undefined,
              suffix: "",
            }),
          Error,
          "local Worker",
          "a remote module's relative Worker graph cannot escape source validation",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("blocks internal module targets before invoking fetch", async () => {
      let fetchCalls = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin(["http://169.254.169.254"]);
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);

      try {
        installMockFetch(
          (() => {
            fetchCalls += 1;
            return Promise.resolve(new Response("unexpected"));
          }) as typeof fetch,
        );
        const result = await loadHandler({
          path: "http://169.254.169.254/module.js",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;
        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("internal host"), true);
        assertEquals(fetchCalls, 0);
      } finally {
        restoreMockFetch();
      }
    });

    it("reapplies the remote-host allow-list to redirects", async () => {
      let fetchCalls = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://93.184.216.34"] });
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);

      try {
        installMockFetch(
          (() => {
            fetchCalls += 1;
            return Promise.resolve(
              new Response(null, {
                status: 302,
                headers: { location: "https://93.184.216.35/module.js" },
              }),
            );
          }) as typeof fetch,
        );
        const result = await loadHandler({
          path: "https://93.184.216.34/module.js",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;
        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("Remote import blocked by allow-list"), true);
        assertEquals(fetchCalls, 1);
      } finally {
        restoreMockFetch();
      }
    });

    it("serves a previously fetched remote module when the CDN later returns an error", async () => {
      const projectDir = await Deno.makeTempDir();
      const moduleSource = "export const parsed = true;";
      const requestUrl = "https://esm.sh/yaml@2";
      const resolvedUrl = "https://esm.sh/yaml@2?target=es2020&bundle=true";

      const load = (fetchImpl: typeof fetch) => {
        installMockFetch(fetchImpl);
        let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
        const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"], projectDir });
        const mockBuild = createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        );
        plugin.setup(mockBuild);
        assertExists(loadHandler);
        return loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
      };

      try {
        const first = await load(
          (async () =>
            new Response(moduleSource, {
              status: 200,
              headers: { "content-type": "application/javascript" },
            })) as typeof fetch,
        );
        assertEquals((first as { contents: string }).contents, moduleSource);

        const lockfileText = await Deno.readTextFile(`${projectDir}/veryfront.lock`);
        const lockfile = JSON.parse(lockfileText) as {
          imports: Record<string, { resolved: string; integrity: string }>;
        };
        assertEquals(lockfile.imports[requestUrl]?.resolved, resolvedUrl);
        assertEquals(lockfile.imports[requestUrl]?.integrity, await computeIntegrity(moduleSource));

        const second = await load(
          (async () => new Response("cdn unavailable", { status: 599 })) as typeof fetch,
        );
        assertEquals((second as { contents: string }).contents, moduleSource);
      } finally {
        restoreMockFetch();
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("retries transient remote module fetch failures before returning an error", async () => {
      let attempts = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);

      try {
        installMockFetch(
          (async () => {
            attempts += 1;
            if (attempts < 3) return new Response("unavailable", { status: 503 });
            return new Response("export const ok = true;", { status: 200 });
          }) as typeof fetch,
        );

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals((result as { contents: string }).contents, "export const ok = true;");
        assertEquals(attempts, 3);
      } finally {
        restoreMockFetch();
      }
    });

    it("rejects oversized remote module bodies without retrying", async () => {
      let attempts = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });
      plugin.setup(createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      ));
      assertExists(loadHandler);

      try {
        installMockFetch(
          (async () => {
            attempts += 1;
            return new Response("export {};", {
              headers: {
                "content-length": String(MAX_BUNDLE_CHUNK_SIZE_BYTES + 1),
              },
            });
          }) as typeof fetch,
        );

        await assertRejects(
          async () => {
            await loadHandler!({
              path: "https://esm.sh/yaml@2",
              namespace: "http-url",
              pluginData: undefined,
              suffix: "",
            });
          },
          Error,
          `exceeds ${MAX_BUNDLE_CHUNK_SIZE_BYTES} bytes`,
        );
        assertEquals(attempts, 1);
      } finally {
        restoreMockFetch();
      }
    });

    it("keeps the fetch deadline active while reading a streaming module body", async () => {
      let attempts = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://93.184.216.34"],
        fetchTimeoutMs: 20,
      });
      plugin.setup(createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      ));
      assertExists(loadHandler);

      try {
        installMockFetch(
          ((_input, init) => {
            attempts += 1;
            const signal = observeFetchRequestInit(init).signal;
            return Promise.resolve(
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode("export const pending = "));
                    signal?.addEventListener("abort", () => controller.error(signal.reason), {
                      once: true,
                    });
                  },
                }),
              ),
            );
          }) as typeof fetch,
        );

        const result = await loadHandler!({
          path: "https://93.184.216.34/module.js",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        const errors = (result as { errors?: Array<{ text: string }> }).errors;
        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("Failed to fetch"), true);
        assertEquals(attempts, 3);
      } finally {
        restoreMockFetch();
      }
    });

    it("serves remote modules without repeated warnings when lockfile flush hits a read-only filesystem", async () => {
      const originalWarn = console.warn;
      const projectDir = await Deno.makeTempDir();
      const moduleSource = "export const ok = true;";
      const warnings: string[] = [];
      const entries = new Map<string, {
        resolved: string;
        integrity: string;
        fetchedAt?: string;
      }>();
      let lockfileSets = 0;
      let lockfileFlushes = 0;
      let failRemoteFetches = false;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;

      const readOnlyLockfile: LockfileManager = {
        read: () => Promise.resolve(null),
        write: () => Promise.reject(new Error("read-only lockfile")),
        get: (url) => Promise.resolve(entries.get(url) ?? null),
        set: (url, entry) => {
          lockfileSets += 1;
          entries.set(url, entry);
          return Promise.resolve();
        },
        has: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        flush: () => {
          lockfileFlushes += 1;
          return Promise.reject(
            new Error(
              "Read-only file system (os error 30): writefile '/app/project/veryfront.lock'",
            ),
          );
        },
      };

      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        lockfile: readOnlyLockfile,
        projectDir,
      });
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);

      try {
        console.warn = ((...args: unknown[]) => {
          warnings.push(args.map(String).join(" "));
        }) as typeof console.warn;
        installMockFetch(
          (async () =>
            failRemoteFetches
              ? new Response("cdn unavailable", { status: 599 })
              : new Response(moduleSource, { status: 200 })) as typeof fetch,
        );

        const first = await loadHandler({
          path: "https://esm.sh/yaml@2/stringify",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const second = await loadHandler({
          path: "https://esm.sh/yaml@2/parse",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals((first as { contents: string }).contents, moduleSource);
        assertEquals((second as { contents: string }).contents, moduleSource);
        assertEquals(lockfileSets, 2);
        assertEquals(lockfileFlushes, 1);
        assertEquals(warnings, []);

        failRemoteFetches = true;
        const cached = await loadHandler({
          path: "https://esm.sh/yaml@2/parse",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals((cached as { contents: string }).contents, moduleSource);
        assertEquals(
          warnings.some((warning) => warning.includes("could not persist lockfile entry")),
          false,
        );
        assertEquals(warnings.some((warning) => warning.includes("veryfront.lock")), false);
        assertEquals(warnings.some((warning) => warning.includes("/app/project")), false);
      } finally {
        restoreMockFetch();
        console.warn = originalWarn;
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("propagates lockfile set failures", async () => {
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;

      const failingLockfile: LockfileManager = {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        set: () => Promise.reject(new Error("lockfile set failed")),
        has: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        flush: () => Promise.resolve(),
      };

      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        lockfile: failingLockfile,
      });
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);
      const handler = loadHandler;

      try {
        installMockFetch((async () => new Response("export const parsed = true;")) as typeof fetch);

        await assertRejects(
          async () => {
            await handler({
              path: "https://esm.sh/yaml@2",
              namespace: "http-url",
              pluginData: undefined,
              suffix: "",
            });
          },
          Error,
          "lockfile set failed",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("propagates non-read-only lockfile flush failures", async () => {
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;

      const failingLockfile: LockfileManager = {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        has: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        flush: () => Promise.reject(new Error("disk quota exceeded")),
      };

      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        lockfile: failingLockfile,
      });
      const mockBuild = createMockBuild(
        () => {},
        (_opts, fn) => {
          loadHandler = fn;
        },
      );
      plugin.setup(mockBuild);
      assertExists(loadHandler);
      const handler = loadHandler;

      try {
        installMockFetch((async () => new Response("export const parsed = true;")) as typeof fetch);

        await assertRejects(
          async () => {
            await handler({
              path: "https://esm.sh/yaml@2",
              namespace: "http-url",
              pluginData: undefined,
              suffix: "",
            });
          },
          Error,
          "disk quota exceeded",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("rejects cached remote modules whose integrity no longer matches the lockfile", async () => {
      const projectDir = await Deno.makeTempDir();
      const firstSource = "export const value = 'first';";
      const secondSource = "export const value = 'second';";
      const requestUrl = "https://esm.sh/yaml@2";
      const firstIntegrity = await computeIntegrity(firstSource);

      const load = (fetchImpl: typeof fetch) => {
        installMockFetch(fetchImpl);
        let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
        const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"], projectDir });
        const mockBuild = createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        );
        plugin.setup(mockBuild);
        assertExists(loadHandler);
        return loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
      };

      try {
        await load((async () => new Response(firstSource, { status: 200 })) as typeof fetch);

        const lockfileText = await Deno.readTextFile(`${projectDir}/veryfront.lock`);
        const lockfile = JSON.parse(lockfileText) as {
          imports: Record<string, { resolved: string; integrity: string }>;
        };
        assertEquals(lockfile.imports[requestUrl]?.integrity, firstIntegrity);
        lockfile.imports[requestUrl]!.integrity = await computeIntegrity(secondSource);
        await Deno.writeTextFile(`${projectDir}/veryfront.lock`, JSON.stringify(lockfile));

        const result = await load(
          (async () => new Response("cdn unavailable", { status: 599 })) as typeof fetch,
        );

        assertEquals("errors" in (result as Record<string, unknown>), true);
      } finally {
        restoreMockFetch();
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("refetches instead of serving stale cache when a lockfile URL returns new content", async () => {
      const projectDir = await Deno.makeTempDir();
      const oldSource = "export const value = 'old';";
      const newSource = "export const value = 'new';";
      const requestUrl = "https://esm.sh/yaml@2";
      let fetchMode: "old" | "new" = "old";
      let attempts = 0;

      const load = () => {
        installMockFetch(
          (async () => {
            attempts += 1;
            return new Response(fetchMode === "old" ? oldSource : newSource, { status: 200 });
          }) as typeof fetch,
        );

        let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
        const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"], projectDir });
        const mockBuild = createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        );
        plugin.setup(mockBuild);
        assertExists(loadHandler);
        return loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
      };

      try {
        const first = await load();
        assertEquals((first as { contents: string }).contents, oldSource);

        fetchMode = "new";
        attempts = 0;
        const second = await load();

        assertEquals((second as { contents: string }).contents, newSource);
        assertEquals(attempts, 2);
      } finally {
        restoreMockFetch();
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("fails a strict build instead of refetching a lockfile integrity mismatch", async () => {
      const projectDir = await Deno.makeTempDir();
      const oldSource = "export const value = 'old';";
      const newSource = "export const value = 'new';";
      const requestUrl = "https://esm.sh/yaml@2";
      let fetchMode: "old" | "new" = "old";

      const load = () => {
        installMockFetch(
          (async () =>
            new Response(fetchMode === "old" ? oldSource : newSource, {
              status: 200,
            })) as typeof fetch,
        );

        let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
        const plugin = createHTTPPlugin({
          allowedHosts: ["https://esm.sh"],
          projectDir,
          strict: true,
        });
        const mockBuild = createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        );
        plugin.setup(mockBuild);
        assertExists(loadHandler);
        return loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
      };

      try {
        const first = await load();
        assertEquals((first as { contents: string }).contents, oldSource);

        fetchMode = "new";
        const second = await load();

        const errors = (second as { errors?: Array<{ text: string }> }).errors;
        assertExists(errors?.[0], "strict builds must return an esbuild error");
        assertEquals(
          errors[0].text.includes(`Integrity mismatch for ${requestUrl}`),
          true,
          "the lockfile hash mismatch must be reported, not silently refetched",
        );
      } finally {
        restoreMockFetch();
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("refuses a tampered disk cache entry when the CDN is unreachable", async () => {
      const projectDir = await Deno.makeTempDir();
      const moduleSource = "export const parsed = true;";
      const tamperedSource = "export const value = 'tampered';";
      const requestUrl = "https://esm.sh/yaml@2";
      const cacheDir = `${projectDir}/.veryfront/cache/api-http-imports`;

      const load = (fetchImpl: typeof fetch) => {
        installMockFetch(fetchImpl);
        let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
        const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"], projectDir });
        const mockBuild = createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        );
        plugin.setup(mockBuild);
        assertExists(loadHandler);
        return loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
      };

      try {
        const first = await load(
          (async () => new Response(moduleSource, { status: 200 })) as typeof fetch,
        );
        assertEquals((first as { contents: string }).contents, moduleSource);

        let tampered = 0;
        for await (const entry of Deno.readDir(cacheDir)) {
          if (!entry.isFile || !entry.name.endsWith(".mjs")) continue;
          await Deno.writeTextFile(`${cacheDir}/${entry.name}`, tamperedSource);
          tampered += 1;
        }
        assertEquals(tampered > 0, true, "the first load must populate the disk cache");

        const second = await load(
          (async () => new Response("cdn unavailable", { status: 599 })) as typeof fetch,
        );

        assertEquals(
          "errors" in (second as Record<string, unknown>),
          true,
          "a tampered cache entry must not be served as remote module source",
        );
        assertEquals(
          (second as { contents?: string }).contents,
          undefined,
          "no tampered contents may reach the bundler",
        );
      } finally {
        restoreMockFetch();
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("refuses a cache entry whose metadata integrity was rewritten", async () => {
      const projectDir = await Deno.makeTempDir();
      const moduleSource = "export const parsed = true;";
      const requestUrl = "https://esm.sh/yaml@2";
      const cacheDir = `${projectDir}/.veryfront/cache/api-http-imports`;

      const load = (fetchImpl: typeof fetch) => {
        installMockFetch(fetchImpl);
        let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
        const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"], projectDir });
        const mockBuild = createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        );
        plugin.setup(mockBuild);
        assertExists(loadHandler);
        return loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
      };

      try {
        const first = await load(
          (async () => new Response(moduleSource, { status: 200 })) as typeof fetch,
        );
        assertEquals((first as { contents: string }).contents, moduleSource);

        let rewritten = 0;
        for await (const entry of Deno.readDir(cacheDir)) {
          if (!entry.isFile || !entry.name.endsWith(".json")) continue;
          const metadataPath = `${cacheDir}/${entry.name}`;
          const metadata = JSON.parse(await Deno.readTextFile(metadataPath)) as {
            integrity?: string;
          };
          metadata.integrity = await computeIntegrity("export const value = 'other';");
          await Deno.writeTextFile(metadataPath, JSON.stringify(metadata));
          rewritten += 1;
        }
        assertEquals(rewritten > 0, true, "the first load must write cache metadata");

        const second = await load(
          (async () => new Response("cdn unavailable", { status: 599 })) as typeof fetch,
        );

        assertEquals(
          "errors" in (second as Record<string, unknown>),
          true,
          "a cache entry whose metadata integrity disagrees must not be served",
        );
      } finally {
        restoreMockFetch();
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });
  });
});
