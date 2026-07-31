import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { ComponentRegistry } from "./component-registry.ts";
import type * as React from "react";

function createRegistry(projectDir = "/project") {
  const adapter = createMockAdapter();
  const virtualModules = new VirtualModuleSystem(
    "/_veryfront/modules",
    adapter,
    { importMap: { imports: {}, scopes: {} } },
  );
  const registry = new ComponentRegistry({
    adapter,
    contentSourceId: "test-source",
    projectDir,
    virtualModules,
  });
  return { adapter, registry, virtualModules };
}

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

describe("rendering/ssr/component-registry", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("requires a valid project root and rejects discovery outside it", async () => {
    const adapter = createMockAdapter();
    assertThrows(
      () =>
        new ComponentRegistry({
          adapter,
          contentSourceId: "test-source",
          projectDir: "",
        }),
      TypeError,
      "project directory",
    );

    const { registry } = createRegistry();
    await assertRejects(
      () => registry.loadFromDirectory("/outside/components", true),
      TypeError,
      "outside",
    );
  });

  it("treats only a missing root directory as an empty registry", async () => {
    const { registry } = createRegistry();
    await registry.loadFromDirectory("/project/components", true);
    assertEquals(registry.getAll(), {});

    const adapter = createMockAdapter();
    adapter.fs.readDir = async function* () {
      yield* [];
      throw new Error("upstream unavailable");
    };
    const virtualModules = new VirtualModuleSystem(
      "/_veryfront/modules",
      adapter,
      { importMap: { imports: {}, scopes: {} } },
    );
    const failingRegistry = new ComponentRegistry({
      adapter,
      contentSourceId: "test-source",
      projectDir: "/project",
      virtualModules,
    });
    await assertRejects(
      () => failingRegistry.loadFromDirectory("/project/components", true),
      Error,
      "upstream unavailable",
    );
  });

  it("publishes missing and empty non-deferred component directories without loader identity", async () => {
    const missingAdapter = createMockAdapter();
    missingAdapter.fs.readDir = async function* () {
      yield* [];
      throw new Deno.errors.NotFound("missing component directory");
    };
    const missingRegistry = new ComponentRegistry({
      adapter: missingAdapter,
      projectDir: "/project",
    });

    await missingRegistry.loadFromDirectory("/project/missing", false);
    assertEquals(missingRegistry.getAll("off"), {});

    const emptyAdapter = createMockAdapter();
    emptyAdapter.fs.readDir = async function* () {
      yield* [];
    };
    const emptyRegistry = new ComponentRegistry({
      adapter: emptyAdapter,
      projectDir: "/project",
    });

    await emptyRegistry.loadFromDirectory("/project/components", false);
    assertEquals(emptyRegistry.getAll("off"), {});
  });

  it("discovers nested components deterministically and skips non-runtime files", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/Button.tsx",
      "export default function Button() { return null; }",
    );
    adapter.fs.files.set(
      "/project/components/nested/Card.tsx",
      "export default function Card() { return null; }",
    );
    adapter.fs.files.set(
      "/project/components/nested/index.ts",
      "export { default } from './Card.tsx';",
    );
    adapter.fs.files.set(
      "/project/components/Button.test.tsx",
      "throw new Error('test files must not load');",
    );
    adapter.fs.files.set(
      "/project/components/.hidden/Secret.tsx",
      "throw new Error('hidden files must not load');",
    );

    await registry.loadFromDirectory("/project/components", true);

    assertEquals(virtualModules.getModule("component:Button"), undefined);
    assertEquals(virtualModules.getModule("component:Card"), undefined);
    assertEquals(virtualModules.getModule("component:index"), undefined);
    assertEquals(virtualModules.getModule("component:Button.test"), undefined);
    assertEquals(virtualModules.getModule("component:Secret"), undefined);
    assertEquals(registry.get("Button"), null);

    await registry.initializeComponents();
    assertEquals(typeof registry.get("Button"), "function");
    assertEquals(typeof registry.get("Card"), "function");
    assert(virtualModules.getModule("component:Button"));
    assert(virtualModules.getModule("component:Card"));
  });

  it("rejects duplicate basenames without retaining a partial virtual registry", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/a/Button.tsx",
      "export default function ButtonA() { return null; }",
    );
    adapter.fs.files.set(
      "/project/components/b/Button.tsx",
      "export default function ButtonB() { return null; }",
    );

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      Error,
      "Duplicate component name",
    );
    assertEquals(virtualModules.getModule("component:Button"), undefined);
  });

  it("propagates listed-source failures instead of publishing a partial scan", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.readDir = async function* (path: string) {
      if (path === "/project/components") {
        yield {
          name: "Gone.tsx",
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    };
    adapter.fs.stat = () =>
      Promise.resolve({
        size: 10,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: null,
      });
    adapter.fs.readFile = () => Promise.reject(new Error("source disappeared"));
    adapter.fs.readFileBytesBounded = () => Promise.reject(new Error("source disappeared"));

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      Error,
      "source disappeared",
    );
    assertEquals(virtualModules.getModule("component:Gone"), undefined);
  });

  it("rejects oversized sources before transforming them", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/Huge.tsx",
      "x".repeat(DEFAULT_MAX_FILE_SIZE_BYTES + 1),
    );

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      RangeError,
      "source byte limit",
    );
    assertEquals(virtualModules.getModule("component:Huge"), undefined);
  });

  it("does not retain earlier modules when a later transform fails", async () => {
    const { adapter, registry, virtualModules } = createRegistry();
    adapter.fs.files.set(
      "/project/components/Good.ts",
      "export const good = true;",
    );
    adapter.fs.files.set(
      "/project/components/Broken.ts",
      "export const broken = ;",
    );

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", false),
    );
    assertEquals(virtualModules.getModule("component:Good"), undefined);
    assertEquals(virtualModules.getModule("component:Broken"), undefined);
  });

  it("fails deferred initialization without installing an error fallback", async () => {
    const { adapter, registry } = createRegistry();
    adapter.fs.files.set(
      "/project/components/NotAComponent.ts",
      "export const value = 1;",
    );

    await registry.loadFromDirectory("/project/components", true);
    await assertRejects(
      () => registry.initializeComponents(),
      Error,
      "NotAComponent",
    );

    assertEquals(registry.get("NotAComponent"), null);
    assertEquals(registry.hasFailed("NotAComponent"), true);
    assertEquals(
      registry.getVirtualModuleSystem().getModule("component:NotAComponent"),
      undefined,
    );
  });

  it("bounds entries returned by one directory", async () => {
    const { adapter, registry } = createRegistry();
    adapter.fs.readDir = async function* () {
      for (let index = 0; index < 10_001; index += 1) {
        yield {
          name: `asset-${index}.txt`,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    };

    await assertRejects(
      () => registry.loadFromDirectory("/project/components", true),
      RangeError,
      "directory entry limit",
    );
  });

  describe("dependency snapshot isolation", () => {
    it("materializes distinct component maps for concurrent package snapshots", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenVersions: string[] = [];
      const virtualModules = new VirtualModuleSystem(
        "/_veryfront/modules",
        adapter,
        { importMap: { imports: {}, scopes: {} } },
      );
      const registry = new ComponentRegistry({
        adapter,
        projectDir: "/project",
        virtualModules,
        projectId: "project-id",
        contentSourceId: "branch:main",
        componentSourceLoader: (
          _source,
          _filePath,
          _projectDir,
          _adapter,
          options,
        ) => {
          const version = options?.dependencyPinningDependencies?.lodash ?? "missing";
          seenVersions.push(version);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${version})`;
          return Promise.resolve(Component);
        },
      });

      await registry.loadFromDirectory("/project/components", true);
      const dependenciesA = { lodash: "1.0.0" };
      const dependenciesB = { lodash: "2.0.0" };
      const [snapshotA, snapshotB] = await Promise.all([
        registry.prepareDependencySnapshot(
          cacheKeyForDependencies(dependenciesA),
          dependenciesA,
        ),
        registry.prepareDependencySnapshot(
          cacheKeyForDependencies(dependenciesB),
          dependenciesB,
        ),
      ]);

      const componentA = registry.getAllAsComponents(snapshotA).Button;
      const componentB = registry.getAllAsComponents(snapshotB).Button;
      assertEquals(componentA === componentB, false);
      assertEquals(componentA?.displayName, "Button(1.0.0)");
      assertEquals(componentB?.displayName, "Button(2.0.0)");
      assertEquals(seenVersions.sort(), ["1.0.0", "2.0.0"]);
    });

    it("isolates pin-on component maps by request origin", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenOrigins: Array<string | undefined> = [];
      const virtualModules = new VirtualModuleSystem(
        "/_veryfront/modules",
        adapter,
        { importMap: { imports: {}, scopes: {} } },
      );
      const registry = new ComponentRegistry({
        adapter,
        projectDir: "/project",
        virtualModules,
        projectId: "project-id",
        contentSourceId: "branch:main",
        componentSourceLoader: (
          _source,
          _filePath,
          _projectDir,
          _adapter,
          options,
        ) => {
          const origin = options?.moduleServerOrigin;
          seenOrigins.push(origin);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${origin})`;
          return Promise.resolve(Component);
        },
      });

      await registry.loadFromDirectory("/project/components", true);
      const dependencies = {};
      const cacheKey = cacheKeyForDependencies(dependencies);
      const originAKey = await registry.prepareDependencySnapshot(
        cacheKey,
        dependencies,
        undefined,
        "https://a.example",
      );
      const originBKey = await registry.prepareDependencySnapshot(
        cacheKey,
        dependencies,
        undefined,
        "https://b.example",
      );
      const originAKeyAgain = await registry.prepareDependencySnapshot(
        cacheKey,
        dependencies,
        undefined,
        "https://a.example",
      );

      assertEquals(originAKeyAgain, originAKey);
      assertEquals(originAKey === originBKey, false);
      assertEquals(
        registry.getAllAsComponents(originAKey).Button?.displayName,
        "Button(https://a.example)",
      );
      assertEquals(
        registry.getAllAsComponents(originBKey).Button?.displayName,
        "Button(https://b.example)",
      );
      assertEquals(seenOrigins, ["https://a.example", "https://b.example"]);
    });

    it("bounds retained dependency snapshots and evicts the least recently used map", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const virtualModules = new VirtualModuleSystem(
        "/_veryfront/modules",
        adapter,
        { importMap: { imports: {}, scopes: {} } },
      );
      const registry = new ComponentRegistry({
        adapter,
        projectDir: "/project",
        virtualModules,
        projectId: "project-id",
        contentSourceId: "branch:main",
        componentSourceLoader: (
          _source,
          _filePath,
          _projectDir,
          _adapter,
          options,
        ) => {
          const version = options?.dependencyPinningDependencies?.lodash ?? "missing";
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${version})`;
          return Promise.resolve(Component);
        },
      });

      await registry.loadFromDirectory("/project/components", true);
      const snapshotKeys: string[] = [];
      for (let index = 0; index < 32; index++) {
        const dependencies = { lodash: `${index}.0.0` };
        const cacheKey = cacheKeyForDependencies(dependencies);
        snapshotKeys.push(cacheKey);
        await registry.prepareDependencySnapshot(
          cacheKey,
          dependencies,
        );
      }
      assertEquals(registry.has("Button", snapshotKeys[0]), true);
      const dependencies32 = { lodash: "32.0.0" };
      const snapshot32Key = cacheKeyForDependencies(dependencies32);
      await registry.prepareDependencySnapshot(
        snapshot32Key,
        dependencies32,
      );

      const retainedState = registry as unknown as {
        componentsByDependencySnapshot: Map<string, unknown>;
        dependencySnapshotGenerations: Map<string, unknown>;
      };
      assertEquals(retainedState.componentsByDependencySnapshot.size, 32);
      assertEquals(retainedState.dependencySnapshotGenerations.size, 32);
      assertEquals(registry.has("Button", snapshotKeys[0]), true);
      const evictedError = assertThrows(
        () => registry.has("Button", snapshotKeys[1]),
        Error,
        "dependency snapshot is unavailable",
      );
      assertEquals(evictedError.name, "DependencySnapshotUnavailableError");
      assertEquals(registry.has("Button", snapshot32Key), true);
    });

    it("fails closed for unknown and stale qualified snapshot lookups", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const registry = new ComponentRegistry({
        adapter,
        projectDir: "/project",
        projectId: "project-id",
        contentSourceId: "branch:main",
        componentSourceLoader: () => {
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          return Promise.resolve(Component);
        },
      });

      await registry.loadFromDirectory("/project/components", true);
      const dependencies = { lodash: "1.0.0" };
      const snapshotKey = await registry.prepareDependencySnapshot(
        cacheKeyForDependencies(dependencies),
        dependencies,
      );

      for (
        const lookup of [
          () => registry.get("Button", "on:unknown"),
          () => registry.getAll("on:unknown"),
          () => registry.has("Button", "on:unknown"),
        ]
      ) {
        const unknownError = assertThrows(
          lookup,
          Error,
          "dependency snapshot is unavailable",
        );
        assertEquals(unknownError.name, "DependencySnapshotUnavailableError");
      }

      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function ButtonChanged() { return null; }",
      );
      await registry.loadFromDirectory("/project/components", true);
      const staleError = assertThrows(
        () => registry.getAllAsComponents(snapshotKey),
        Error,
        "dependency snapshot is unavailable",
      );
      assertEquals(staleError.name, "DependencySnapshotUnavailableError");
    });
  });
});
