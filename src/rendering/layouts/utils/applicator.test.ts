import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import "#veryfront/schemas/_test-setup.ts";
// Node position injection needs the babel CodeParser contract registered.
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
      it("uses the requested project React version", async () => {
        const loadedUrls: string[] = [];
        __setServerModuleLoaderForTests((url) => {
          loadedUrls.push(url);
          return Promise.resolve({ default: React });
        });

        await applyLayoutsFunctionBody(
          React.createElement("div"),
          undefined,
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
    });
  },
);
