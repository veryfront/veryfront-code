import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

describe("rendering/orchestrator/module-loader/esm-rewriter", () => {
  describe("rewriteEsmPaths", () => {
    const urlBase = "https://esm.sh/v135/react-dom@18.2.0/es2022/";

    it("should not modify code with no imports or exports", () => {
      const code = `console.log("no imports here");`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify non-path strings", () => {
      const code = `const x = "hello world";`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify import of bare specifiers", () => {
      const code = `import "react"`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify from of bare specifiers", () => {
      const code = `import { useState } from "react"`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should return same string for empty input", () => {
      assertEquals(rewriteEsmPaths("", urlBase), "");
    });

    it("should preserve non-import code lines around imports", () => {
      const code = `const x = 1;\nconst y = 2;`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not rewrite veryfront module paths via from", () => {
      const code = `import { something } from "/_vf_modules/my-module.js"`;
      const result = rewriteEsmPaths(code, urlBase);
      // A substring check would still hold for "https://esm.sh/_vf_modules/...",
      // so the oracle has to be the whole output.
      assertEquals(
        result,
        code,
        "/_vf_modules paths are served locally and must be left untouched",
      );
      assertEquals(
        result.includes("esm.sh"),
        false,
        "a locally served module path must never be pointed at esm.sh",
      );
    });

    it("should not rewrite veryfront module paths in the other specifier forms", () => {
      for (
        const code of [
          `import "/_vf_modules/my-module.js"`,
          `export * from "/_vf_modules/my-module.js"`,
          `export { something } from "/_vf_modules/my-module.js"`,
        ]
      ) {
        assertEquals(
          rewriteEsmPaths(code, urlBase),
          code,
          "every specifier form must leave a locally served path untouched",
        );
      }
    });

    it("should not rewrite _veryfront paths via from", () => {
      const code = `import { something } from "/_veryfront/modules/component.js"`;
      const result = rewriteEsmPaths(code, urlBase);
      assertEquals(
        result,
        code,
        "_veryfront virtual-module paths are served locally and must survive the rewrite untouched",
      );
      assertEquals(
        result.includes("esm.sh"),
        false,
        "a local virtual-module path must never be pointed at esm.sh",
      );
    });

    it("should not rewrite _veryfront paths in the other specifier forms", () => {
      for (
        const code of [
          `import "/_veryfront/modules/component.js"`,
          `export * from "/_veryfront/modules/component.js"`,
          `export { component } from "/_veryfront/modules/component.js"`,
        ]
      ) {
        assertEquals(
          rewriteEsmPaths(code, urlBase),
          code,
          "every specifier form must leave a virtual-module path untouched",
        );
      }
    });

    it("resolves absolute specifiers through esm.sh", () => {
      assertEquals(
        rewriteEsmPaths(`import "/v135/react.js"`, urlBase),
        `import "https://esm.sh/v135/react.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
      assertEquals(
        rewriteEsmPaths(`import React from "/v135/react.js"`, urlBase),
        `import React from "https://esm.sh/v135/react.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
      assertEquals(
        rewriteEsmPaths(`export * from "/v135/a.js"`, urlBase),
        `export * from "https://esm.sh/v135/a.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
      assertEquals(
        rewriteEsmPaths(`export { b } from "/v135/b.js"`, urlBase),
        `export { b } from "https://esm.sh/v135/b.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
    });

    it("resolves relative specifiers against the module's own URL", () => {
      assertEquals(
        rewriteEsmPaths(`import x from "./chunk.js"`, urlBase),
        `import x from "https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js"`,
        "a relative specifier resolves against the fetched module's URL",
      );
      assertEquals(
        rewriteEsmPaths(`import "./chunk.js"`, urlBase),
        `import "https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js"`,
        "a relative specifier resolves against the fetched module's URL",
      );
      assertEquals(
        rewriteEsmPaths(`export * from "./chunk.js"`, urlBase),
        `export * from "https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js"`,
        "a relative specifier resolves against the fetched module's URL",
      );
      assertEquals(
        rewriteEsmPaths(`export { b } from "../es2021/b.js"`, urlBase),
        `export { b } from "https://esm.sh/v135/react-dom@18.2.0/es2021/b.js"`,
        "a parent-relative specifier resolves against the fetched module's URL",
      );
    });

    it("should handle code with mixed import types", () => {
      const code = `import React from "react"\nconst x = 42;`;
      const result = rewriteEsmPaths(code, urlBase);
      // Bare specifiers should be untouched
      assertEquals(result.includes('"react"'), true);
    });
  });

  describe("fetchEsmModule", () => {
    const tmpDir = "/tmp/esm-rewriter-test";
    const files = new Map<string, string>();
    const localAdapter = {
      fs: {
        writeFile(path: string, content: string) {
          files.set(path, content);
          return Promise.resolve();
        },
      },
    } as unknown as RuntimeAdapter;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      files.clear();
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function jsonResponse(body: string, status = 200): Response {
      return new Response(body, {
        status,
        headers: { "Content-Type": "application/javascript" },
      });
    }

    it("resolves the top-level URL when all nested URLs succeed", async () => {
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/root") {
          return Promise.resolve(
            jsonResponse(`import { a } from "https://esm.sh/a";`),
          );
        }
        if (url === "https://esm.sh/a") return Promise.resolve(jsonResponse(`export const a = 1;`));
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      assertEquals(result.startsWith(tmpDir), true);
      // The root's reference to the nested URL should have been rewritten to
      // the cached file path.
      const rootContent = files.get(result) ?? "";
      assertMatch(rootContent, /file:\/\//);
      assertEquals(/esm\.sh\/a/.test(rootContent), false);
    });

    it("does not abort the render when a nested URL fetch fails", async () => {
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/root") {
          return Promise.resolve(
            jsonResponse(
              `import { a } from "https://esm.sh/a";\nimport("https://esm.sh/broken");`,
            ),
          );
        }
        if (url === "https://esm.sh/a") return Promise.resolve(jsonResponse(`export const a = 1;`));
        if (url === "https://esm.sh/broken") {
          return Promise.resolve(new Response("upstream broken", { status: 500 }));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      const rootContent = files.get(result) ?? "";
      // Successful URL replaced with file://; failed URL preserved for runtime
      // resolution instead of aborting the whole render.
      assertMatch(rootContent, /file:\/\//);
      assertMatch(rootContent, /esm\.sh\/broken/);
    });

    it("still throws when a nested URL is imported statically", async () => {
      // The emitted module's own import graph must be local before the runtime
      // loader is handed it. Leaving a static dependency remote would change
      // that contract, so this failure stays fatal.
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/root") {
          return Promise.resolve(jsonResponse(`import { b } from "https://esm.sh/broken";`));
        }
        if (url === "https://esm.sh/broken") {
          return Promise.resolve(new Response("upstream broken", { status: 500 }));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      await assertRejects(
        () => fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache),
        Error,
      );
    });

    it("still throws when the top-level URL itself fails", async () => {
      const esmCache = new Map<string, string>();
      globalThis.fetch =
        (() => Promise.resolve(new Response("upstream broken", { status: 500 }))) as typeof fetch;

      await assertRejects(
        () => fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache),
        Error,
      );
    });
  });
});
