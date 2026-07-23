import "#veryfront/schemas/_test-setup.ts";
/**
 * Orchestrator tests: pipeline wiring with injectable discovery and factory.
 *
 * @module extensions/orchestrate.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { orchestrateExtensions } from "./orchestrate.ts";
import { mergeExtensions } from "./discovery.ts";
import { reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";
import type { LLMProvider, LLMProviderRegistry } from "./llm/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import { createBuiltinExtensions } from "./builtin-extensions.ts";

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

  it("rejects malformed config extension entries before discovery", async () => {
    let discoveryCalls = 0;
    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: { extensions: [null as unknown as Extension] },
          logger: noopLogger,
          discovery: {
            ...emptyDiscovery(),
            discoverPackageExtensions: () => {
              discoveryCalls++;
              return Promise.resolve([]);
            },
          },
        }),
      Error,
      "Config extension is invalid",
    );
    assertEquals(discoveryCalls, 0);
  });

  it("rejects relative project directories before discovery", async () => {
    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "relative/project",
          config: {},
          logger: noopLogger,
          discovery: emptyDiscovery(),
        }),
      Error,
      "projectDir is invalid",
    );
  });

  it("rejects malformed options and discovery results before loading factories", async () => {
    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: { extensions: {} as unknown as Extension[] },
          logger: noopLogger,
          discovery: emptyDiscovery(),
        }),
      Error,
      "config.extensions must be an array",
    );

    let loadCalls = 0;
    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: {},
          logger: noopLogger,
          discovery: {
            ...emptyDiscovery(),
            discoverProjectExtensions: () => Promise.resolve([null as unknown as string]),
          },
          loadFactory: () => {
            loadCalls++;
            return Promise.reject(new Error("must not load"));
          },
        }),
      Error,
      "discovery result",
    );
    assertEquals(loadCalls, 0);
  });

  it("contains revoked orchestration boundary objects", async () => {
    const revokedOptions = Proxy.revocable({}, {});
    revokedOptions.revoke();
    const optionsError = await assertRejects(() =>
      orchestrateExtensions(revokedOptions.proxy as never)
    );
    assertEquals(optionsError instanceof VeryfrontError, true);
    assertEquals(String(optionsError).includes("revoked"), false);

    const revokedExtensions = Proxy.revocable([], {});
    revokedExtensions.revoke();
    const configError = await assertRejects(() =>
      orchestrateExtensions({
        projectDir: "/fake",
        config: { extensions: revokedExtensions.proxy as Extension[] },
        logger: noopLogger,
        discovery: emptyDiscovery(),
      })
    );
    assertEquals(configError instanceof VeryfrontError, true);
    assertEquals(String(configError).includes("revoked"), false);
  });

  it("rejects unsafe disable directive names", async () => {
    await assertRejects(
      () =>
        orchestrateExtensions({
          projectDir: "/fake",
          config: {
            extensions: [{ name: "unsafe\nname", enabled: false }],
          },
          logger: noopLogger,
          discovery: emptyDiscovery(),
        }),
      Error,
      "Disable directive name",
    );
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

  it("honors source priority: config beats package beats project beats local-file", async () => {
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
              metadata: { isExtension: true as const, capabilities: [] },
            },
          ]),
        discoverProjectExtensions: () => Promise.resolve(["/fake/proj.ts"]),
        discoverLocalExtensions: () => Promise.resolve(["/fake/local.ts"]),
        mergeExtensions,
      },
      loadFactory: (path: string, source: ExtensionSource) => {
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
              metadata: { isExtension: true as const, capabilities: [] },
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
