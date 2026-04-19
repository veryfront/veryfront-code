/**
 * Orchestrator tests — pipeline wiring with injectable discovery and factory.
 *
 * @module extensions/orchestrate.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { orchestrateExtensions } from "./orchestrate.ts";
import { mergeExtensions } from "./discovery.ts";
import { reset, tryResolve } from "./contracts.ts";
import type { Extension, ExtensionSource, ResolvedExtension } from "./types.ts";

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
        const map: Record<ExtensionSource, Extension> = {
          "config": cfg,
          "package": pkg,
          "project": proj,
          "local-file": local,
        };
        return Promise.resolve<ResolvedExtension>({
          extension: map[source],
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
});
