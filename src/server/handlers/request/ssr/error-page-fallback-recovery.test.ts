import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  __injectProjectReactForTests,
  __injectReactDOMServerForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import {
  __injectCacheForTests,
  __setComponentSourceLoaderForTests,
  tryErrorPageFallback,
} from "./error-page-fallback.ts";

afterEach(() => {
  __injectCacheForTests(null);
  __setComponentSourceLoaderForTests(null);
  resetReactCache();
});

describe("error page recovery", () => {
  for (const resolution of ["extensions", "resolver"] as const) {
    for (
      const { stage, warm } of [
        { stage: "discovery", warm: false },
        { stage: "source read", warm: false },
        { stage: "module load", warm: false },
        { stage: "dependency lookup", warm: false },
        { stage: "module load", warm: true },
      ] as const
    ) {
      it(`recovers after a ${stage} failure with ${resolution} and a ${warm ? "warm" : "cold"} cache`, async () => {
        const entries = new Map<string, string>();
        __injectCacheForTests({
          get: (key: string) => Promise.resolve(entries.get(key) ?? null),
          set: (key: string, value: string) => {
            entries.set(key, value);
            return Promise.resolve();
          },
          delete: (key: string) => {
            entries.delete(key);
            return Promise.resolve();
          },
        } as never);
        __injectProjectReactForTests(React);
        __injectReactDOMServerForTests(ReactDOMServer as never);

        const projectDir = "/error-page-recovery";
        const filePath = `${projectDir}/pages/500.tsx`;
        let unavailable = false;
        const failDuring = (operation: typeof stage) => {
          if (unavailable && stage === operation) throw new Error("Temporarily unavailable");
        };
        const adapter = createMockAdapter();
        adapter.fs.directories.add(`${projectDir}/pages`);
        adapter.fs.files.set(filePath, "export default function ErrorPage() {}");
        const stat = adapter.fs.stat;
        adapter.fs.stat = (path) => {
          if (path === filePath) failDuring("discovery");
          return stat(path);
        };
        const readFile = adapter.fs.readFile;
        adapter.fs.readFile = (path) => {
          assertEquals(path, filePath);
          failDuring("source read");
          return readFile(path);
        };
        if (resolution === "resolver") {
          adapter.fs.resolveFile = (path) => {
            if (!path.endsWith("/500")) return Promise.resolve(null);
            failDuring("discovery");
            return Promise.resolve("pages/500.tsx");
          };
        }
        __setComponentSourceLoaderForTests((_source, path) => {
          assertEquals(path, filePath);
          failDuring("module load");
          if (unavailable && stage === "dependency lookup") {
            throw Object.assign(new Error("Missing dependency"), { code: "ENOENT" });
          }
          return Promise.resolve(() => React.createElement("main", null, "Recovered error page"));
        });
        const ctx = {
          projectDir,
          projectId: "error-page-recovery",
          adapter,
          isLocalProject: false,
          securityConfig: null,
          config: { react: { version: React.version } },
        };
        const runFallback = () =>
          tryErrorPageFallback(
            new Request("http://localhost/boom"),
            ctx,
            new ResponseBuilder(),
            { statusCode: 500, pathname: "/boom" },
            { cacheKey: "off", dependencies: {} },
          );

        if (warm) {
          const initial = await runFallback();
          assertExists(initial);
          assertStringIncludes(await initial.text(), "<main>Recovered error page</main>");
        }
        unavailable = true;
        assertEquals(await runFallback(), null, "an outage must allow the generic fallback");

        unavailable = false;
        const recovered = await runFallback();
        assertExists(recovered, "a load failure must not become a cached absence");
        assertEquals(recovered.status, 500);
        assertStringIncludes(await recovered.text(), "<main>Recovered error page</main>");
      });
    }
  }
});
