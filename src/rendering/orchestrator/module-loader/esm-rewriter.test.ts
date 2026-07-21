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
      assertEquals(result.includes("/_vf_modules/my-module.js"), true);
    });

    it("should not rewrite _veryfront paths via from", () => {
      const code = `import { something } from "/_veryfront/modules/component.js"`;
      const result = rewriteEsmPaths(code, urlBase);
      assertEquals(result.includes("/_veryfront/modules/component.js"), true);
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
