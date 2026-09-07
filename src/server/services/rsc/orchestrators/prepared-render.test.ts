import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import { RSCRenderer } from "#veryfront/rendering/rsc/server-renderer/index.ts";
import {
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { RenderHandler } from "./render-handler.ts";

describe("prepared RSC rendering", () => {
  for (const extension of ["tsx", "mdx"]) {
    for (const fromFactory of [false, true]) {
      it(`renders a prepared ${extension} route with ${fromFactory ? "a resolved" : "an explicit"} adapter without legacy imports`, async () => {
        const adapter = createMockAdapter();
        const path = `/project/app/page.${extension}`;
        adapter.fs.directories.add("/project/app");
        adapter.fs.files.set(path, 'throw new Error("Do not execute source");');
        const Page = () => React.createElement("p", null, "prepared RSC");
        Object.defineProperty(adapter, "moduleLoader", {
          value: {
            importModule: async (ref: RuntimeModuleReference) => {
              if (ref.kind === "source" && ref.path === path) return { default: Page };
              if (ref.kind === "package" && ref.specifier === "react") return { default: React };
              if (ref.kind === "package" && ref.specifier === "react-dom/server") {
                return { ...ReactDOMServer };
              }
              throw new Error("Unprepared module");
            },
          },
        });
        let legacyLoads = 0;
        __setServerModuleLoaderForTests(async () => {
          legacyLoads++;
          throw new Error("Legacy imports disabled");
        });
        try {
          const renderer = new RSCRenderer({
            projectDir: "/project",
            clientManifest: new Map(),
            reactVersion: React.version,
          });
          const handler = new RenderHandler(
            "/project",
            () => renderer,
            "production",
            "app",
            fromFactory ? { runtimeAdapter: async () => adapter } : { adapter },
          );
          const response = await handler.handle("/", new URLSearchParams());
          assertEquals(legacyLoads, 0, "RSC must use the same prepared runtime as SSR");
          assertEquals(response.status, 200);
          assertStringIncludes((await response.json()).html, "<p>prepared RSC</p>");
        } finally {
          __setServerModuleLoaderForTests(null);
          resetReactCache();
        }
      });
    }
  }
});
