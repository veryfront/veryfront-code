import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import {
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";

describe("prepared error pages", () => {
  for (const status of [404, 500]) {
    it(`renders the custom ${status} with the prepared React runtime`, async () => {
      const adapter = createMockAdapter();
      adapter.fs.directories.add("/project/app");
      adapter.fs.directories.add("/project/pages");
      const path = status === 404 ? "/project/app/not-found.tsx" : "/project/pages/500.tsx";
      adapter.fs.files.set(path, 'throw new Error("Do not execute source");');
      const Page = () => React.createElement("p", null, "prepared fallback");
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
        const ctx = {
          projectDir: "/project",
          projectId: "prepared-fallback",
          adapter,
          securityConfig: null,
          config: { react: { version: React.version } },
        };
        const req = new Request("http://localhost/missing");
        const snapshot = { cacheKey: "off", dependencies: {} };
        const response = status === 404
          ? await tryNotFoundFallback(req, "missing", ctx, new ResponseBuilder(), snapshot)
          : await tryErrorPageFallback(
            req,
            ctx,
            new ResponseBuilder(),
            { statusCode: status },
            snapshot,
          );
        assertEquals(legacyLoads, 0, "error rendering must not import another generation");
        assertExists(response);
        assertEquals(response.status, status);
        assertStringIncludes(await response.text(), "<p>prepared fallback</p>");
      } finally {
        __setServerModuleLoaderForTests(null);
        resetReactCache();
      }
    });
  }
});
