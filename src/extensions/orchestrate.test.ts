import "#veryfront/schemas/_test-setup.ts";
/**
 * Orchestrator tests — pipeline wiring with injectable discovery and factory.
 *
 * @module extensions/orchestrate.test
 */

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isFirstPartyDeclarationMarker, orchestrateExtensions } from "./orchestrate.ts";
import { mergeExtensions } from "./discovery.ts";
import { reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";
import type { LLMProvider, LLMProviderRegistry } from "./llm/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import {
  createBuiltinExtensions,
  createDeferredBuiltinExtension,
  createEvalCliBuiltinExtensions,
} from "./builtin-extensions.ts";
import { join } from "@std/path";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function stubExt(
  name: string,
  overrides: Partial<Extension> = {},
): Extension {
  return { name, version: "1.0.0", capabilities: [], ...overrides };
}

function emptyDiscovery() {
  return {
    discoverPackageExtensions: () => Promise.resolve([]),
    discoverProjectExtensions: () => Promise.resolve([]),
    discoverLocalExtensions: () => Promise.resolve([]),
    mergeExtensions,
  };
}

describe("orchestrateExtensions()", () => {
  afterEach(() => {
    reset();
  });

  it("returns an empty loader when no extensions exist", async () => {
    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {},
      logger: noopLogger,
      discovery: emptyDiscovery(),
    });

    // teardownAll is a no-op on an empty loader.
    await loader.teardownAll();
  });

  it("runs setup() on config extensions", async () => {
    const order: string[] = [];
    const cfgExt = stubExt("cfg-ext", {
      setup: () => {
        order.push("cfg-ext");
      },
    });

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: { extensions: [cfgExt] },
      logger: noopLogger,
      discovery: emptyDiscovery(),
    });

    assertEquals(order, ["cfg-ext"]);
    await loader.teardownAll();
  });

  it("loads discovered project extensions through the injected factory loader", async () => {
    const projectExt = stubExt("proj-ext", {
      provides: { ProjectContract: { id: "proj" } },
    });

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {},
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverProjectExtensions: () => Promise.resolve(["/fake/extensions/proj/src/index.ts"]),
      },
      loadFactory: (path: string, source: ExtensionSource) =>
        Promise.resolve<ResolvedExtension>({
          extension: projectExt,
          source,
          origin: path,
        }),
    });

    assertEquals((tryResolve("ProjectContract") as { id: string }).id, "proj");
    await loader.teardownAll();
  });

  it("carries production discovery identity through to the factory loader", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-bound-orchestration-" });
    const extensionDirectory = join(projectDir, "extensions", "ext-bound");
    await Deno.mkdir(extensionDirectory, { recursive: true });
    await Deno.writeTextFile(
      join(extensionDirectory, "index.ts"),
      "export default () => ({ name: 'must-not-import', version: '1', capabilities: [] });",
    );

    let bindingObserved = false;
    try {
      const loader = await orchestrateExtensions({
        projectDir,
        config: {},
        logger: noopLogger,
        loadFactory: (path, source, _config, binding) => {
          bindingObserved = binding?.path === path;
          return Promise.resolve({
            extension: stubExt("ext-bound"),
            source,
            origin: path,
          });
        },
      });

      assertEquals(bindingObserved, true);
      await loader.teardownAll();
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not import, invoke, or set up explicit-only discovered extensions", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-explicit-extension-" });
    const projectExtensionDirectory = join(
      projectDir,
      "extensions",
      "ext-explicit-project",
    );
    const packageExtensionDirectory = join(
      projectDir,
      "node_modules",
      "ext-explicit-package",
    );
    await Deno.mkdir(join(projectExtensionDirectory, "src"), { recursive: true });
    await Deno.mkdir(packageExtensionDirectory, { recursive: true });
    await Deno.writeTextFile(
      join(projectExtensionDirectory, "src", "index.ts"),
      "throw new Error('project extension must not be imported');",
    );
    await Deno.writeTextFile(
      join(projectExtensionDirectory, "deno.json"),
      JSON.stringify({
        veryfront: { extension: true, activation: "explicit" },
      }),
    );
    await Deno.writeTextFile(
      join(packageExtensionDirectory, "package.json"),
      JSON.stringify({
        name: "ext-explicit-package",
        exports: "./index.js",
        veryfront: { extension: true, activation: "explicit" },
      }),
    );
    await Deno.writeTextFile(
      join(packageExtensionDirectory, "index.js"),
      "throw new Error('package extension must not be imported');",
    );

    let factoryLoaderCalls = 0;
    let discoveredSetupCalls = 0;
    const discoveredExtension = stubExt("must-not-setup", {
      setup() {
        discoveredSetupCalls++;
      },
    });
    try {
      const loader = await orchestrateExtensions({
        projectDir,
        config: {},
        logger: noopLogger,
        loadFactory: (path, source) => {
          factoryLoaderCalls++;
          return Promise.resolve({
            extension: discoveredExtension,
            source,
            origin: path,
          });
        },
      });

      assertEquals(factoryLoaderCalls, 0);
      assertEquals(discoveredSetupCalls, 0);
      await loader.teardownAll();
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("sets up an explicit-only extension only when materialized in config", async () => {
    let factoryLoaderCalls = 0;
    let setupCalls = 0;
    const configuredExtension = stubExt("ext-explicit-project", {
      setup() {
        setupCalls++;
      },
    });

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: { extensions: [configuredExtension] },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverPackageExtensions: () =>
          Promise.resolve([{
            packageName: "ext-explicit-package",
            importTarget: "/fake/node_modules/ext-explicit-package/index.js",
            metadata: {
              isExtension: true,
              activation: "explicit",
              capabilities: [],
            },
          }]),
      },
      loadFactory: (path, source) => {
        factoryLoaderCalls++;
        return Promise.resolve({
          extension: stubExt("must-not-load"),
          source,
          origin: path,
        });
      },
    });

    assertEquals(factoryLoaderCalls, 0);
    assertEquals(setupCalls, 1);
    await loader.teardownAll();
  });

  it("fails closed on injected activation accessors without invoking them", async () => {
    let activationReads = 0;
    let factoryLoaderCalls = 0;
    const metadata = Object.defineProperty(
      { isExtension: true as const, capabilities: [] },
      "activation",
      {
        enumerable: true,
        get() {
          activationReads++;
          return "auto";
        },
      },
    );

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {},
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverPackageExtensions: () =>
          Promise.resolve([{
            packageName: "ext-accessor",
            importTarget: "/canonical/ext-accessor.js",
            metadata,
          }]),
      },
      loadFactory: (path, source) => {
        factoryLoaderCalls++;
        return Promise.resolve({
          extension: stubExt(path),
          source,
          origin: path,
        });
      },
    });

    assertEquals(activationReads, 0);
    assertEquals(factoryLoaderCalls, 0);
    await loader.teardownAll();
  });

  it("honors source priority: config beats package beats project beats local-file", async () => {
    const packageLoadPaths: string[] = [];
    const cfg = stubExt("shared", {
      provides: { Shared: { from: "config" } },
    });
    const pkg = stubExt("shared", {
      provides: { Shared: { from: "package" } },
    });
    const proj = stubExt("shared", {
      provides: { Shared: { from: "project" } },
    });
    const local = stubExt("shared", {
      provides: { Shared: { from: "local-file" } },
    });

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: { extensions: [cfg] },
      logger: noopLogger,
      discovery: {
        discoverPackageExtensions: () =>
          Promise.resolve([
            {
              packageName: "@scope/pkg",
              importTarget: "/canonical/scope-pkg.js",
              metadata: {
                isExtension: true as const,
                activation: "auto" as const,
                capabilities: [],
              },
            },
          ]),
        discoverProjectExtensions: () => Promise.resolve(["/fake/proj.ts"]),
        discoverLocalExtensions: () => Promise.resolve(["/fake/local.ts"]),
        mergeExtensions,
      },
      loadFactory: (path: string, source: ExtensionSource) => {
        if (source === "package") packageLoadPaths.push(path);
        const map: Partial<Record<ExtensionSource, Extension>> = {
          "config": cfg,
          "package": pkg,
          "project": proj,
          "local-file": local,
        };
        const extension = map[source];
        if (!extension) {
          throw new Error(`unexpected extension source: ${source}`);
        }
        return Promise.resolve<ResolvedExtension>({
          extension,
          source,
          origin: path,
        });
      },
    });

    assertEquals(
      (tryResolve("Shared") as { from: string }).from,
      "config",
    );
    assertEquals(packageLoadPaths, ["/canonical/scope-pkg.js"]);
    await loader.teardownAll();
  });

  it("propagates factory-setup failures so bootstrap can surface them", async () => {
    const failing = stubExt("failing", {
      setup: () => {
        throw new Error("factory-setup-boom");
      },
    });

    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: { extensions: [failing] },
          logger: noopLogger,
          discovery: emptyDiscovery(),
        }),
      Error,
      "factory-setup-boom",
    );
  });

  it("keeps the active generation when replacement preflight fails", async () => {
    let teardownCount = 0;
    let beforeActivateCount = 0;
    const marker = { generation: "active" };
    const activeLoader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [stubExt("active", {
          provides: { ActiveGeneration: marker },
          teardown() {
            teardownCount++;
          },
        })],
      },
      logger: noopLogger,
      discovery: emptyDiscovery(),
    });
    const invalid = {
      name: "invalid",
      version: "1.0.0",
      capabilities: [],
      setup: "not-a-function",
    } as unknown as Extension;

    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: { extensions: [invalid] },
          logger: noopLogger,
          discovery: emptyDiscovery(),
          beforeActivate: () => {
            beforeActivateCount++;
          },
        }),
      Error,
      'Extension "invalid" is invalid',
    );

    assertEquals(teardownCount, 0);
    assertEquals(beforeActivateCount, 0);
    assertEquals(tryResolve("ActiveGeneration"), marker);
    await activeLoader.teardownAll();
  });

  it("keeps the active generation when replacement factory loading fails", async () => {
    let teardownCount = 0;
    const marker = { generation: "active" };
    const activeLoader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [stubExt("active", {
          provides: { ActiveGeneration: marker },
          teardown() {
            teardownCount++;
          },
        })],
      },
      logger: noopLogger,
      discovery: emptyDiscovery(),
    });

    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: {},
          logger: noopLogger,
          discovery: {
            ...emptyDiscovery(),
            discoverProjectExtensions: () => Promise.resolve(["/fake/extensions/broken.ts"]),
          },
          loadFactory: () => Promise.reject(new Error("factory loading failed")),
        }),
      Error,
      "factory loading failed",
    );

    assertEquals(teardownCount, 0);
    assertEquals(tryResolve("ActiveGeneration"), marker);
    await activeLoader.teardownAll();
  });

  it("replaces the active generation and makes its stale disposer harmless", async () => {
    let firstTeardownCount = 0;
    const activationOrder: string[] = [];
    const firstLoader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [stubExt("first", {
          provides: { ActiveGeneration: { generation: "first" } },
          teardown() {
            firstTeardownCount++;
            activationOrder.push("first:teardown");
          },
        })],
      },
      logger: noopLogger,
      discovery: emptyDiscovery(),
    });
    const secondMarker = { generation: "second" };
    const secondLoader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [stubExt("second", {
          provides: { ActiveGeneration: secondMarker },
          setup() {
            activationOrder.push("second:setup");
          },
        })],
      },
      logger: noopLogger,
      discovery: emptyDiscovery(),
      beforeActivate: () => {
        activationOrder.push("before-activate");
      },
    });

    assertEquals(firstTeardownCount, 1);
    assertEquals(activationOrder, [
      "first:teardown",
      "before-activate",
      "second:setup",
    ]);
    assertEquals(tryResolve("ActiveGeneration"), secondMarker);

    await firstLoader.teardownAll();
    assertEquals(tryResolve("ActiveGeneration"), secondMarker);
    await secondLoader.teardownAll();
  });

  it("does not activate a retry while timed-out setup is still running", async () => {
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const order: string[] = [];
    const first = orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [stubExt("late", {
          async setup() {
            firstStarted.resolve();
            await releaseFirst.promise;
            order.push("late-setup-done");
          },
        })],
      },
      logger: noopLogger,
      discovery: emptyDiscovery(),
      setupTimeoutMs: 10,
    });
    await firstStarted.promise;
    await assertRejects(() => first, Error, "late");

    const retry = orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [stubExt("replacement", {
          setup() {
            order.push("retry-setup");
          },
        })],
      },
      logger: noopLogger,
      discovery: emptyDiscovery(),
    });
    for (let index = 0; index < 100; index++) await Promise.resolve();
    assertEquals(
      order,
      [],
      "the retry must not run setup while the timed-out setup is still pending",
    );

    releaseFirst.resolve();
    const retryLoader = await retry;
    await retryLoader.teardownAll();

    assertEquals(
      order,
      ["late-setup-done", "retry-setup"],
      "the replacement generation must activate only after the late setup and its cleanup settle",
    );
  });

  it("filters disable directives from config.extensions", async () => {
    const local = stubExt("local-ext", {
      setup: () => {
        throw new Error("should-not-run");
      },
    });

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "local-ext", enabled: false }],
      },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverLocalExtensions: () => Promise.resolve(["/fake/local.ts"]),
      },
      loadFactory: (path: string, source: ExtensionSource) =>
        Promise.resolve<ResolvedExtension>({
          extension: local,
          source,
          origin: path,
        }),
    });

    // Disable directive removed the only extension → setup was never invoked.
    await loader.teardownAll();
  });

  it("ignores a first-party extension declaration with a warning", async () => {
    // A dual-target config declares `extRedis()`; hosted evaluation reduces it
    // to `{ name: "ext-redis" }`. The runtime provides the capability itself,
    // so the declaration activates nothing (veryfront-issue-inbox#688).
    const warnings: string[] = [];
    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "ext-redis" }],
      },
      logger: {
        ...noopLogger,
        warn: (message: string) => {
          warnings.push(message);
        },
      },
      discovery: emptyDiscovery(),
    });

    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0]!, "ext-redis");
    await loader.teardownAll();
  });

  it("does not invoke an accessor while classifying a declaration marker", async () => {
    // A hostile config entry whose sole property is a `name` getter must not
    // execute user code during the marker precheck, and a getter-returned
    // first-party name must not classify as an inert marker.
    let invoked = 0;
    const hostile = Object.defineProperty({}, "name", {
      get() {
        invoked += 1;
        return "ext-redis";
      },
      enumerable: true,
      configurable: true,
    });

    assertEquals(isFirstPartyDeclarationMarker(hostile as { name: string }), false);
    assertEquals(invoked, 0, "the marker precheck must not invoke the accessor");

    // The hostile entry falls through to ordinary extension validation, which
    // rejects it instead of skipping it as an inert declaration.
    await assertRejects(() =>
      orchestrateExtensions({
        projectDir: "/fake",
        config: { extensions: [hostile as { name: string }] },
        logger: noopLogger,
        discovery: emptyDiscovery(),
      })
    );
  });

  it("does not classify an entry with hidden keys as a declaration marker", async () => {
    // Non-enumerable fields and symbol keys are invisible to Object.keys, so a
    // malformed materialized extension could otherwise be silently ignored as
    // an inert declaration instead of failing validation.
    const symbolKeyed = Object.defineProperty(
      { name: "ext-redis" },
      Symbol("hidden"),
      { value: () => {}, enumerable: false },
    );
    const hiddenField = Object.defineProperty(
      { name: "ext-redis" },
      "setup",
      { value: () => {}, enumerable: false },
    );

    assertEquals(isFirstPartyDeclarationMarker(symbolKeyed as { name: string }), false);
    assertEquals(isFirstPartyDeclarationMarker(hiddenField as { name: string }), false);
  });

  it("keeps rejecting a bare name that is not a first-party extension", async () => {
    await assertRejects(() =>
      orchestrateExtensions({
        projectDir: "/fake",
        config: {
          extensions: [{ name: "custom-thing" }],
        },
        logger: noopLogger,
        discovery: emptyDiscovery(),
      })
    );
  });

  it("skips loadFactory for disabled package extensions", async () => {
    const loadCalls: string[] = [];

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "ext-broken-pkg", enabled: false }],
      },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverPackageExtensions: () =>
          Promise.resolve([
            {
              packageName: "ext-broken-pkg",
              importTarget: "/canonical/ext-broken-pkg.js",
              metadata: {
                isExtension: true as const,
                activation: "auto" as const,
                capabilities: [],
              },
            },
          ]),
      },
      loadFactory: (path: string, source: ExtensionSource) => {
        loadCalls.push(path);
        // Simulate a broken factory that would crash if loaded.
        return Promise.reject(
          new Error(`should-not-load: ${path} (source=${source})`),
        );
      },
    });

    assertEquals(loadCalls, []);
    await loader.teardownAll();
  });

  it("keeps installed first-party builtin packages deferred and prefilters their disable aliases", async () => {
    const packageHits = [
      {
        packageName: "@veryfront/ext-css-tailwind",
        importTarget: "/canonical/ext-css-tailwind.js",
        metadata: {
          isExtension: true as const,
          activation: "auto" as const,
          capabilities: [],
        },
      },
      {
        packageName: "@veryfront/ext-node-websocket-ws",
        importTarget: "/canonical/ext-node-websocket-ws.js",
        metadata: {
          isExtension: true as const,
          activation: "auto" as const,
          capabilities: [],
        },
      },
    ];

    for (
      const [disabledName, expectedDeferredFactoryCalls] of [
        ["ext-css-tailwind", ["ext-node-websocket-ws"]],
        ["@veryfront/ext-node-websocket-ws", ["ext-css-tailwind"]],
      ] as const
    ) {
      const loadCalls: string[] = [];
      const deferredFactoryCalls: string[] = [];
      const loader = await orchestrateExtensions({
        projectDir: "/fake",
        config: {
          extensions: [{ name: disabledName, enabled: false }],
        },
        logger: noopLogger,
        discovery: {
          ...emptyDiscovery(),
          discoverPackageExtensions: () => Promise.resolve(packageHits),
        },
        builtinExtensions: [
          createDeferredBuiltinExtension({
            name: "ext-css-tailwind",
            origin: "veryfront/ext-css-tailwind",
            sourceDirectory: "ext-css-tailwind",
            availability: "root-bundled",
            factory: () => {
              deferredFactoryCalls.push("ext-css-tailwind");
              return stubExt("ext-css-tailwind", {
                contracts: { provides: ["CSSProcessor"] },
                setup: (ctx) => ctx.provide("CSSProcessor", { id: "tailwind" }),
              });
            },
          }),
          createDeferredBuiltinExtension({
            name: "ext-node-websocket-ws",
            origin: "veryfront/ext-node-websocket-ws",
            sourceDirectory: "ext-node-websocket-ws",
            availability: "root-bundled",
            factory: () => {
              deferredFactoryCalls.push("ext-node-websocket-ws");
              return stubExt("ext-node-websocket-ws", {
                contracts: { provides: ["NodeWebSocketServerProvider"] },
                setup: (ctx) => ctx.provide("NodeWebSocketServerProvider", { id: "ws" }),
              });
            },
          }),
        ],
        loadFactory: (path: string, source: ExtensionSource) => {
          loadCalls.push(path);
          return Promise.resolve<ResolvedExtension>({
            extension: stubExt(path),
            source,
            origin: path,
          });
        },
      });

      assertEquals(loadCalls, []);
      assertEquals(deferredFactoryCalls, [...expectedDeferredFactoryCalls]);
      await loader.teardownAll();
    }
  });

  it("keeps package discovery above ordinary builtins with the same first-party name", async () => {
    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {},
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverPackageExtensions: () =>
          Promise.resolve([{
            packageName: "@veryfront/ext-css-tailwind",
            importTarget: "/canonical/ext-css-tailwind.js",
            metadata: {
              isExtension: true as const,
              activation: "auto" as const,
              capabilities: [],
            },
          }]),
      },
      builtinExtensions: [{
        extension: stubExt("ext-css-tailwind", {
          provides: { SelectedExtensionSource: { from: "builtin" } },
        }),
        source: "builtin",
        origin: "custom-direct-builtin",
      }],
      loadFactory: (_path: string, source: ExtensionSource) =>
        Promise.resolve<ResolvedExtension>({
          extension: stubExt("ext-css-tailwind", {
            provides: { SelectedExtensionSource: { from: "package" } },
          }),
          source,
          origin: "canonical-package",
        }),
    });

    assertEquals(tryResolve("SelectedExtensionSource"), { from: "package" });
    await loader.teardownAll();
  });

  it("keeps deferred packages lazy for the reduced eval CLI builtin set", async () => {
    const loadCalls: string[] = [];
    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {},
      logger: noopLogger,
      primeContracts: {
        [LLMProviderRegistryName]: createLLMProviderRegistry(),
      },
      discovery: {
        ...emptyDiscovery(),
        discoverPackageExtensions: () =>
          Promise.resolve([{
            packageName: "@veryfront/ext-css-tailwind",
            importTarget: "/canonical/ext-css-tailwind.js",
            metadata: {
              isExtension: true as const,
              activation: "auto" as const,
              capabilities: [],
            },
          }]),
      },
      builtinExtensions: createEvalCliBuiltinExtensions([]),
      loadFactory: (path: string, source: ExtensionSource) => {
        loadCalls.push(path);
        return Promise.resolve<ResolvedExtension>({
          extension: stubExt("ext-css-tailwind"),
          source,
          origin: path,
        });
      },
    });

    assertEquals(loadCalls, []);
    await loader.teardownAll();
  });

  it("skips loadFactory for disabled project extensions (src/index.ts variant)", async () => {
    const loadCalls: string[] = [];

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "ext-broken", enabled: false }],
      },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverProjectExtensions: () =>
          Promise.resolve([
            "/fake/extensions/ext-broken/src/index.ts",
          ]),
      },
      loadFactory: (path: string, source: ExtensionSource) => {
        loadCalls.push(path);
        return Promise.reject(
          new Error(`should-not-load: ${path} (source=${source})`),
        );
      },
    });

    assertEquals(loadCalls, []);
    await loader.teardownAll();
  });

  it("skips loadFactory for disabled project extensions (root index.ts variant)", async () => {
    const loadCalls: string[] = [];

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "ext-root-broken", enabled: false }],
      },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverProjectExtensions: () =>
          Promise.resolve([
            "/fake/extensions/ext-root-broken/index.ts",
          ]),
      },
      loadFactory: (path: string, source: ExtensionSource) => {
        loadCalls.push(path);
        return Promise.reject(
          new Error(`should-not-load: ${path} (source=${source})`),
        );
      },
    });

    assertEquals(loadCalls, []);
    await loader.teardownAll();
  });

  it("still loads project extensions that are not disabled even when a sibling is disabled", async () => {
    const loadCalls: string[] = [];
    const enabledExt = stubExt("ext-enabled");

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "ext-broken", enabled: false }],
      },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverProjectExtensions: () =>
          Promise.resolve([
            "/fake/extensions/ext-broken/src/index.ts",
            "/fake/extensions/ext-enabled/src/index.ts",
          ]),
      },
      loadFactory: (path: string, source: ExtensionSource) => {
        loadCalls.push(path);
        return Promise.resolve<ResolvedExtension>({
          extension: enabledExt,
          source,
          origin: path,
        });
      },
    });

    assertEquals(loadCalls, ["/fake/extensions/ext-enabled/src/index.ts"]);
    await loader.teardownAll();
  });

  it("loads local-file extensions pre-filter but merge drops disabled ones", async () => {
    // Local-file filtering happens after load because the filename doesn't
    // reliably carry the extension name. The resulting loader must still
    // exclude the disabled extension.
    const loadCalls: string[] = [];
    const local = stubExt("local-ext", {
      provides: { LocalContract: { id: "local" } },
    });

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {
        extensions: [{ name: "local-ext", enabled: false }],
      },
      logger: noopLogger,
      discovery: {
        ...emptyDiscovery(),
        discoverLocalExtensions: () => Promise.resolve(["/fake/local.ts"]),
      },
      loadFactory: (path: string, source: ExtensionSource) => {
        loadCalls.push(path);
        return Promise.resolve<ResolvedExtension>({
          extension: local,
          source,
          origin: path,
        });
      },
    });

    // loadFactory WAS called for the local file...
    assertEquals(loadCalls, ["/fake/local.ts"]);
    // ...but the post-merge filter removed the extension, so the contract
    // never gets registered.
    assertEquals(tryResolve("LocalContract"), undefined);
    await loader.teardownAll();
  });

  it("orchestrateExtensions passes primeContracts through to the loader", async () => {
    const marker = { seeded: true };
    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: {},
      logger: noopLogger,
      discovery: emptyDiscovery(),
      primeContracts: { Seeded: marker },
    });
    assertEquals(resolveContract("Seeded"), marker);
    await loader.teardownAll();
  });

  it("lets higher-priority provider extensions override builtin provider ids", async () => {
    const builtinLlmExtensions = createBuiltinExtensions().filter((entry) =>
      entry.extension.name.startsWith("ext-llm-")
    );
    const customProvider: LLMProvider = {
      id: "anthropic",
      createModel(modelId: string) {
        return {
          provider: "custom-anthropic",
          modelId,
          specificationVersion: "v3",
          doGenerate: () => Promise.resolve({}),
          doStream: () => Promise.resolve({ stream: new ReadableStream() }),
        };
      },
    };
    const custom = stubExt("custom-anthropic", {
      contracts: { requires: [LLMProviderRegistryName] },
      setup(ctx) {
        ctx.require<LLMProviderRegistry>(LLMProviderRegistryName).register(customProvider);
      },
    });
    const registry = createLLMProviderRegistry();

    const loader = await orchestrateExtensions({
      projectDir: "/fake",
      config: { extensions: [custom] },
      logger: noopLogger,
      discovery: emptyDiscovery(),
      primeContracts: { [LLMProviderRegistryName]: registry },
      builtinExtensions: builtinLlmExtensions,
    });

    assertEquals(registry.get("anthropic"), customProvider);
    await loader.teardownAll();
  });
});
