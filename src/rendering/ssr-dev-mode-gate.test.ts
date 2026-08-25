import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { LoadComponentOptions } from "#veryfront/modules/react-loader/types.ts";
import {
  createLayoutComponentCache,
  loadTSXComponent,
} from "#veryfront/rendering/layouts/utils/component-loader.ts";
import { loadReservedWithPath } from "./app-reserved.ts";
import { ComponentRegistry } from "#veryfront/rendering/ssr/component-registry.ts";
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";
import type { VirtualModuleSystem } from "./virtual-module-system.ts";

/**
 * Every SSR component-loading boundary carries two independent mode
 * vocabularies, and both have already regressed once.
 *
 * `compileMode` ("development" | "production") drives `dev`. Four call sites
 * once hardcoded `dev: true`, so the hosted runtime took dev-only branches
 * inside SSRModuleLoader (per-project transform cap bypassed, 30s acquire
 * deadline, dev cold-start overlap).
 *
 * `environment` ("preview" | "production") drives `mode`, which is what
 * SSRModuleLoader reads to decide whether to inject Studio Navigator node
 * positions. Hosted preview compiles as production, so fixing the first
 * regression by threading only `compileMode` silently turned preview
 * instrumentation off on layouts, `components/` entries and reserved app
 * components.
 *
 * These tests pin both fields at every one of those boundaries.
 */

const LAYOUT_SOURCE = "export default function Layout() { return null; }";

const PRODUCTION_MODES: RenderModes = {
  compileMode: "production",
  environment: "production",
};

/** Hosted preview: production compile, preview instrumentation. */
const HOSTED_PREVIEW_MODES: RenderModes = {
  compileMode: "production",
  environment: "preview",
};

/** Local development: dev compile, preview instrumentation. */
const LOCAL_DEV_MODES: RenderModes = {
  compileMode: "development",
  environment: "preview",
};

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

function loadLayoutWithModes(
  modes: RenderModes,
  observed: LoadComponentOptions[],
): Promise<unknown> {
  return loadTSXComponent(
    `/project/app/${modes.compileMode}-${modes.environment}-layout.tsx`,
    "/project",
    createLayoutComponentCache(),
    layoutAdapter(LAYOUT_SOURCE),
    `project-${modes.compileMode}-${modes.environment}`,
    "project-slug",
    "release-1",
    modes,
    "19.1.0",
    {
      loadComponentFromSource: (_source, _filePath, _projectDir, _adapter, options) => {
        observed.push(options);
        return Promise.resolve(stubComponent());
      },
    },
  );
}

function createRegistry(
  modes: RenderModes,
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
    `project-${modes.compileMode}-${modes.environment}`,
    "release-1",
    (_source, _filePath, _projectDir, _adapter, options) => {
      observed.push(options);
      return Promise.resolve(stubComponent());
    },
    modes,
  );

  return { registry, adapter: adapter as unknown as RuntimeAdapter };
}

function loadReservedWithModes(
  modes: RenderModes,
  observed: LoadComponentOptions[],
): Promise<unknown> {
  return loadReservedWithPath(
    ["/project/app"],
    "loading",
    "/project",
    modes,
    layoutAdapter(LAYOUT_SOURCE),
    `project-${modes.compileMode}-${modes.environment}`,
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
        observed.push(options);
        return Promise.resolve(stubComponent());
      },
    },
  );
}

async function loadRegistryComponent(
  modes: RenderModes,
  observed: LoadComponentOptions[],
): Promise<void> {
  const { registry } = createRegistry(modes, observed);
  await registry.loadFromDirectory("/project/components", true);
  await registry.prepareDependencySnapshot();
}

/** The three loaders #3841 changed, driven through one shared assertion set. */
const SURFACES: Array<{
  name: string;
  load: (modes: RenderModes, observed: LoadComponentOptions[]) => Promise<unknown>;
}> = [
  { name: "layout component loading", load: loadLayoutWithModes },
  { name: "components/ registry loading", load: loadRegistryComponent },
  { name: "reserved app component loading", load: loadReservedWithModes },
];

describe("SSR render mode gate", () => {
  for (const surface of SURFACES) {
    describe(surface.name, () => {
      it("compiles as production and skips preview instrumentation in hosted production", async () => {
        const observed: LoadComponentOptions[] = [];
        await surface.load(PRODUCTION_MODES, observed);

        assertEquals(observed.length, 1);
        assertEquals(observed[0]?.dev, false);
        assertEquals(observed[0]?.mode, "production");
      });

      it("compiles as production but keeps preview instrumentation in hosted preview", async () => {
        const observed: LoadComponentOptions[] = [];
        await surface.load(HOSTED_PREVIEW_MODES, observed);

        assertEquals(observed.length, 1);
        assertEquals(observed[0]?.dev, false);
        assertEquals(observed[0]?.mode, "preview");
      });

      it("compiles as development and keeps preview instrumentation locally", async () => {
        const observed: LoadComponentOptions[] = [];
        await surface.load(LOCAL_DEV_MODES, observed);

        assertEquals(observed.length, 1);
        assertEquals(observed[0]?.dev, true);
        assertEquals(observed[0]?.mode, "preview");
      });
    });
  }

  describe("layout component cache isolation", () => {
    it("keeps the cache entries of the three mode pairs apart", async () => {
      const observed: LoadComponentOptions[] = [];
      const cache = createLayoutComponentCache();
      const deps = {
        loadComponentFromSource: (
          _source: string,
          _filePath: string,
          _projectDir: string,
          _adapter: RuntimeAdapter,
          options: LoadComponentOptions,
        ) => {
          observed.push(options);
          return Promise.resolve(stubComponent());
        },
      };

      const load = (modes: RenderModes) =>
        loadTSXComponent(
          "/project/app/layout.tsx",
          "/project",
          cache,
          layoutAdapter(LAYOUT_SOURCE),
          "project-shared",
          "project-slug",
          "release-1",
          modes,
          "19.1.0",
          deps,
        );

      await load(PRODUCTION_MODES);
      await load(HOSTED_PREVIEW_MODES);
      await load(LOCAL_DEV_MODES);

      // Three distinct compiles, not one entry reused across mode pairs.
      assertEquals(observed.length, 3);
      assertEquals(observed.map((options) => options.dev), [false, false, true]);
      assertEquals(
        observed.map((options) => options.mode),
        ["production", "preview", "preview"],
      );
    });
  });

  describe("components/ registry identity", () => {
    it("passes the registry identity fields through to the loader", async () => {
      const observed: LoadComponentOptions[] = [];
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
        "http://localhost:3000",
        "vendor-hash",
        "proj-uuid-123",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          observed.push(options);
          return Promise.resolve(stubComponent());
        },
        PRODUCTION_MODES,
      );

      await registry.loadFromDirectory("/project/components", true);
      await registry.prepareDependencySnapshot();

      assertEquals(observed[0]?.projectId, "proj-uuid-123");
      assertEquals(observed[0]?.moduleServerUrl, "http://localhost:3000");
      assertEquals(observed[0]?.vendorBundleHash, "vendor-hash");
      assertEquals(observed[0]?.contentSourceId, "branch:main");
    });

    it("falls back to the project root when the registry has no projectId", async () => {
      const observed: LoadComponentOptions[] = [];
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
        undefined,
        undefined,
        (_source, _filePath, _projectDir, _adapter, options) => {
          observed.push(options);
          return Promise.resolve(stubComponent());
        },
        PRODUCTION_MODES,
      );

      await registry.loadFromDirectory("/project/components", true);
      await registry.prepareDependencySnapshot();

      assertEquals(observed[0]?.projectId, "/project");
      assertEquals(observed[0]?.moduleServerUrl, undefined);
      assertEquals(observed[0]?.vendorBundleHash, undefined);
      assertEquals(observed[0]?.contentSourceId, undefined);
    });

    it("defaults to production when no render modes are supplied", async () => {
      const observed: LoadComponentOptions[] = [];
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
        "project-default",
        "release-1",
        (_source, _filePath, _projectDir, _adapter, options) => {
          observed.push(options);
          return Promise.resolve(stubComponent());
        },
      );

      await registry.loadFromDirectory("/project/components", true);
      await registry.prepareDependencySnapshot();

      // An unknown environment must never turn preview instrumentation on.
      assertEquals(observed[0]?.dev, false);
      assertEquals(observed[0]?.mode, "production");
    });
  });
});
