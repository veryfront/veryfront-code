import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import {
  createLayoutComponentCache,
  loadMDXLayout,
  loadTSXComponent,
  preloadMDXLayoutModule,
  shouldUnwrapAppRouterDocumentLayout,
  unwrapAppRouterDocumentLayout,
} from "./component-loader.ts";
import { type MDXLoadModuleOptions, mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { MdxBundle } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import {
  clearImportMapCache,
  getCachedImportMap,
} from "#veryfront/modules/import-map/preloader.ts";

const PRODUCTION_MODES = {
  compileMode: "production",
  environment: "production",
} as const;

/** Hosted preview: production compile, preview instrumentation. */
const PREVIEW_MODES = {
  compileMode: "production",
  environment: "preview",
} as const;

/** Local development: development compile, preview instrumentation. */
const DEVELOPMENT_MODES = {
  compileMode: "development",
  environment: "preview",
} as const;

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

const SNAPSHOT_A_DEPENDENCIES = { zod: "3.0.0" } as const;
const SNAPSHOT_A_PIN_KEY = cacheKeyForDependencies(SNAPSHOT_A_DEPENDENCIES);

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function layoutAdapter(source: string): RuntimeAdapter {
  return {
    fs: {
      readFile: () => Promise.resolve(source),
    },
  } as unknown as RuntimeAdapter;
}

describe("rendering/layouts/utils/component-loader", () => {
  it("loads prepared TSX and MDX layouts without reading source or sharing cached exports", async () => {
    const Component = () => null;
    const paths: string[] = [];
    const adapter = {
      fs: {
        readFile: () => {
          throw new Error("Source must not be reloaded");
        },
      },
      moduleLoader: {
        importModule: async (reference: { kind: string; path: string }) => {
          paths.push(reference.path);
          return { default: Component };
        },
      },
    } as unknown as RuntimeAdapter;
    const cache = {
      get: () => {
        throw new Error("Live exports must not use shared caches");
      },
      set: () => {
        throw new Error("Live exports must not use shared caches");
      },
      delete() {},
      clear() {},
    };
    assertStrictEquals(
      await loadTSXComponent(
        "/project/app/layout.tsx",
        "/project",
        cache,
        adapter,
        "project",
        "project",
        "release",
        PRODUCTION_MODES,
      ),
      Component,
    );
    assertStrictEquals(
      await loadMDXLayout({
        bundle: { compiledCode: 'throw new Error("Do not execute inline code");' },
        sourcePath: "/project/app/layout.mdx",
        projectDir: "/project",
        adapter,
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "release",
        modes: PRODUCTION_MODES,
      }),
      Component,
    );
    assertEquals(paths, ["/project/app/layout.tsx", "/project/app/layout.mdx"]);
  });
  describe("createLayoutComponentCache", () => {
    it("should create a cache with default max entries", () => {
      const cache = createLayoutComponentCache();
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
      assertEquals(typeof cache.delete, "function");
      assertEquals(typeof cache.clear, "function");
    });

    it("should create a cache with custom max entries", () => {
      const cache = createLayoutComponentCache(10);
      assertEquals(typeof cache.get, "function");
    });

    it("should clamp the per-project bucket to a small custom maxEntries", () => {
      function C() {
        return null;
      }
      // maxEntries=2 with the env-derived per-project default (larger than 2):
      // a single project's bucket must still respect the total budget of 2.
      const cache = createLayoutComponentCache(2);
      cache.set("layout:proj:/a:h1:c", C);
      cache.set("layout:proj:/b:h2:c", C);
      cache.set("layout:proj:/c:h3:c", C);

      // Oldest entry evicted at the requested cap, not the per-project default
      assertEquals(cache.get("layout:proj:/a:h1:c"), undefined);
      assertEquals(cache.get("layout:proj:/b:h2:c"), C);
      assertEquals(cache.get("layout:proj:/c:h3:c"), C);
    });
  });

  describe("InMemoryLayoutComponentCache (via factory)", () => {
    function DummyComponent() {
      return null;
    }
    function AnotherComponent() {
      return null;
    }

    // Use real-format keys: layout:{projectId}:{path}:{hash}:{csid}
    const key1 = "layout:proj:/path1:hash1:csid";
    const key2 = "layout:proj:/path2:hash2:csid";
    const key3 = "layout:proj:/path3:hash3:csid";

    it("should return undefined for missing keys", () => {
      const cache = createLayoutComponentCache();
      assertEquals(cache.get("layout:proj:/missing:h:c"), undefined);
    });

    it("should set and get a component", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      assertEquals(cache.get(key1), DummyComponent);
    });

    it("should overwrite existing key", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      cache.set(key1, AnotherComponent);
      assertEquals(cache.get(key1), AnotherComponent);
    });

    it("should delete a key", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      cache.delete(key1);
      assertEquals(cache.get(key1), undefined);
    });

    it("should clear all entries", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      cache.set(key2, AnotherComponent);
      cache.clear();
      assertEquals(cache.get(key1), undefined);
      assertEquals(cache.get(key2), undefined);
    });

    it("should evict oldest entry when per-project cap is reached", () => {
      // perProjectMaxEntries=2, maxEntries large enough not to evict the project bucket
      const cache = createLayoutComponentCache(100, 2);

      const C1 = () => null;
      const C2 = () => null;
      const C3 = () => null;

      cache.set(key1, C1);
      cache.set(key2, C2);
      cache.set(key3, C3);

      assertEquals(cache.get(key1), undefined);
      assertEquals(cache.get(key2), C2);
      assertEquals(cache.get(key3), C3);
    });

    it("should promote accessed entries (LRU behavior)", () => {
      const cache = createLayoutComponentCache(100, 2);

      const C1 = () => null;
      const C2 = () => null;
      const C3 = () => null;

      cache.set(key1, C1);
      cache.set(key2, C2);

      // Access key1 to promote it
      cache.get(key1);

      // Now key2 should be the oldest, so adding key3 should evict key2
      cache.set(key3, C3);

      assertEquals(cache.get(key1), C1);
      assertEquals(cache.get(key2), undefined);
      assertEquals(cache.get(key3), C3);
    });

    it("should handle clearForProject", () => {
      const cache = createLayoutComponentCache();
      const C1 = () => null;
      const C2 = () => null;

      cache.set("layout:project1:/path1:hash1:csid1", C1);
      cache.set("layout:project2:/path2:hash2:csid2", C2);

      cache.clearForProject?.("project1");

      assertEquals(cache.get("layout:project1:/path1:hash1:csid1"), undefined);
      assertEquals(cache.get("layout:project2:/path2:hash2:csid2"), C2);
    });

    it("should handle delete of non-existing key", () => {
      const cache = createLayoutComponentCache();
      cache.delete("layout:proj:/nonexistent:h:c"); // Should not throw
    });

    it("should handle per-project cap of 1", () => {
      const cache = createLayoutComponentCache(100, 1);
      const C1 = () => null;
      const C2 = () => null;

      cache.set(key1, C1);
      cache.set(key2, C2);

      assertEquals(cache.get(key1), undefined);
      assertEquals(cache.get(key2), C2);
    });
  });

  describe("PerProjectLayoutComponentCache (via factory with perProjectMaxEntries)", () => {
    function makeKey(projectId: string, index: number): string {
      return `layout:${projectId}:/path${index}:hash${index}:csid`;
    }

    it("should isolate project A entries from project B when A overflows its per-project cap", () => {
      // perProjectMaxEntries=2, maxProjects derived from maxEntries=10 / 2 = 5
      const cache = createLayoutComponentCache(10, 2);

      const B1 = () => null;
      const B2 = () => null;
      cache.set(makeKey("project-b", 1), B1);
      cache.set(makeKey("project-b", 2), B2);

      // Fill project A beyond its per-project cap of 2
      const A1 = () => null;
      const A2 = () => null;
      const A3 = () => null;
      cache.set(makeKey("project-a", 1), A1);
      cache.set(makeKey("project-a", 2), A2);
      cache.set(makeKey("project-a", 3), A3); // evicts A1 within project-a only

      // A1 should be gone, A2/A3 survive
      assertEquals(cache.get(makeKey("project-a", 1)), undefined);
      assertEquals(cache.get(makeKey("project-a", 2)), A2);
      assertEquals(cache.get(makeKey("project-a", 3)), A3);

      // Project B entries must be untouched
      assertEquals(cache.get(makeKey("project-b", 1)), B1);
      assertEquals(cache.get(makeKey("project-b", 2)), B2);
    });

    it("should not evict project B entries on heavy use of project A", () => {
      const cache = createLayoutComponentCache(20, 3);

      const BEntry = () => null;
      cache.set(makeKey("project-b", 1), BEntry);

      // Flood project A with 10 entries (cap=3, so 7 intra-A evictions happen)
      for (let i = 0; i < 10; i++) {
        cache.set(makeKey("project-a", i), () => null);
      }

      // Project B entry must still be present
      assertEquals(cache.get(makeKey("project-b", 1)), BEntry);
    });

    it("should remove only the target project on clearForProject", () => {
      const cache = createLayoutComponentCache(10, 2);

      const A1 = () => null;
      const B1 = () => null;
      cache.set(makeKey("project-a", 1), A1);
      cache.set(makeKey("project-b", 1), B1);

      cache.clearForProject?.("project-a");

      assertEquals(cache.get(makeKey("project-a", 1)), undefined);
      assertEquals(cache.get(makeKey("project-b", 1)), B1);
    });

    it("should remove all projects on clear()", () => {
      const cache = createLayoutComponentCache(10, 2);

      cache.set(makeKey("project-a", 1), () => null);
      cache.set(makeKey("project-b", 1), () => null);

      cache.clear();

      assertEquals(cache.get(makeKey("project-a", 1)), undefined);
      assertEquals(cache.get(makeKey("project-b", 1)), undefined);
    });
  });

  describe("App Router document layout unwrapping", () => {
    it("should detect the App Router root layout path", () => {
      for (const extension of ["tsx", "jsx", "ts", "js"]) {
        assertEquals(
          shouldUnwrapAppRouterDocumentLayout(
            `/project/app/layout.${extension}`,
            "/project",
          ),
          true,
        );
      }
      assertEquals(
        shouldUnwrapAppRouterDocumentLayout("/project/app/dashboard/layout.tsx", "/project"),
        false,
      );
    });

    it("should detect a configured App Router root layout path", () => {
      assertEquals(
        shouldUnwrapAppRouterDocumentLayout(
          "/project/src/site/layout.tsx",
          "/project",
          "src/site",
        ),
        true,
      );
      assertEquals(
        shouldUnwrapAppRouterDocumentLayout(
          "/project/src/site/dashboard/layout.tsx",
          "/project",
          "src/site",
        ),
        false,
      );
    });

    it("should preserve body children without mounting html and body inside the root", () => {
      function RootLayout({ children }: { children?: React.ReactNode }) {
        return React.createElement(
          "html",
          null,
          React.createElement("body", null, React.createElement("main", null, children)),
        );
      }

      const WrappedLayout = unwrapAppRouterDocumentLayout(React, RootLayout);
      const result = WrappedLayout({
        children: React.createElement("button", { id: "counter" }, "Count: 0"),
      }) as React.ReactElement<{ children?: React.ReactNode }>;

      assertEquals(result.type, "main");
      const child = React.Children.only(result.props.children) as React.ReactElement;
      assertEquals(child.type, "button");
    });

    it("should fall back to the passed children when the root renders no body", () => {
      function RootLayout({ children }: { children?: React.ReactNode }) {
        return React.createElement("html", null, children);
      }

      const WrappedLayout = unwrapAppRouterDocumentLayout(React, RootLayout);
      const passedChildren = React.createElement("button", { id: "counter" }, "Count: 0");
      const result = WrappedLayout({ children: passedChildren });

      assertStrictEquals(
        result,
        passedChildren,
        "a root layout without a direct <body> must fall back to the children it was given, not render blank",
      );
    });

    it("should pass through a root layout that does not render html", () => {
      function RootLayout({ children }: { children?: React.ReactNode }) {
        return React.createElement("div", { id: "shell" }, children);
      }

      const WrappedLayout = unwrapAppRouterDocumentLayout(React, RootLayout);
      const passedChildren = React.createElement("button", { id: "counter" }, "Count: 0");
      const result = WrappedLayout({ children: passedChildren }) as React.ReactElement<
        { children?: React.ReactNode }
      >;

      assertEquals(
        result.type,
        "div",
        "a root layout that does not render <html> must be passed through unchanged",
      );
      assertStrictEquals(
        React.Children.only(result.props.children),
        passedChildren,
        "the passed children must survive the pass-through unchanged",
      );
    });
  });

  describe("loadTSXComponent", () => {
    it("threads the request signal into a cold SSR component load", async () => {
      const cache = createLayoutComponentCache();
      const controller = new AbortController();
      let observedSignal: AbortSignal | undefined;
      const loading = loadTSXComponent(
        "/project/app/signal-layout.tsx",
        "/project",
        cache,
        layoutAdapter("export default function Layout() { return null; }"),
        "project-1",
        "project-slug",
        "release-1",
        PRODUCTION_MODES,
        "19.1.0",
        {
          loadComponentFromSource: (_source, _filePath, _projectDir, _adapter, options) => {
            observedSignal = options?.signal;
            return new Promise((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(options.signal?.reason),
                { once: true },
              );
            });
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller.signal,
      );

      await waitFor(() => observedSignal !== undefined);
      const reason = new DOMException("layout render cancelled", "AbortError");
      controller.abort(reason);

      await assertRejects(() => loading, Error, "layout render cancelled");
      assertEquals(observedSignal?.aborted, true);
      assertEquals(observedSignal?.reason, reason);
    });

    it("shares one component load for concurrent cold misses", async () => {
      const cache = createLayoutComponentCache();
      const loaded = Promise.withResolvers<React.ComponentType>();
      let loadCalls = 0;
      function Layout() {
        return null;
      }

      const first = loadTSXComponent(
        "/project/app/layout.tsx",
        "/project",
        cache,
        layoutAdapter("export default function Layout() { return null; }"),
        "project-1",
        "project-slug",
        "release-1",
        PRODUCTION_MODES,
        "19.1.0",
        {
          loadComponentFromSource: () => {
            loadCalls++;
            return loaded.promise;
          },
        },
      );
      const second = loadTSXComponent(
        "/project/app/layout.tsx",
        "/project",
        cache,
        layoutAdapter("export default function Layout() { return null; }"),
        "project-1",
        "project-slug",
        "release-1",
        PRODUCTION_MODES,
        "19.1.0",
        {
          loadComponentFromSource: () => {
            loadCalls++;
            return loaded.promise;
          },
        },
      );

      await waitFor(() => loadCalls > 0);
      assertEquals(loadCalls, 1);

      loaded.resolve(Layout);

      assertEquals(await Promise.all([first, second]), [Layout, Layout]);
      assertEquals(loadCalls, 1);
    });

    it("retries after a failed component load", async () => {
      const cache = createLayoutComponentCache();
      const failedLoad = Promise.withResolvers<React.ComponentType>();
      let loadCalls = 0;
      function Layout() {
        return null;
      }
      const deps = {
        loadComponentFromSource: () => {
          loadCalls++;
          return loadCalls === 1 ? failedLoad.promise : Promise.resolve(Layout);
        },
      };

      const first = loadTSXComponent(
        "/project/app/retry-layout.tsx",
        "/project",
        cache,
        layoutAdapter("export default function Layout() { return null; }"),
        "project-1",
        "project-slug",
        "release-1",
        PRODUCTION_MODES,
        "19.1.0",
        deps,
      );
      await waitFor(() => loadCalls > 0);
      const rejected = assertRejects(() => first, Error, "load failed");
      failedLoad.reject(new Error("load failed"));
      await rejected;

      assertEquals(
        await loadTSXComponent(
          "/project/app/retry-layout.tsx",
          "/project",
          cache,
          layoutAdapter("export default function Layout() { return null; }"),
          "project-1",
          "project-slug",
          "release-1",
          PRODUCTION_MODES,
          "19.1.0",
          deps,
        ),
        Layout,
      );
      assertEquals(loadCalls, 2);
    });

    it("rejects a load that resolves nothing instead of caching undefined", async () => {
      const cache = createLayoutComponentCache();
      let loadCalls = 0;
      function Layout() {
        return null;
      }
      const deps = {
        loadComponentFromSource: () => {
          loadCalls++;
          return loadCalls === 1
            ? Promise.resolve(undefined as unknown as React.ComponentType)
            : Promise.resolve(Layout);
        },
      };
      const args = [
        "/project/app/empty-layout.tsx",
        "/project",
        cache,
        layoutAdapter("export default function Layout() { return null; }"),
        "project-1",
        "project-slug",
        "release-1",
        PRODUCTION_MODES,
        "19.1.0",
        deps,
      ] as const;

      await assertRejects(
        () => loadTSXComponent(...args),
        Error,
        "Component loading failed",
        "an empty component load must surface as a classified render error",
      );

      assertEquals(
        await loadTSXComponent(...args),
        Layout,
        "a retry after an empty load must resolve the real component",
      );
      assertEquals(loadCalls, 2, "a failed load must not poison the layout component cache");
    });

    it("does not let a stale load overwrite its replacement cache entry", async () => {
      using time = new FakeTime();
      const cache = createLayoutComponentCache();
      const staleLoad = Promise.withResolvers<React.ComponentType>();
      const loadStarted = Promise.withResolvers<void>();
      let loadCalls = 0;
      function StaleLayout() {
        return null;
      }
      function ReplacementLayout() {
        return null;
      }
      function UnexpectedLayout() {
        return null;
      }
      const args = [
        "/project/app/stale-layout.tsx",
        "/project",
        cache,
        layoutAdapter("export default function Layout() { return null; }"),
        "project-1",
        "project-slug",
        "release-1",
        PRODUCTION_MODES,
        "19.1.0",
      ] as const;

      const stale = loadTSXComponent(...args, {
        loadComponentFromSource: () => {
          loadCalls++;
          loadStarted.resolve(undefined);
          return staleLoad.promise;
        },
      });
      await loadStarted.promise;

      await time.tickAsync(5 * 60_000);
      assertEquals(
        await loadTSXComponent(...args, {
          loadComponentFromSource: () => {
            loadCalls++;
            return Promise.resolve(ReplacementLayout);
          },
        }),
        ReplacementLayout,
      );

      staleLoad.resolve(StaleLayout);
      assertEquals(await stale, StaleLayout);
      assertEquals(
        await loadTSXComponent(...args, {
          loadComponentFromSource: () => {
            loadCalls++;
            return Promise.resolve(UnexpectedLayout);
          },
        }),
        ReplacementLayout,
      );
      assertEquals(loadCalls, 2);
    });
  });

  it("threads the project React version into MDX layout module loading", async () => {
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let moduleReactVersion: unknown;
    let modulePinKey: unknown;
    let moduleDependencies: unknown;
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      const loadOptions = options as MDXLoadModuleOptions | undefined;
      moduleReactVersion = loadOptions?.reactVersion;
      modulePinKey = loadOptions?.dependencyPinningCacheKey;
      moduleDependencies = loadOptions?.dependencyPinningDependencies;
      return Promise.resolve({ default: () => null });
    };

    try {
      await loadMDXLayout({
        bundle: {
          compiledCode: "export default function Layout() { return null; }",
        } as MdxBundle,
        projectDir: "/project",
        adapter: { fs: {} } as unknown as RuntimeAdapter,
        projectId: "project-18",
        projectSlug: "project-slug",
        contentSourceId: "preview-main",
        modes: PRODUCTION_MODES,
        preloadedImportMap: { imports: {} },
        reactVersion: "18.3.1",
        dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
        dependencyPinningDependencies: SNAPSHOT_A_DEPENDENCIES,
      });

      assertEquals(moduleReactVersion, "18.3.1");
      assertEquals(modulePinKey, SNAPSHOT_A_PIN_KEY);
      assertEquals(moduleDependencies, SNAPSHOT_A_DEPENDENCIES);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("resolves MDX layout exports in MDXLayout, MainLayout, default order", async () => {
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    function MDXLayoutExport() {
      return null;
    }
    function MainLayoutExport() {
      return null;
    }
    function DefaultExport() {
      return null;
    }
    const stubModule = (mod: Record<string, unknown>) => {
      mutableRenderer.loadModuleESM =
        (() => Promise.resolve(mod)) as typeof mdxRenderer.loadModuleESM;
    };
    const baseOptions = {
      bundle: {
        compiledCode: "export default function Layout() { return null; }",
      } as MdxBundle,
      projectDir: "/project",
      adapter: { fs: {} } as unknown as RuntimeAdapter,
      projectId: "export-order-project",
      projectSlug: "project-slug",
      contentSourceId: "release-1",
      modes: PRODUCTION_MODES,
      preloadedImportMap: { imports: {} },
      reactVersion: "19.1.1",
    };

    try {
      stubModule({
        MDXLayout: MDXLayoutExport,
        MainLayout: MainLayoutExport,
        default: DefaultExport,
      });
      assertStrictEquals(
        await loadMDXLayout(baseOptions),
        MDXLayoutExport,
        "MDXLayout must win over MainLayout and default",
      );

      stubModule({ MainLayout: MainLayoutExport, default: DefaultExport });
      assertStrictEquals(
        await loadMDXLayout(baseOptions),
        MainLayoutExport,
        "MainLayout must win over default",
      );

      stubModule({ default: DefaultExport });
      assertStrictEquals(
        await loadMDXLayout(baseOptions),
        DefaultExport,
        "the default export must be used when no named layout export exists",
      );
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("unpacks the compile half of the render modes into MDX layout module loading", async () => {
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    const observed: Array<MDXLoadModuleOptions | undefined> = [];
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observed.push(options as MDXLoadModuleOptions | undefined);
      return Promise.resolve({ default: () => null });
    };

    const loadWithModes = (modes: RenderModes) =>
      loadMDXLayout({
        bundle: {
          compiledCode: "export default function Layout() { return null; }",
        } as MdxBundle,
        projectDir: "/project",
        adapter: { fs: {} } as unknown as RuntimeAdapter,
        projectId: "mode-project",
        projectSlug: "project-slug",
        contentSourceId: "release-1",
        modes,
        preloadedImportMap: { imports: {} },
        reactVersion: "19.1.1",
      });

    try {
      // A layout's own `/_vf_modules/*` imports must compile for the same mode
      // as the page that wraps them. The loader speaks the compile vocabulary
      // only, so the hosted preview pair is the case that fails if the request
      // vocabulary is unpacked in its place.
      await loadWithModes(DEVELOPMENT_MODES);
      await loadWithModes(PREVIEW_MODES);
      await loadWithModes(PRODUCTION_MODES);

      assertEquals(observed.map((options) => options?.mode), [
        "development",
        "production",
        "production",
      ]);
      assertEquals(observed.map((options) => options?.projectSlug), [
        "project-slug",
        "project-slug",
        "project-slug",
      ]);
      assertEquals(observed.map((options) => options?.reactVersion), [
        "19.1.1",
        "19.1.1",
        "19.1.1",
      ]);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("unpacks the compile half of the render modes when preloading an MDX layout", async () => {
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    const observed: Array<MDXLoadModuleOptions | undefined> = [];
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observed.push(options as MDXLoadModuleOptions | undefined);
      return Promise.resolve({ default: () => null });
    };

    const preloadWithModes = (modes: RenderModes) =>
      preloadMDXLayoutModule({
        bundle: {
          compiledCode: "export default function Layout() { return null; }",
        } as MdxBundle,
        projectDir: "/project",
        adapter: { fs: {} } as unknown as RuntimeAdapter,
        projectId: "preload-mode-project",
        projectSlug: "preload-project-slug",
        contentSourceId: "release-1",
        modes,
        reactVersion: "19.1.1",
        isLocalProject: true,
      });

    try {
      // Preloading warms the same module cache the apply phase reads back, so
      // it must resolve the identical compile mode for the identical pair.
      await preloadWithModes(DEVELOPMENT_MODES);
      await preloadWithModes(PREVIEW_MODES);
      await preloadWithModes(PRODUCTION_MODES);

      assertEquals(observed.map((options) => options?.mode), [
        "development",
        "production",
        "production",
      ]);
      assertEquals(observed.map((options) => options?.isLocalProject), [true, true, true]);
      assertEquals(observed.map((options) => options?.projectSlug), [
        "preload-project-slug",
        "preload-project-slug",
        "preload-project-slug",
      ]);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });

  it("preloads the MDX import map under the exact request context", async () => {
    clearImportMapCache();
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    mutableRenderer.loadModuleESM =
      (() => Promise.resolve({ default: () => null })) as typeof mdxRenderer.loadModuleESM;

    const adapter = {
      fs: {
        readFile: () => {
          const error = new Error("not found") as Error & { code: string };
          error.code = "ENOENT";
          throw error;
        },
        exists: () => false,
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const config = validateVeryfrontConfig({
      resolve: {
        importMap: {
          imports: { "context-package": "https://example.com/context-package.ts" },
        },
      },
    });

    try {
      await loadMDXLayout({
        bundle: {
          compiledCode: "export default function Layout() { return null; }",
        } as MdxBundle,
        projectDir: "/context-project",
        adapter,
        projectId: "context-project-id",
        projectSlug: "project-slug",
        contentSourceId: "release-1",
        modes: PRODUCTION_MODES,
        reactVersion: "19.1.0",
        dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
        dependencyPinningDependencies: SNAPSHOT_A_DEPENDENCIES,
        config,
      });

      // The production call site must register the preloaded map under the
      // exact release/config variant, not the ambient projectId-only variant.
      const exactVariant = await getCachedImportMap("context-project-id", {
        projectDir: "/context-project",
        contentSourceId: "release-1",
        config,
      });
      assertEquals(
        exactVariant?.imports?.["context-package"],
        "https://example.com/context-package.ts",
      );

      const otherContentSource = await getCachedImportMap("context-project-id", {
        projectDir: "/context-project",
        contentSourceId: "release-2",
        config,
      });
      assertEquals(otherContentSource, undefined);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });

  it("settles direct import-map loading when the request is canceled", async () => {
    clearImportMapCache();
    const controller = new AbortController();
    const cancellation = new Error("render canceled during direct import-map loading");
    let releaseRead: ((source: string) => void) | undefined;
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const adapter = {
      fs: {
        readFile: () =>
          new Promise<string>((resolve) => {
            releaseRead = resolve;
            markReadStarted?.();
          }),
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const loading = loadMDXLayout({
      bundle: {
        compiledCode: "export default function Layout() { return null; }",
      } as MdxBundle,
      projectDir: "/direct-import-map-cancel-project",
      adapter,
      projectId: "direct-import-map-cancel-project-id",
      projectSlug: "direct-import-map-cancel-project",
      contentSourceId: "release-1",
      modes: PRODUCTION_MODES,
      reactVersion: "19.1.1",
      signal: controller.signal,
    });

    await readStarted;
    controller.abort(cancellation);
    const timeout = Symbol("import-map cancellation timed out");
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        loading.catch((error) => error),
        new Promise<symbol>((resolve) => {
          timeoutId = setTimeout(() => resolve(timeout), 25);
        }),
      ]);
      assertStrictEquals(
        result,
        cancellation,
        "request cancellation must settle without waiting for import-map I/O",
      );
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      releaseRead?.("{}");
      await loading.catch(() => undefined);
      clearImportMapCache("direct-import-map-cancel-project-id");
    }
  });

  it("uses the request snapshot in the TSX layout cache key", async () => {
    function CachedLayout() {
      return null;
    }
    let requestedCacheKey = "";
    const cache = {
      get(key: string) {
        requestedCacheKey = key;
        return CachedLayout;
      },
      set() {},
      delete() {},
      clear() {},
    };
    const adapter = {
      fs: {
        readFile: () => Promise.resolve("export default function Layout() { return null; }"),
      },
    } as unknown as RuntimeAdapter;

    const loaded = await loadTSXComponent(
      "/project/layout.tsx",
      "/project",
      cache,
      adapter,
      "project-id",
      "project-slug",
      "preview-main",
      PRODUCTION_MODES,
      "19.1.1",
      undefined,
      SNAPSHOT_A_PIN_KEY,
      SNAPSHOT_A_DEPENDENCIES,
    );

    assertEquals(loaded, CachedLayout);
    assertEquals(
      requestedCacheKey.endsWith(`:19.1.1:pins:${SNAPSHOT_A_PIN_KEY}`),
      true,
    );
  });

  it("preserves the legacy TSX layout cache key when pinning is off", async () => {
    function CachedLayout() {
      return null;
    }
    const requestedKeys: string[] = [];
    const cache = {
      get(key: string) {
        requestedKeys.push(key);
        return CachedLayout;
      },
      set() {},
      delete() {},
      clear() {},
    };
    const adapter = {
      fs: {
        readFile: () => Promise.resolve("export default function Layout() { return null; }"),
      },
    } as unknown as RuntimeAdapter;
    const common = [
      "/project/layout.tsx",
      "/project",
      cache,
      adapter,
      "project-id",
      "project-slug",
      "preview-main",
      PRODUCTION_MODES,
      "19.1.1",
    ] as const;

    await loadTSXComponent(...common);
    await loadTSXComponent(
      ...common,
      undefined,
      "off",
      undefined,
      undefined,
      "https://app.example",
    );

    assertEquals(requestedKeys.length, 2);
    assertEquals(requestedKeys[1], requestedKeys[0]);
    assertEquals(requestedKeys[0]?.includes(":pins:"), false);
  });

  it("isolates the TSX layout cache by the server external package set", async () => {
    function CachedLayout() {
      return null;
    }
    const requestedKeys: string[] = [];
    const cache = {
      get(key: string) {
        requestedKeys.push(key);
        return CachedLayout;
      },
      set() {},
      delete() {},
      clear() {},
    };
    const adapter = {
      fs: {
        readFile: () => Promise.resolve("export default function Layout() { return null; }"),
      },
    } as unknown as RuntimeAdapter;
    const common = [
      "/project/layout.tsx",
      "/project",
      cache,
      adapter,
      "project-id",
      "project-slug",
      "preview-main",
      PRODUCTION_MODES,
      "19.1.1",
      undefined,
      "off",
      undefined,
      undefined,
      undefined,
    ] as const;

    await loadTSXComponent(...common);
    await loadTSXComponent(...common, ["knex", "@prisma/client"]);
    await loadTSXComponent(...common, ["@prisma/client", "knex"]);

    assertEquals(requestedKeys[0] === requestedKeys[1], false);
    assertEquals(requestedKeys[2], requestedKeys[1]);
  });
});
