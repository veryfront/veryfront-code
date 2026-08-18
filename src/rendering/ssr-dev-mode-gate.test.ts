import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { LoadComponentOptions } from "#veryfront/modules/react-loader/types.ts";
import { createLayoutComponentCache, loadTSXComponent } from "./layouts/utils/component-loader.ts";
import { loadReservedWithPath } from "./app-reserved.ts";
import { ComponentRegistry } from "./ssr/component-registry.ts";
import type { VirtualModuleSystem } from "./virtual-module-system.ts";

/**
 * The render mode is known on every SSR path, but four component-loading call
 * sites used to hardcode `dev: true`. That made the hosted multi-tenant runtime
 * take dev-only branches inside SSRModuleLoader (per-project transform cap
 * bypassed, 30s acquire deadline, dev cold-start overlap, node position
 * injection). These tests pin `dev` to the render mode at every one of those
 * boundaries so the drift cannot come back unnoticed.
 */

const LAYOUT_SOURCE = "export default function Layout() { return null; }";

function layoutAdapter(source: string): RuntimeAdapter {
  return {
    fs: {
      readFile: () => Promise.resolve(source),
    },
  } as unknown as RuntimeAdapter;
}

function stubComponent(): React.ComponentType<Record<string, unknown>> {
  const Component: React.ComponentType<Record<string, unknown>> = () => null;
  return Component;
}

function loadLayoutWithMode(
  mode: "development" | "production",
  observed: LoadComponentOptions[],
): Promise<unknown> {
  return loadTSXComponent(
    `/project/app/${mode}-layout.tsx`,
    "/project",
    createLayoutComponentCache(),
    layoutAdapter(LAYOUT_SOURCE),
    `project-${mode}`,
    "project-slug",
    "release-1",
    "19.1.0",
    {
      loadComponentFromSource: (_source, _filePath, _projectDir, _adapter, options) => {
        observed.push(options ?? {});
        return Promise.resolve(stubComponent());
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mode,
  );
}

function createRegistry(
  mode: "development" | "production",
  observed: LoadComponentOptions[],
): { registry: ComponentRegistry; adapter: RuntimeAdapter } {
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
    `project-${mode}`,
    "release-1",
    (_source, _filePath, _projectDir, _adapter, options) => {
      observed.push(options ?? {});
      return Promise.resolve(stubComponent());
    },
    mode,
  );

  return { registry, adapter: adapter as unknown as RuntimeAdapter };
}

function loadReservedWithMode(
  mode: "development" | "production",
  observed: LoadComponentOptions[],
): Promise<unknown> {
  return loadReservedWithPath(
    ["/project/app"],
    "loading",
    "/project",
    mode,
    layoutAdapter(LAYOUT_SOURCE),
    `project-${mode}`,
    "release-1",
    "19.1.0",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      loadComponentFromSource: (_source, _filePath, _projectDir, _adapter, options) => {
        observed.push(options ?? {});
        return Promise.resolve(stubComponent());
      },
    },
  );
}

describe("SSR dev-mode gate", () => {
  describe("layout component loading", () => {
    it("loads TSX layouts with dev false in production mode", async () => {
      const observed: LoadComponentOptions[] = [];
      await loadLayoutWithMode("production", observed);

      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.dev, false);
    });

    it("loads TSX layouts with dev true in development mode", async () => {
      const observed: LoadComponentOptions[] = [];
      await loadLayoutWithMode("development", observed);

      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.dev, true);
    });

    it("keeps the layout cache entries of the two modes apart", async () => {
      const observed: LoadComponentOptions[] = [];
      const cache = createLayoutComponentCache();
      const args = [
        "/project/app/layout.tsx",
        "/project",
        cache,
        layoutAdapter(LAYOUT_SOURCE),
        "project-shared",
        "project-slug",
        "release-1",
        "19.1.0",
        {
          loadComponentFromSource: (
            _source: string,
            _filePath: string,
            _projectDir: string,
            _adapter: RuntimeAdapter,
            options?: LoadComponentOptions,
          ) => {
            observed.push(options ?? {});
            return Promise.resolve(stubComponent());
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ] as const;

      await loadTSXComponent(...args, "production");
      await loadTSXComponent(...args, "development");

      assertEquals(observed.map((options) => options.dev), [false, true]);
    });
  });

  describe("components/ registry loading", () => {
    it("loads registry components with dev false in production mode", async () => {
      const observed: LoadComponentOptions[] = [];
      const { registry } = createRegistry("production", observed);

      await registry.loadFromDirectory("/project/components", true);
      await registry.prepareDependencySnapshot();

      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.dev, false);
    });

    it("loads registry components with dev true in development mode", async () => {
      const observed: LoadComponentOptions[] = [];
      const { registry } = createRegistry("development", observed);

      await registry.loadFromDirectory("/project/components", true);
      await registry.prepareDependencySnapshot();

      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.dev, true);
    });
  });

  describe("reserved app component loading", () => {
    it("loads reserved components with dev false in production mode", async () => {
      const observed: LoadComponentOptions[] = [];
      await loadReservedWithMode("production", observed);

      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.dev, false);
    });

    it("loads reserved components with dev true in development mode", async () => {
      const observed: LoadComponentOptions[] = [];
      await loadReservedWithMode("development", observed);

      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.dev, true);
    });
  });
});
