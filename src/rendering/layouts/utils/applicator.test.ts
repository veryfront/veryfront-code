import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import "#veryfront/schemas/_test-setup.ts";
// Node position injection needs the babel CodeParser contract registered.
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { renderToStringAdapter } from "#veryfront/react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { applyLayoutsESM, applyLayoutsFunctionBody } from "./applicator.ts";
import { createLayoutComponentCache } from "./component-loader.ts";
import {
  __injectProjectReactForTests,
  __injectReactDOMServerForTests,
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "../../../react/compat/ssr-adapter/server-loader.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    fs: {
      readFile: async () => "",
      exists: async () => false,
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

const PRODUCTION_MODES = {
  compileMode: "production",
  environment: "production",
} as const;

/** Hosted preview: production compile, preview instrumentation. */
const PREVIEW_MODES = {
  compileMode: "production",
  environment: "preview",
} as const;

/** Local development: dev compile, preview instrumentation. */
const DEVELOPMENT_MODES = {
  compileMode: "development",
  environment: "preview",
} as const;

const LAYOUT_SOURCE =
  `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <div id="tsx-layout">{children}</div>;
}
`;

/** Renders the props the layout receives, so layoutDataMap threading is visible in the HTML. */
const LAYOUT_SOURCE_WITH_DATA =
  `export default function RootLayout({ children, title }: { children: React.ReactNode; title?: string }) {
  return <div id="tsx-layout"><h1>{title}</h1>{children}</div>;
}
`;

// Sanitizers are disabled for the whole suite because two process-wide
// singletons this suite starts outlive any single case and cannot be closed
// from here: the esbuild bundler service child process that compiles the TSX
// layouts, and the React 19 ReactDOMServer MessagePort that renderToString
// keeps open. std/bdd checks leaks once per describe, not per step, so these
// cannot be narrowed to the cases that cause them.
describe(
  "rendering/layouts/utils/applicator",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterEach(() => {
      resetReactCache();
      __setServerModuleLoaderForTests(null);
    });

    describe("applyLayoutsESM", () => {
      it("should return page element unchanged when no layouts and no bundle", async () => {
        const adapter = createMockAdapter();
        const pageElement = React.createElement("div", null, "test") as React.ReactElement;
        const cache = createLayoutComponentCache();

        const result = await applyLayoutsESM(
          pageElement,
          undefined, // no layoutBundle
          [], // no nested layouts
          "/project",
          {}, // merged components
          cache,
          adapter,
          undefined, // layoutDataMap
          "project-id",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        assertEquals(React.isValidElement(result), true);
        assertEquals(result, pageElement);
      });

      it("should skip null items in nested layouts", async () => {
        const adapter = createMockAdapter();
        const pageElement = React.createElement("div", null, "test") as React.ReactElement;
        const cache = createLayoutComponentCache();

        const nestedLayouts = [null, undefined] as unknown as LayoutItem[];

        const result = await applyLayoutsESM(
          pageElement,
          undefined,
          nestedLayouts,
          "/project",
          {},
          cache,
          adapter,
          undefined,
          "project-id",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        assertEquals(React.isValidElement(result), true);
      });

      it("should skip layouts that are not mdx or tsx", async () => {
        const adapter = createMockAdapter();
        const pageElement = React.createElement("div", null, "test") as React.ReactElement;
        const cache = createLayoutComponentCache();

        const nestedLayouts: LayoutItem[] = [
          { kind: "unknown" } as unknown as LayoutItem,
        ];

        const result = await applyLayoutsESM(
          pageElement,
          undefined,
          nestedLayouts,
          "/project",
          {},
          cache,
          adapter,
          undefined,
          "project-id",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        assertEquals(React.isValidElement(result), true);
      });

      it("threads the compile mode into every MDX layout load", async () => {
        __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));
        const originalLoadModuleESM = mdxRenderer.loadModuleESM;
        const mutableRenderer = mdxRenderer as unknown as {
          loadModuleESM: typeof mdxRenderer.loadModuleESM;
        };
        const observed: Array<Record<string, unknown>> = [];
        mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
          observed.push({ ...(options as Record<string, unknown> | undefined) });
          return Promise.resolve({ default: () => null });
        };

        const config = {
          build: { serverExternalPackages: ["knex"] },
        } as unknown as VeryfrontConfig;

        const applyWithModes = (modes: RenderModes) =>
          applyLayoutsESM(
            React.createElement("div", null, "page") as React.ReactElement,
            {
              compiledCode: "export default function NamedLayout() { return null; }",
            } as MdxBundle,
            [{
              kind: "mdx",
              path: "/project/layout.mdx",
              bundle: {
                compiledCode: "export default function NestedLayout() { return null; }",
              },
            }] as LayoutItem[],
            "/project",
            {},
            createLayoutComponentCache(),
            createMockAdapter(),
            undefined,
            "project-id",
            "project-slug",
            "content-source-id",
            modes,
            { imports: {} },
            "19.1.1",
            undefined,
            undefined,
            undefined,
            undefined,
            config,
            true,
            undefined,
          );

        try {
          await applyWithModes(DEVELOPMENT_MODES);
          await applyWithModes(PREVIEW_MODES);
          await applyWithModes(PRODUCTION_MODES);

          // Both MDX layout call sites (the nested layouts and the
          // frontmatter-named bundle) decide the compile mode of the layout's
          // own `/_vf_modules/*` imports, so both must carry it. A hosted
          // preview render proves the compile half of the pair travels, not
          // the environment half.
          assertEquals(observed.length, 6);
          assertEquals(observed.map((options) => options.mode), [
            "development",
            "development",
            "production",
            "production",
            "production",
            "production",
          ]);
          // The compile mode rides a positional chain long enough that a value
          // in the wrong slot still type-checks, so pin its neighbours here.
          assertEquals(
            observed.map((options) => options.isLocalProject),
            [true, true, true, true, true, true],
          );
          assertEquals(
            observed.map((options) => options.serverExternalPackages),
            [["knex"], ["knex"], ["knex"], ["knex"], ["knex"], ["knex"]],
          );
          assertEquals(
            observed.map((options) => options.projectSlug),
            [
              "project-slug",
              "project-slug",
              "project-slug",
              "project-slug",
              "project-slug",
              "project-slug",
            ],
          );
        } finally {
          mutableRenderer.loadModuleESM = originalLoadModuleESM;
        }
      });

      it("passes layoutDataMap entries to the layout component", async () => {
        const adapter = createMockAdapter();
        adapter.fs.readFile = () => Promise.resolve(LAYOUT_SOURCE_WITH_DATA);

        const result = await applyLayoutsESM(
          React.createElement("p", { id: "page-body" }, "Text"),
          undefined,
          [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
          "/project",
          {},
          createLayoutComponentCache(),
          adapter,
          new Map([["/project/app/layout.tsx", { title: "From layout data" }]]),
          "project-esm-layout-data",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        __injectReactDOMServerForTests(ReactDOMServer);
        const html = await renderToStringAdapter(result);
        assertEquals(
          html.includes("From layout data"),
          true,
          "layoutDataMap entries keyed by componentPath must be passed as the layout component's props",
        );
      });

      it("propagates a failing layout instead of rendering without it", async () => {
        const adapter = createMockAdapter();
        adapter.fs.readFile = () => Promise.reject(new Error("layout read exploded"));

        await assertRejects(
          () =>
            applyLayoutsESM(
              React.createElement("p", { id: "page-body" }, "Text"),
              undefined,
              [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
              "/project",
              {},
              createLayoutComponentCache(),
              adapter,
              undefined,
              "project-esm-failing-layout",
              "project-slug",
              "content-source-id",
              PRODUCTION_MODES,
            ),
          Error,
          "layout read exploded",
          "applyLayoutsESM must propagate a broken layout rather than render without it",
        );
      });
    });

    /**
     * Both applicators compile the layout themselves, so the mode pair they
     * forward decides whether the SSR output carries Studio Navigator node
     * positions. Before veryfront/veryfront-issue-inbox#555 the parameter was
     * optional, every caller resolved to production, and no case here compiled
     * a TSX layout in development at all.
     */
    describe("TSX layouts under each render mode pair", () => {
      for (
        const scenario of [
          { name: "hosted production", modes: PRODUCTION_MODES, expectNodePositions: false },
          { name: "hosted preview", modes: PREVIEW_MODES, expectNodePositions: true },
          { name: "local development", modes: DEVELOPMENT_MODES, expectNodePositions: true },
        ]
      ) {
        it(`applyLayoutsFunctionBody renders ${scenario.name}`, async () => {
          const adapter = createMockAdapter();
          adapter.fs.readFile = () => Promise.resolve(LAYOUT_SOURCE);

          const result = await applyLayoutsFunctionBody(
            React.createElement("p", { id: "page-body" }, "Text"),
            undefined,
            [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
            {},
            createLayoutComponentCache(),
            "/project",
            adapter,
            undefined,
            `project-fb-${scenario.modes.compileMode}-${scenario.modes.environment}`,
            "project-slug",
            "content-source-id",
            scenario.modes,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            scenario.name === "local development",
          );

          __injectReactDOMServerForTests(ReactDOMServer);
          const html = await renderToStringAdapter(result);
          assertEquals(html.includes('id="tsx-layout"'), true);
          assertEquals(html.includes('id="page-body"'), true);
          assertEquals(html.includes("data-node-file"), scenario.expectNodePositions);
        });

        it(`applyLayoutsESM renders ${scenario.name}`, async () => {
          const adapter = createMockAdapter();
          adapter.fs.readFile = () => Promise.resolve(LAYOUT_SOURCE);

          const result = await applyLayoutsESM(
            React.createElement("p", { id: "page-body" }, "Text"),
            undefined,
            [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
            "/project",
            {},
            createLayoutComponentCache(),
            adapter,
            undefined,
            `project-esm-${scenario.modes.compileMode}-${scenario.modes.environment}`,
            "project-slug",
            "content-source-id",
            scenario.modes,
          );

          __injectReactDOMServerForTests(ReactDOMServer);
          const html = await renderToStringAdapter(result);
          assertEquals(html.includes('id="tsx-layout"'), true);
          assertEquals(html.includes('id="page-body"'), true);
          assertEquals(html.includes("data-node-file"), scenario.expectNodePositions);
        });
      }
    });

    describe("applyLayoutsFunctionBody", () => {
      it("uses secure ESM loading for MDX compatibility calls", async () => {
        const originalLoadModuleESM = mdxRenderer.loadModuleESM;
        const originalRender = mdxRenderer.render;
        const calls: string[] = [];
        const mutableRenderer = mdxRenderer as unknown as {
          loadModuleESM: typeof mdxRenderer.loadModuleESM;
          render: typeof mdxRenderer.render;
        };
        mutableRenderer.loadModuleESM = () => {
          calls.push("loadModuleESM");
          return Promise.resolve({
            default: ({ children }: { children?: React.ReactNode }) =>
              React.createElement("section", { id: "mdx-layout" }, children),
          });
        };
        mutableRenderer.render = () => {
          calls.push("render");
          return React.createElement("div", null, "Migration Required");
        };

        try {
          const result = await applyLayoutsFunctionBody(
            React.createElement("p", { id: "page-body" }, "Text"),
            {
              compiledCode: "export default function Layout() { return null; }",
            } as MdxBundle,
            [],
            {},
            createLayoutComponentCache(),
            "/project",
            createMockAdapter(),
            undefined,
            "project-id",
            "project-slug",
            "content-source-id",
            PRODUCTION_MODES,
          );

          assertEquals(calls, ["loadModuleESM"]);
          assertEquals(result.type instanceof Function, true);
        } finally {
          mutableRenderer.loadModuleESM = originalLoadModuleESM;
          mutableRenderer.render = originalRender;
        }
      });

      it("uses the requested project React version", async () => {
        const loadedUrls: string[] = [];
        __setServerModuleLoaderForTests((url) => {
          loadedUrls.push(url);
          return Promise.resolve({ default: React });
        });

        const adapter = createMockAdapter();
        adapter.fs.readFile = () => Promise.resolve(LAYOUT_SOURCE);

        await applyLayoutsFunctionBody(
          React.createElement("div"),
          undefined,
          [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
          {},
          createLayoutComponentCache(),
          "/project",
          adapter,
          undefined,
          "project-id",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
          "18.3.1",
        );

        assertEquals(loadedUrls.some((url) => url.includes("react@18.3.1")), true);
      });

      it("should preserve App Router document layouts for server rendering", async () => {
        const adapter = createMockAdapter();
        const pageElement = React.createElement("button", { id: "counter" }, "Count: 0");
        const cache = createLayoutComponentCache();

        adapter.fs.readFile = async () =>
          `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><main data-testid="document-layout">{children}</main></body></html>;
}
`;

        const result = await applyLayoutsFunctionBody(
          pageElement,
          undefined,
          [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
          {},
          cache,
          "/project",
          adapter,
          undefined,
          "project-id",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        __injectReactDOMServerForTests(ReactDOMServer);
        const html = await renderToStringAdapter(result);
        assertEquals(html.includes('<html lang="en">'), true);
        assertEquals(html.includes("<body>"), true);
        assertEquals(html.includes('data-testid="document-layout"'), true);
        assertEquals(html.includes('id="counter"'), true);
      });

      it("builds the layout element with the project React instance", async () => {
        const projectReact = {
          ...React,
          createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
            __builtBy: "project",
            type,
            props,
            children,
          }),
        } as unknown as typeof React;
        __injectProjectReactForTests(projectReact);

        const adapter = createMockAdapter();
        adapter.fs.readFile = () => Promise.resolve(LAYOUT_SOURCE);

        const result = await applyLayoutsFunctionBody(
          React.createElement("p", { id: "page-body" }, "Text"),
          undefined,
          [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
          {},
          createLayoutComponentCache(),
          "/project",
          adapter,
          undefined,
          "project-fb-react-instance",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        assertEquals(
          (result as unknown as { __builtBy?: string }).__builtBy,
          "project",
          "the layout element must be created by the project React instance, not the bundled copy",
        );
      });

      it("passes layoutDataMap entries to the layout component", async () => {
        const adapter = createMockAdapter();
        adapter.fs.readFile = () => Promise.resolve(LAYOUT_SOURCE_WITH_DATA);

        const result = await applyLayoutsFunctionBody(
          React.createElement("p", { id: "page-body" }, "Text"),
          undefined,
          [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
          {},
          createLayoutComponentCache(),
          "/project",
          adapter,
          new Map([["/project/app/layout.tsx", { title: "From layout data" }]]),
          "project-fb-layout-data",
          "project-slug",
          "content-source-id",
          PRODUCTION_MODES,
        );

        __injectReactDOMServerForTests(ReactDOMServer);
        const html = await renderToStringAdapter(result);
        assertEquals(
          html.includes("From layout data"),
          true,
          "layoutDataMap entries keyed by componentPath must be passed as the layout component's props",
        );
      });

      it("propagates a failing layout instead of rendering without it", async () => {
        const adapter = createMockAdapter();
        adapter.fs.readFile = () => Promise.reject(new Error("layout read exploded"));

        await assertRejects(
          () =>
            applyLayoutsFunctionBody(
              React.createElement("p", { id: "page-body" }, "Text"),
              undefined,
              [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
              {},
              createLayoutComponentCache(),
              "/project",
              adapter,
              undefined,
              "project-fb-failing-layout",
              "project-slug",
              "content-source-id",
              PRODUCTION_MODES,
            ),
          Error,
          "layout read exploded",
          "applyLayoutsFunctionBody must propagate a broken layout rather than render without it",
        );
      });

      it("rejects a legacy function-body bundle with a migration error", async () => {
        await assertRejects(
          () =>
            applyLayoutsFunctionBody(
              React.createElement("p", { id: "page-body" }, "Text"),
              {
                compiledCode: "return { default: function Layout() { return null; } };",
              } as MdxBundle,
              [],
              {},
              createLayoutComponentCache(),
              "/project",
              createMockAdapter(),
              undefined,
              "project-fb-legacy-bundle",
              "project-slug",
              "content-source-id",
              PRODUCTION_MODES,
            ),
          Error,
          "legacy function-body layout bundle",
          "a top-level-return bundle must fail with migration guidance, not an opaque ESM syntax error",
        );
      });
    });

    describe("request cancellation", () => {
      it("stops an MDX layout load when the signal is already aborted", async () => {
        const originalLoadModuleESM = mdxRenderer.loadModuleESM;
        const mutableRenderer = mdxRenderer as unknown as {
          loadModuleESM: typeof mdxRenderer.loadModuleESM;
        };
        let moduleLoads = 0;
        mutableRenderer.loadModuleESM = () => {
          moduleLoads++;
          return Promise.resolve({ default: () => null });
        };

        const controller = new AbortController();
        controller.abort(new Error("request canceled mid-render"));

        try {
          await assertRejects(
            () =>
              applyLayoutsESM(
                React.createElement("p", { id: "page-body" }, "Text"),
                {
                  compiledCode: "export default function Layout() { return null; }",
                } as MdxBundle,
                [],
                "/project",
                {},
                createLayoutComponentCache(),
                createMockAdapter(),
                undefined,
                "project-esm-aborted",
                "project-slug",
                "content-source-id",
                PRODUCTION_MODES,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                controller.signal,
              ),
            Error,
            "request canceled mid-render",
            "an aborted request must stop the MDX layout load instead of letting it run to completion",
          );
          assertEquals(moduleLoads, 0, "no module load may start after the request was aborted");
        } finally {
          mutableRenderer.loadModuleESM = originalLoadModuleESM;
        }
      });

      it("stops an MDX layout load when the signal aborts during module loading", async () => {
        const originalLoadModuleESM = mdxRenderer.loadModuleESM;
        const mutableRenderer = mdxRenderer as unknown as {
          loadModuleESM: typeof mdxRenderer.loadModuleESM;
        };
        let resolveModule!: (module: { default: () => null }) => void;
        const moduleLoad = new Promise<{ default: () => null }>((resolve) => {
          resolveModule = resolve;
        });
        let markModuleLoadStarted!: () => void;
        const moduleLoadStarted = new Promise<void>((resolve) => {
          markModuleLoadStarted = resolve;
        });
        mutableRenderer.loadModuleESM = () => {
          markModuleLoadStarted();
          return moduleLoad;
        };

        const controller = new AbortController();

        try {
          const layoutResult = applyLayoutsESM(
            React.createElement("p", { id: "page-body" }, "Text"),
            {
              compiledCode: "export default function Layout() { return null; }",
            } as MdxBundle,
            [],
            "/project",
            {},
            createLayoutComponentCache(),
            createMockAdapter(),
            undefined,
            "project-esm-aborted-during-load",
            "project-slug",
            "content-source-id",
            PRODUCTION_MODES,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            controller.signal,
          );

          await moduleLoadStarted;
          controller.abort(new Error("request canceled during module load"));
          resolveModule({ default: () => null });

          await assertRejects(
            () => layoutResult,
            Error,
            "request canceled during module load",
            "an abort while the module loader is pending must stop layout application",
          );
        } finally {
          mutableRenderer.loadModuleESM = originalLoadModuleESM;
        }
      });
    });
  },
);
