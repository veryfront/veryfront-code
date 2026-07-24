import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeIntegrity, type LockfileManager } from "#veryfront/utils";
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
    });

    it("should register React JSX runtime resolver", () => {
      const plugin = createHTTPPlugin([]);

      const resolveFilters: RegExp[] = [];
      const mockBuild = createMockBuild(
        (opts) => {
          resolveFilters.push(opts.filter);
        },
        () => {},
      );

      plugin.setup(mockBuild);

      const reactFilter = resolveFilters[1];
      assertExists(reactFilter);
      assertEquals(reactFilter.test("react/jsx-runtime"), true);
      assertEquals(reactFilter.test("react/jsx-dev-runtime"), true);
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
      const originalFetch = globalThis.fetch;
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
        globalThis.fetch = (() => {
          throw new Error("disallowed host should not be fetched");
        }) as typeof fetch;

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
        globalThis.fetch = originalFetch;
      }
    });

    it("blocks disallowed lockfile targets before issuing a request", async () => {
      const originalFetch = globalThis.fetch;
      const requestUrl = "https://esm.sh/yaml@2";
      const privateSource = "export const privateValue = true;";
      const lockfileEntry = {
        resolved: "http://127.0.0.1/private.ts",
        integrity: await computeIntegrity(privateSource),
      };
      const lockfile: LockfileManager = {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        get: () => Promise.resolve(lockfileEntry),
        set: () => Promise.resolve(),
        has: () => Promise.resolve(true),
        clear: () => Promise.resolve(),
        flush: () => Promise.resolve(),
      };
      const requested: string[] = [];
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        lockfile,
      });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async (input) => {
          requested.push(String(input));
          return new Response(privateSource, { status: 200 });
        }) as typeof fetch;

        const result = await loadHandler({
          path: requestUrl,
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;

        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("Remote import blocked by allow-list"), true);
        assertEquals(requested, []);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("blocks a disallowed redirect before following it", async () => {
      const originalFetch = globalThis.fetch;
      const requested: string[] = [];
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async (input) => {
          requested.push(String(input));
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/private.ts" },
          });
        }) as typeof fetch;

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;

        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("Remote import blocked by allow-list"), true);
        assertEquals(requested.length, 1);
        assertEquals(requested[0]?.startsWith("https://esm.sh/"), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not let stalled redirect cancellation block the next fetch", async () => {
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      let cancellationStarted = false;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        timeoutMs: 25,
      });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async () => {
          fetchCalls++;
          if (fetchCalls === 1) {
            return new Response(
              new ReadableStream<Uint8Array>({
                cancel: () => {
                  cancellationStarted = true;
                  return new Promise<void>(() => {});
                },
              }),
              {
                status: 302,
                headers: { location: "https://esm.sh/resolved.ts" },
              },
            );
          }
          return new Response("export const ok = true;");
        }) as typeof fetch;

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timed-out">((resolve) => {
          timeoutId = setTimeout(() => resolve("timed-out"), 100);
        });
        try {
          const outcome = await Promise.race([
            loadHandler({
              path: "https://esm.sh/yaml@2",
              namespace: "http-url",
              pluginData: undefined,
              suffix: "",
            }),
            timeout,
          ]);

          assertEquals(outcome === "timed-out", false);
          assertEquals(fetchCalls, 2);
          assertEquals(cancellationStarted, true);
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects remote module bodies above the configured byte limit", async () => {
      const originalFetch = globalThis.fetch;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        maxResponseBytes: 4,
      });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async () => new Response("12345")) as typeof fetch;
        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;

        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("exceeded 4 bytes"), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("cancels a response rejected by its oversized Content-Length", async () => {
      const originalFetch = globalThis.fetch;
      let cancelled = false;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        maxResponseBytes: 4,
      });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
              },
            }),
            {
              status: 200,
              headers: { "content-length": "100" },
            },
          )) as typeof fetch;

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;

        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("exceeded 4 bytes"), true);
        assertEquals(cancelled, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("cancels a terminal non-success response body", async () => {
      const originalFetch = globalThis.fetch;
      let cancelled = false;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
              },
            }),
            { status: 404 },
          )) as typeof fetch;

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;

        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("404"), true);
        assertEquals(cancelled, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("aborts stalled remote module bodies within the configured timeout", async () => {
      const originalFetch = globalThis.fetch;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const plugin = createHTTPPlugin({
        allowedHosts: ["https://esm.sh"],
        timeoutMs: 5,
      });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      const fallbackTimer = setTimeout(() => {
        try {
          streamController?.close();
        } catch {
          // A bounded reader may already have cancelled the stream.
        }
      }, 25);
      try {
        globalThis.fetch = (async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
              },
            }),
          )) as typeof fetch;
        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });
        const errors = (result as { errors?: Array<{ text: string }> }).errors;

        assertExists(errors?.[0]);
        assertEquals(errors[0].text.includes("timed out"), true);
      } finally {
        clearTimeout(fallbackTimer);
        globalThis.fetch = originalFetch;
        try {
          streamController?.close();
        } catch {
          // A bounded reader may already have cancelled the stream.
        }
      }
    });

    it("serves a previously fetched remote module when the CDN later returns an error", async () => {
      const originalFetch = globalThis.fetch;
      const projectDir = await Deno.makeTempDir();
      const moduleSource = "export const parsed = true;";
      const requestUrl = "https://esm.sh/yaml@2";
      const resolvedUrl = "https://esm.sh/yaml@2?target=es2020&bundle=true";

      const load = (fetchImpl: typeof fetch) => {
        globalThis.fetch = fetchImpl;
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
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("retries transient remote module fetch failures before returning an error", async () => {
      const originalFetch = globalThis.fetch;
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
        globalThis.fetch = (async () => {
          attempts += 1;
          if (attempts < 3) return new Response("unavailable", { status: 503 });
          return new Response("export const ok = true;", { status: 200 });
        }) as typeof fetch;

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals((result as { contents: string }).contents, "export const ok = true;");
        assertEquals(attempts, 3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("cancels retryable response bodies before issuing the next request", async () => {
      const originalFetch = globalThis.fetch;
      let attempts = 0;
      let cancellations = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;
      const plugin = createHTTPPlugin({ allowedHosts: ["https://esm.sh"] });
      plugin.setup(
        createMockBuild(
          () => {},
          (_opts, fn) => {
            loadHandler = fn;
          },
        ),
      );
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async () => {
          attempts += 1;
          if (attempts === 3) {
            return new Response("export const ok = true;", { status: 200 });
          }

          const responseAttempt = attempts;
          return new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancellations += 1;
                if (responseAttempt === 1) {
                  throw new Error("response cancellation failed");
                }
              },
            }),
            { status: 503 },
          );
        }) as typeof fetch;

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2",
          namespace: "http-url",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals((result as { contents: string }).contents, "export const ok = true;");
        assertEquals(attempts, 3);
        assertEquals(cancellations, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("serves remote modules without repeated warnings when lockfile flush hits a read-only filesystem", async () => {
      const originalFetch = globalThis.fetch;
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
        globalThis.fetch = (async () =>
          failRemoteFetches
            ? new Response("cdn unavailable", { status: 599 })
            : new Response(moduleSource, { status: 200 })) as typeof fetch;

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
          warnings.some((warning) =>
            warning.includes("could not persist lockfile entry")
          ),
          false,
        );
        assertEquals(warnings.some((warning) => warning.includes("veryfront.lock")), false);
        assertEquals(warnings.some((warning) => warning.includes("/app/project")), false);
      } finally {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("propagates lockfile set failures", async () => {
      const originalFetch = globalThis.fetch;
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
        globalThis.fetch = (async () =>
          new Response("export const parsed = true;")) as typeof fetch;

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
        globalThis.fetch = originalFetch;
      }
    });

    it("propagates non-read-only lockfile flush failures", async () => {
      const originalFetch = globalThis.fetch;
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
        globalThis.fetch = (async () =>
          new Response("export const parsed = true;")) as typeof fetch;

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
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects cached remote modules whose integrity no longer matches the lockfile", async () => {
      const originalFetch = globalThis.fetch;
      const projectDir = await Deno.makeTempDir();
      const firstSource = "export const value = 'first';";
      const secondSource = "export const value = 'second';";
      const requestUrl = "https://esm.sh/yaml@2";
      const firstIntegrity = await computeIntegrity(firstSource);

      const load = (fetchImpl: typeof fetch) => {
        globalThis.fetch = fetchImpl;
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
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

    it("refetches instead of serving stale cache when a lockfile URL returns new content", async () => {
      const originalFetch = globalThis.fetch;
      const projectDir = await Deno.makeTempDir();
      const oldSource = "export const value = 'old';";
      const newSource = "export const value = 'new';";
      const requestUrl = "https://esm.sh/yaml@2";
      let fetchMode: "old" | "new" = "old";
      let attempts = 0;

      const load = () => {
        globalThis.fetch = (async () => {
          attempts += 1;
          return new Response(fetchMode === "old" ? oldSource : newSource, { status: 200 });
        }) as typeof fetch;

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
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true }).catch(() => {});
      }
    });
  });
});
