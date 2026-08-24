import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import type { VirtualModuleSystem } from "../virtual-module-system.ts";
import { ComponentRegistry } from "./component-registry.ts";
import * as React from "react";

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

/** Registry whose single component always fails to load, so it falls back. */
async function createRegistryWithFailingComponent(
  errorMessage: string,
): Promise<{ registry: ComponentRegistry; snapshotKey: string }> {
  const adapter = createMockAdapter();
  adapter.fs.files.set(
    "/project/components/Button.tsx",
    "export default function Button() { return null; }",
  );
  const registry = new ComponentRegistry(
    { registerModule: () => Promise.resolve() } as unknown as VirtualModuleSystem,
    3001,
    adapter,
    undefined,
    undefined,
    "project-id",
    "branch:main",
    () => Promise.reject(new Error(errorMessage)),
  );

  await registry.loadFromDirectory("/project/components", true);
  const snapshotKey = await registry.prepareDependencySnapshot("off");
  return { registry, snapshotKey };
}

describe("ComponentRegistry logic", () => {
  describe("component discovery", () => {
    it("registers only component files and resolves the project root", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/index.tsx",
        "export default function Index() { return null; }",
      );
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      adapter.fs.files.set("/project/components/style.css", ".button {}");
      adapter.fs.files.set(
        "/project/components/node_modules/Evil.tsx",
        "export default function Evil() { return null; }",
      );

      let seenProjectRoot: string | undefined;
      const registry = new ComponentRegistry(
        { registerModule: () => Promise.resolve() } as unknown as VirtualModuleSystem,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, projectRoot) => {
          seenProjectRoot = projectRoot;
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          return Promise.resolve(Component);
        },
      );

      await registry.loadFromDirectory("/project/components", true);
      const snapshotKey = await registry.prepareDependencySnapshot("off");

      assertEquals(
        Object.keys(registry.getAllAsComponents(snapshotKey)).sort(),
        ["Button"],
        "index.tsx, .css files and node_modules entries must not register as components",
      );
      assertEquals(
        seenProjectRoot,
        "/project",
        "a components/ directory must resolve the project root to its parent",
      );
    });
  });

  describe("component load failures", () => {
    it("records the failure, serves the fallback and resets on clear", async () => {
      const { registry, snapshotKey } = await createRegistryWithFailingComponent("boom");

      assertEquals(
        registry.hasFailed("Button"),
        true,
        "a component whose source fails to load must be recorded as failed",
      );
      assertEquals(
        registry.getFailedComponents()[0]?.filePath,
        "/project/components/Button.tsx",
        "the failure record must carry the source path",
      );
      assertEquals(
        registry.getAllAsComponents(snapshotKey).Button?.displayName,
        "ErrorFallback(Button)",
        "a failed component must be replaced by the error fallback",
      );

      // A second snapshot keeps its own component map, so clear() has to reset the
      // whole snapshot store rather than just the map of the latest snapshot.
      const pinnedDependencies = { lodash: "1.0.0" };
      const pinnedSnapshotKey = await registry.prepareDependencySnapshot(
        cacheKeyForDependencies(pinnedDependencies),
        pinnedDependencies,
      );

      registry.clear();

      assertEquals(
        registry.has("Button", snapshotKey),
        false,
        "clear() must drop snapshot-scoped components",
      );
      assertEquals(
        registry.has("Button", pinnedSnapshotKey),
        false,
        "clear() must drop every retained dependency snapshot, not just the latest",
      );
      assertEquals(
        registry.getFailedComponents().length,
        0,
        "clear() must reset failure tracking",
      );
    });
  });

  describe("dependency snapshot isolation", () => {
    it("isolates component maps by request environment", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenEnvironments: string[] = [];
      const registry = new ComponentRegistry(
        { registerModule: () => Promise.resolve() } as unknown as VirtualModuleSystem,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const environment = options?.mode ?? "missing";
          seenEnvironments.push(environment);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${environment})`;
          return Promise.resolve(Component);
        },
        { compileMode: "production", environment: "production" },
      );

      await registry.loadFromDirectory("/project/components", true);
      const productionKey = await registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        undefined,
        "production",
      );
      const previewKey = await registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        undefined,
        "preview",
      );
      const previewKeyAgain = await registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        undefined,
        "preview",
      );

      assertEquals(productionKey === previewKey, false);
      assertEquals(previewKeyAgain, previewKey);
      assertEquals(
        registry.getAllAsComponents(productionKey).Button?.displayName,
        "Button(production)",
      );
      assertEquals(
        registry.getAllAsComponents(previewKey).Button?.displayName,
        "Button(preview)",
      );
      assertEquals(seenEnvironments, ["production", "preview"]);
    });

    it("materializes distinct component maps for concurrent package snapshots", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenVersions: string[] = [];
      const virtualModules = {
        registerModule: () => Promise.resolve(),
      } as unknown as VirtualModuleSystem;
      const registry = new ComponentRegistry(
        virtualModules,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const version = options?.dependencyPinningDependencies?.lodash ?? "missing";
          seenVersions.push(version);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${version})`;
          return Promise.resolve(Component);
        },
      );

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
      const virtualModules = {
        registerModule: () => Promise.resolve(),
      } as unknown as VirtualModuleSystem;
      const registry = new ComponentRegistry(
        virtualModules,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const origin = options?.moduleServerOrigin;
          seenOrigins.push(origin);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${origin})`;
          return Promise.resolve(Component);
        },
      );

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

    it("isolates component maps by the server external package set", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenPackages: string[] = [];
      const registry = new ComponentRegistry(
        { registerModule: () => Promise.resolve() } as unknown as VirtualModuleSystem,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const packages = options?.serverExternalPackages?.join(",") ?? "baseline";
          seenPackages.push(packages);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${packages})`;
          return Promise.resolve(Component);
        },
      );

      await registry.loadFromDirectory("/project/components", true);
      const baseline = await registry.prepareDependencySnapshot("off");
      const combined = await registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        ["knex", "@prisma/client"],
      );
      const reordered = await registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        ["@prisma/client", "knex"],
      );

      assertEquals(combined === baseline, false);
      assertEquals(reordered, combined);
      assertEquals(
        registry.getAllAsComponents(combined).Button?.displayName,
        "Button(knex,@prisma/client)",
      );
      assertEquals(seenPackages, ["baseline", "knex,@prisma/client"]);
    });

    it("bounds retained dependency snapshots and evicts the least recently used map", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const virtualModules = {
        registerModule: () => Promise.resolve(),
      } as unknown as VirtualModuleSystem;
      const registry = new ComponentRegistry(
        virtualModules,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const version = options?.dependencyPinningDependencies?.lodash ?? "missing";
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${version})`;
          return Promise.resolve(Component);
        },
      );

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
      assertEquals(registry.has("Button", snapshotKeys[1]), false);
      assertEquals(registry.has("Button", snapshot32Key), true);
    });
  });
});
