import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type LayoutApplicationOptions, LayoutApplicator } from "./layout-applicator.ts";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { PageContextProvider, RouterProvider } from "#veryfront/react/runtime/core.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { createLayoutComponentCache } from "./utils/component-loader.ts";
import {
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { isVeryfrontError } from "#veryfront/errors";

/** Passthrough stand-ins for the framework providers, so the tree stays readable. */
const Pass = ({ children }: { children?: React.ReactNode }) => children;

type ProviderModules = {
  PageContextProvider: React.ComponentType<Record<string, unknown>>;
  RouterProvider: React.ComponentType<Record<string, unknown>>;
};

function createAdapter(files: Record<string, string> = {}): RuntimeAdapter {
  return {
    fs: {
      exists: (path: string) => Promise.resolve(path in files),
      readFile: (path: string) => {
        const content = files[path];
        if (content === undefined) {
          return Promise.reject(
            FILE_NOT_FOUND.create({
              detail: "Layout fixture file not found",
              context: { operation: "read" },
            }),
          );
        }
        return Promise.resolve(content);
      },
      readDir: async function* () {},
      writeFile: () => Promise.resolve(),
      mkdir: () => Promise.resolve(),
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

function createPageInfo(
  path: string,
  slug: string,
  frontmatter: Record<string, unknown> = {},
): EntityInfo {
  return {
    entity: { id: path, path, slug, type: "page", content: "", frontmatter },
  } as unknown as EntityInfo;
}

/**
 * Builds an applicator whose framework providers are pre-seeded, so applyLayouts
 * can be driven end to end without compiling the real context/router modules.
 */
function createApplicator(
  overrides: Partial<LayoutApplicationOptions> = {},
): LayoutApplicator {
  const applicator = new LayoutApplicator({
    projectDir: "/project",
    projectId: "project",
    projectSlug: "project",
    contentSourceId: "preview-main",
    adapter: createAdapter(),
    config: {} as VeryfrontConfig,
    layoutCache: createLayoutComponentCache(),
    mergedComponents: {},
    mode: "production",
    environment: "production",
    reactVersion: "19.1.1",
    ...overrides,
  });

  (applicator as unknown as { frameworkProviderModulesPromise: Promise<ProviderModules> })
    .frameworkProviderModulesPromise = Promise.resolve({
      PageContextProvider: Pass as React.ComponentType<Record<string, unknown>>,
      RouterProvider: Pass as React.ComponentType<Record<string, unknown>>,
    });

  return applicator;
}

describe("LayoutApplicator helpers", () => {
  it("loads prepared providers and an MDX app by its original source identity", async () => {
    const appPath = "/project/components/app.mdx";
    const adapter = createAdapter({ [appPath]: 'throw new Error("Do not compile this source");' });
    const App = ({ children }: { children?: React.ReactNode }) =>
      React.createElement("article", null, children);
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          if (reference.kind === "source" && reference.path === appPath) return { default: App };
          if (reference.kind === "package") {
            if (reference.specifier === "react") return { default: React };
            if (reference.specifier === "veryfront/context") return { PageContextProvider };
            if (reference.specifier === "veryfront/router") return { RouterProvider };
          }
          throw new Error("Module was not prepared");
        },
      },
    });
    const applicator = new LayoutApplicator({
      projectDir: "/project",
      projectId: "project",
      projectSlug: "project",
      contentSourceId: "release",
      adapter,
      config: { app: "components/app.mdx" },
      layoutCache: createLayoutComponentCache(),
      mergedComponents: {},
      mode: "production",
      environment: "production",
      reactVersion: React.version,
    });
    const element = await applicator.applyLayouts(
      React.createElement("main", null, "prepared"),
      createPageInfo("/project/pages/page.mdx", "page"),
      undefined,
      [],
    );
    assertEquals(renderToString(element), "<article><main>prepared</main></article>");
  });
  afterEach(() => {
    resetReactCache();
    __setServerModuleLoaderForTests(null);
  });

  describe("applyLayouts SSR router", () => {
    it("builds the router from the request URL and route params", async () => {
      __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));
      const applicator = createApplicator({
        requestUrl: new URL("https://example.com/about?foo=bar"),
        params: { id: ["123", "extra"] },
      });

      const result = await applicator.applyLayouts(
        React.createElement("main"),
        createPageInfo("/project/pages/about.tsx", "about"),
        undefined,
        [],
      );

      const router = (result.props as { router: Record<string, unknown> }).router;
      assertEquals(
        router.params,
        { id: "123/extra" },
        "catch-all params must reach the SSR router joined, not first-segment-only",
      );
      assertEquals(
        router.pathname,
        "/about",
        "SSR router pathname must come from the request URL",
      );
      assertEquals(
        router.domain,
        "https://example.com",
        "SSR router domain must be the request origin",
      );
      assertEquals(
        router.query,
        { foo: "bar" },
        "SSR router query must come from the request search params",
      );
    });

    it("falls back to the page file path and slug without a request URL", async () => {
      __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));
      const applicator = createApplicator();

      const result = await applicator.applyLayouts(
        React.createElement("main"),
        createPageInfo("/project/pages/about.tsx", "about"),
        undefined,
        [],
      );

      const router = (result.props as { router: Record<string, unknown> }).router;
      assertEquals(
        router.domain,
        "",
        "the SSR router domain is empty without a request URL",
      );
      assertEquals(
        router.path,
        "/project/pages/about.tsx",
        "path falls back to the page file path",
      );
      assertEquals(router.pathname, "/about", "pathname falls back to the entity slug");
      assertEquals(router.query, {}, "query is empty without a request URL");
    });
  });

  describe("applyLayouts page context", () => {
    it("exposes getServerData props and the entity frontmatter", async () => {
      __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));
      const applicator = createApplicator({
        config: { react: { version: "19.1.1" } } as VeryfrontConfig,
        pageProps: { user: "kim" },
      });

      const result = await applicator.applyLayouts(
        React.createElement("main"),
        createPageInfo("/project/pages/about.tsx", "about", { title: "About" }),
        undefined,
        [],
      );

      const contextElement = (result.props as { children: React.ReactElement }).children;
      const ctx = (contextElement.props as { pageContext: Record<string, unknown> }).pageContext;
      assertEquals(
        ctx.data,
        { user: "kim" },
        "getServerData props must reach the page context as `data`",
      );
      assertEquals(
        ctx.frontmatter,
        { title: "About" },
        "frontmatter must fall back to pageInfo.entity.frontmatter when options.frontmatter is absent",
      );
      assertEquals(ctx.slug, "about", "the page context carries the entity slug");
      assertEquals(
        ctx.path,
        "/project/pages/about.tsx",
        "the page context carries the page file path",
      );
    });
  });

  describe("LayoutApplicationOptions type", () => {
    it("should accept valid options", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        projectDir: "/project",
        projectId: "proj-123",
        projectSlug: "my-project",
        contentSourceId: "branch:main",
        mode: "development",
      };
      assertEquals(opts.projectDir, "/project");
      assertEquals(opts.mode, "development");
    });

    it("should accept production mode", () => {
      const opts: Partial<LayoutApplicationOptions> = { mode: "production" };
      assertEquals(opts.mode, "production");
    });

    it("should accept optional requestUrl", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        requestUrl: new URL("https://example.com/about"),
      };
      assertEquals(opts.requestUrl?.pathname, "/about");
    });

    it("should accept optional params", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        params: { slug: "post-1" },
      };
      assertEquals(opts.params, { slug: "post-1" });
    });

    it("should accept optional frontmatter", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        frontmatter: { title: "Test", description: "A test page" },
      };
      assertEquals((opts.frontmatter as { title?: string } | undefined)?.title, "Test");
    });

    it("should accept optional headings", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        headings: [{ id: "h1", text: "Hello", level: 1 }],
      };
      assertEquals(opts.headings?.length, 1);
    });
  });

  describe("layout module routing", () => {
    /** Records whether layout routing reaches secure module loading or the
     * disabled synchronous renderer that returns a migration placeholder. */
    const recordLayoutPath = async (config: VeryfrontConfig): Promise<string[]> => {
      __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));
      const calls: string[] = [];
      const originalLoadModuleESM = mdxRenderer.loadModuleESM;
      const originalRender = mdxRenderer.render;
      const mutableRenderer = mdxRenderer as unknown as {
        loadModuleESM: typeof mdxRenderer.loadModuleESM;
        render: typeof mdxRenderer.render;
      };

      mutableRenderer.loadModuleESM = () => {
        calls.push("loadModuleESM");
        return Promise.resolve({ default: () => null });
      };
      mutableRenderer.render = () => {
        calls.push("render");
        return React.createElement("div");
      };

      try {
        await (applicator(config) as unknown as {
          applyLayoutsOnly(
            pageElement: React.ReactElement,
            layoutBundle: MdxBundle | undefined,
            nestedLayouts: LayoutItem[],
            layoutDataMap?: Map<string, Record<string, unknown>>,
            reactVersion?: string,
          ): Promise<React.ReactElement>;
        }).applyLayoutsOnly(
          React.createElement("main"),
          undefined,
          [{
            kind: "mdx",
            path: "/project/app/layout.mdx",
            bundle: {
              compiledCode: "export default function NestedLayout() { return null; }",
            },
          }] as LayoutItem[],
          undefined,
          "19.1.1",
        );
      } finally {
        mutableRenderer.loadModuleESM = originalLoadModuleESM;
        mutableRenderer.render = originalRender;
      }

      return calls;
    };

    const applicator = (config: VeryfrontConfig) => createApplicator({ config });

    it("routes to applyLayoutsESM when experimental.esmLayouts is set", async () => {
      assertEquals(
        await recordLayoutPath(
          { experimental: { esmLayouts: true } } as unknown as VeryfrontConfig,
        ),
        ["loadModuleESM"],
        "experimental.esmLayouts: true must route to applyLayoutsESM",
      );
    });

    it("uses the secure ESM path without the legacy flag", async () => {
      assertEquals(
        await recordLayoutPath({} as VeryfrontConfig),
        ["loadModuleESM"],
        "an absent esmLayouts flag must not invoke the disabled synchronous renderer",
      );
    });
  });

  it("loads a hosted-preview App component with the preview environment", async () => {
    const appPath = "/project/components/app.tsx";
    const adapter = {
      fs: {
        exists: (path: string) => Promise.resolve(path === appPath),
        readFile: (path: string) =>
          path === appPath
            ? Promise.resolve(
              `export default function App({ children }) {
  return <section id="app-shell">{children}</section>;
}`,
            )
            : Promise.reject(new Error("not found")),
        readDir: async function* () {},
        writeFile: () => Promise.resolve(),
        mkdir: () => Promise.resolve(),
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const App = ({ children }: { children?: React.ReactNode }) =>
      React.createElement("section", { id: "app-shell" }, children);
    let observedEnvironment: string | undefined;
    const applicator = new LayoutApplicator(
      {
        projectDir: "/project",
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "preview-main",
        adapter,
        config: { react: { version: "19.1.1" } },
        layoutCache: createLayoutComponentCache(),
        mergedComponents: {},
        mode: "production",
        environment: "preview",
      },
      {
        loadComponentFromSource: (_source, _path, _projectDir, _adapter, options) => {
          observedEnvironment = options?.mode;
          return Promise.resolve(App);
        },
      },
    );

    const element = await (applicator as unknown as {
      wrapWithAppComponent(element: React.ReactElement): Promise<React.ReactElement>;
    }).wrapWithAppComponent(React.createElement("main", null, "Page"));

    assertEquals(observedEnvironment, "preview");
    assertEquals(element.type, App);
  });

  it("searches configured App Router directories for reserved components", async () => {
    const reads: string[] = [];
    const adapter = {
      fs: {
        readFile: (path: string) => {
          reads.push(path);
          return Promise.reject(
            FILE_NOT_FOUND.create({
              detail: "Reserved component fixture not found",
              context: { operation: "read" },
            }),
          );
        },
      },
    } as unknown as RuntimeAdapter;
    __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));

    const applicator = new LayoutApplicator({
      projectDir: "/project",
      projectId: "project",
      projectSlug: "project",
      contentSourceId: "preview-main",
      adapter,
      config: {
        directories: { app: "src/site" },
        react: { version: "18.3.1" },
      },
      layoutCache: createLayoutComponentCache(),
      mergedComponents: {},
      mode: "production",
      environment: "production",
    });

    await (applicator as unknown as {
      wrapWithReservedComponents(
        element: React.ReactElement,
        path: string,
      ): Promise<React.ReactElement>;
    }).wrapWithReservedComponents(
      React.createElement("main"),
      "/project/src/site/blog/page.tsx",
    );

    assertEquals(
      reads.some((path) => path.startsWith("/project/src/site/")),
      true,
    );
    assertEquals(reads.some((path) => path.startsWith("/project/app/")), false);
  });

  it("wraps the page in the discovered loading and error boundaries", async () => {
    const Loading = () => React.createElement("p", null, "Loading");
    const ErrorPage = () => React.createElement("p", null, "Error");
    const adapter = createAdapter({
      "/project/src/site/loading.tsx": "export default function Loading() {}",
      "/project/src/site/error.tsx": "export default function ErrorPage() {}",
    });
    __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));

    const applicator = new LayoutApplicator(
      {
        projectDir: "/project",
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "preview-main",
        adapter,
        config: {
          directories: { app: "src/site" },
          react: { version: "19.1.1" },
        } as VeryfrontConfig,
        layoutCache: createLayoutComponentCache(),
        mergedComponents: {},
        mode: "production",
        environment: "production",
        reactVersion: "19.1.1",
      },
      {
        loadComponentFromSource: (_source, path) =>
          Promise.resolve(
            (path.endsWith("loading.tsx") ? Loading : ErrorPage) as React.ComponentType<
              Record<string, unknown>
            >,
          ),
      },
    );

    const page = React.createElement("main");
    const result = await (applicator as unknown as {
      wrapWithReservedComponents(
        element: React.ReactElement,
        path: string,
      ): Promise<React.ReactElement>;
    }).wrapWithReservedComponents(page, "/project/src/site/blog/page.tsx");

    assertEquals(
      typeof result.type,
      "function",
      "error.tsx must wrap the page in an error boundary",
    );
    const inner = (result.props as { children: React.ReactElement }).children;
    assertEquals(inner.type, React.Suspense, "loading.tsx must wrap the page in Suspense");
    assertEquals(
      (inner.props as { fallback: React.ReactElement }).fallback.type,
      Loading,
      "Suspense fallback must be the loading component",
    );
    assertEquals(
      (inner.props as { children: React.ReactElement }).children,
      page,
      "the page element must stay inside both boundaries",
    );
  });

  it("preserves reserved component compilation failures as private causes", async () => {
    const failure = new Error("reserved component compilation failed");
    const applicator = new LayoutApplicator(
      {
        projectDir: "/project",
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "preview-main",
        adapter: createAdapter({
          "/project/app/loading.tsx": "export default function Loading() {}",
        }),
        config: { react: { version: "19.1.1" } } as VeryfrontConfig,
        layoutCache: createLayoutComponentCache(),
        mergedComponents: {},
        mode: "production",
        environment: "production",
        reactVersion: "19.1.1",
      },
      {
        loadComponentFromSource: () => Promise.reject(failure),
      },
    );

    const error = await assertRejects(() =>
      (applicator as unknown as {
        wrapWithReservedComponents(
          element: React.ReactElement,
          path: string,
        ): Promise<React.ReactElement>;
      }).wrapWithReservedComponents(
        React.createElement("main"),
        "/project/app/page.tsx",
      )
    );

    assertEquals(isVeryfrontError(error), true);
    if (!isVeryfrontError(error)) throw error;
    assertEquals(error.slug, "component-error");
    assertEquals(error.message, "Reserved component could not be loaded");
    assertStrictEquals(error.cause, failure);
  });
});
