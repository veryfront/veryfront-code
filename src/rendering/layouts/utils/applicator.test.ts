import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applyLayoutsESM } from "./applicator.ts";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "#veryfront/types";
import { createLayoutComponentCache } from "./component-loader.ts";

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

describe("rendering/layouts/utils/applicator", () => {
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
});
