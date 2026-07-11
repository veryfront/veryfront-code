import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { applyLayoutsESM, applyLayoutsFunctionBody } from "./applicator.ts";
import * as React from "react";
import { renderToStringAdapter } from "#veryfront/react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "#veryfront/types";
import { createLayoutComponentCache } from "./component-loader.ts";
import {
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
        );

        assertEquals(React.isValidElement(result), true);
      });
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
        );

        const html = await renderToStringAdapter(result);
        assertEquals(html.includes('<html lang="en">'), true);
        assertEquals(html.includes("<body>"), true);
        assertEquals(html.includes('data-testid="document-layout"'), true);
        assertEquals(html.includes('id="counter"'), true);
      });
    });
  },
);
