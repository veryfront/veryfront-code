import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

describe("rendering/orchestrator/module-loader/esm-rewriter", () => {
  describe("rewriteEsmPaths", () => {
    const urlBase = "https://esm.sh/v135/react-dom@18.2.0/es2022/";

    it("should not modify code with no imports or exports", async () => {
      const code = `console.log("no imports here");`;
      assertEquals(await rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify non-path strings", async () => {
      const code = `const x = "hello world";`;
      assertEquals(await rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify import of bare specifiers", async () => {
      const code = `import "react"`;
      assertEquals(await rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify from of bare specifiers", async () => {
      const code = `import { useState } from "react"`;
      assertEquals(await rewriteEsmPaths(code, urlBase), code);
    });

    it("should return same string for empty input", async () => {
      assertEquals(await rewriteEsmPaths("", urlBase), "");
    });

    it("should preserve non-import code lines around imports", async () => {
      const code = `const x = 1;\nconst y = 2;`;
      assertEquals(await rewriteEsmPaths(code, urlBase), code);
    });

    it("should not rewrite veryfront module paths via from", async () => {
      const code = `import { something } from "/_vf_modules/my-module.js"`;
      const result = await rewriteEsmPaths(code, urlBase);
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

    it("should not rewrite veryfront module paths in the other specifier forms", async () => {
      for (
        const code of [
          `import "/_vf_modules/my-module.js"`,
          `export * from "/_vf_modules/my-module.js"`,
          `export { something } from "/_vf_modules/my-module.js"`,
        ]
      ) {
        assertEquals(
          await rewriteEsmPaths(code, urlBase),
          code,
          "every specifier form must leave a locally served path untouched",
        );
      }
    });

    it("should not rewrite _veryfront paths via from", async () => {
      const code = `import { something } from "/_veryfront/modules/component.js"`;
      const result = await rewriteEsmPaths(code, urlBase);
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

    it("should not rewrite _veryfront paths in the other specifier forms", async () => {
      for (
        const code of [
          `import "/_veryfront/modules/component.js"`,
          `export * from "/_veryfront/modules/component.js"`,
          `export { component } from "/_veryfront/modules/component.js"`,
        ]
      ) {
        assertEquals(
          await rewriteEsmPaths(code, urlBase),
          code,
          "every specifier form must leave a virtual-module path untouched",
        );
      }
    });

    it("resolves absolute specifiers through esm.sh", async () => {
      assertEquals(
        await rewriteEsmPaths(`import "/v135/react.js"`, urlBase),
        `import "https://esm.sh/v135/react.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
      assertEquals(
        await rewriteEsmPaths(`import React from "/v135/react.js"`, urlBase),
        `import React from "https://esm.sh/v135/react.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
      assertEquals(
        await rewriteEsmPaths(`export * from "/v135/a.js"`, urlBase),
        `export * from "https://esm.sh/v135/a.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
      assertEquals(
        await rewriteEsmPaths(`export { b } from "/v135/b.js"`, urlBase),
        `export { b } from "https://esm.sh/v135/b.js"`,
        "a bare absolute path belongs to esm.sh, not to the local server",
      );
    });

    it("resolves relative specifiers against the module's own URL", async () => {
      assertEquals(
        await rewriteEsmPaths(`import x from "./chunk.js"`, urlBase),
        `import x from "https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js"`,
        "a relative specifier resolves against the fetched module's URL",
      );
      assertEquals(
        await rewriteEsmPaths(`import "./chunk.js"`, urlBase),
        `import "https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js"`,
        "a relative specifier resolves against the fetched module's URL",
      );
      assertEquals(
        await rewriteEsmPaths(`export * from "./chunk.js"`, urlBase),
        `export * from "https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js"`,
        "a relative specifier resolves against the fetched module's URL",
      );
      assertEquals(
        await rewriteEsmPaths(`export { b } from "../es2021/b.js"`, urlBase),
        `export { b } from "https://esm.sh/v135/react-dom@18.2.0/es2021/b.js"`,
        "a parent-relative specifier resolves against the fetched module's URL",
      );
    });

    it("should handle code with mixed import types", async () => {
      const code = `import React from "react"\nconst x = 42;`;
      const result = await rewriteEsmPaths(code, urlBase);
      // Bare specifiers should be untouched
      assertEquals(result.includes('"react"'), true);
    });

    it("leaves specifier-shaped text inside ordinary string data alone", async () => {
      // A pattern-matching rewrite cannot tell a module specifier from the same
      // text inside a string literal, and would turn this program's data into an
      // esm.sh URL. Only a position the lexer calls a specifier may be edited.
      for (
        const code of [
          `const message = 'from "/v135/help"';`,
          `const message = 'import "/v135/help"';`,
          `const message = 'export * from "./help.js"';`,
        ]
      ) {
        assertEquals(
          await rewriteEsmPaths(code, urlBase),
          code,
          "string data that merely reads like an import must survive untouched",
        );
      }
    });

    it("rewrites a real specifier that sits beside specifier-shaped string data", async () => {
      const code = `const doc = 'see from "/v135/help"';\nimport React from "/v135/react.js";`;
      assertEquals(
        await rewriteEsmPaths(code, urlBase),
        `const doc = 'see from "/v135/help"';\nimport React from "https://esm.sh/v135/react.js";`,
        "skipping string data must not cost the genuine specifier its rewrite",
      );
    });

    it("does not rewrite an esm.sh URL stored in ordinary string data", async () => {
      const code = `import "https://esm.sh/v135/react.js";\n` +
        `const endpoint = "https://esm.sh/v135/react.js";`;
      const result = await rewriteEsmPaths(code, urlBase);
      assertEquals(
        result,
        code,
        "only lexer-reported specifiers may be replaced; string data must remain unchanged",
      );
    });

    it("prefetches a template-literal dynamic import", async () => {
      const code = "const load = () => import(`./chunk.js`);";
      assertEquals(
        await rewriteEsmPaths(code, urlBase),
        "const load = () => import(`https://esm.sh/v135/react-dom@18.2.0/es2022/chunk.js`);",
      );
    });

    it("leaves a specifier-shaped path inside a comment alone", async () => {
      const code = `// import "/v135/react.js"\nconst x = 1;`;
      assertEquals(
        await rewriteEsmPaths(code, urlBase),
        code,
        "a commented-out import is not part of the module graph",
      );
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

    it("prefetches successful template-literal dynamic imports", async () => {
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/root") {
          return Promise.resolve(jsonResponse("const load = () => import(`https://esm.sh/a`);"));
        }
        if (url === "https://esm.sh/a") return Promise.resolve(jsonResponse("export const a = 1;"));
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      const rootContent = files.get(result) ?? "";
      assertMatch(rootContent, /file:\/\//);
      assertEquals(rootContent.includes("https://esm.sh/a"), false);
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

    it("does not publish a lazy-failure cycle artifact", async () => {
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/root") {
          return Promise.resolve(jsonResponse(`import("https://esm.sh/a");`));
        }
        if (url === "https://esm.sh/a") {
          return Promise.resolve(jsonResponse(
            `import { b } from "https://esm.sh/b";\n` +
              `import("https://esm.sh/broken");\nexport const a = 1;`,
          ));
        }
        if (url === "https://esm.sh/b") {
          return Promise.resolve(jsonResponse(`import { r } from "https://esm.sh/root";`));
        }
        if (url === "https://esm.sh/broken") {
          return Promise.resolve(new Response("upstream broken", { status: 500 }));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      assertEquals(
        esmCache.size,
        0,
        "a cycle containing a failed lazy subtree must not publish partial artifacts",
      );
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

    it("terminates on a dependency cycle instead of fetching forever", async () => {
      // A and B import each other. Nothing enters `esmCache` until a fetch has
      // finished, so re-entering a URL already on the stack never terminates.
      // The fetch budget turns that runaway into a failure rather than a hang.
      const esmCache = new Map<string, string>();
      let fetchCount = 0;
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCount++;
        if (fetchCount > 8) throw new Error(`runaway fetch of ${url}`);
        if (url === "https://esm.sh/cycle-a") {
          return Promise.resolve(
            jsonResponse(`import { b } from "https://esm.sh/cycle-b";\nexport const a = 1;`),
          );
        }
        if (url === "https://esm.sh/cycle-b") {
          return Promise.resolve(
            jsonResponse(`import { a } from "https://esm.sh/cycle-a";\nexport const b = 2;`),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/cycle-a", tmpDir, localAdapter, esmCache);

      assertEquals(fetchCount, 2, "each module in the cycle is fetched exactly once");
      assertEquals(files.size, 2, "both modules in the cycle are written");

      const bPaths = [...files.keys()].filter((path) => path !== result);
      assertEquals(bPaths.length, 1);
      const bPath = bPaths[0] ?? "";

      assertEquals(
        files.get(result)?.includes(`file://${bPath}`),
        true,
        "the entry module points at the local copy of its cyclic dependency",
      );
      assertEquals(
        files.get(bPath)?.includes(`file://${result}`),
        true,
        "the back edge resolves to the path the entry module is actually written to",
      );
      assertEquals(
        /esm\.sh\/cycle-/.test(`${files.get(result)}${files.get(bPath)}`),
        false,
        "no remote esm.sh reference survives in either side of the cycle",
      );
      assertEquals(
        esmCache.get("https://esm.sh/cycle-b"),
        bPath,
        "a cycle member stays cached once the graph that owns its back edge succeeds",
      );
    });

    it("terminates on a self-referencing module", async () => {
      const esmCache = new Map<string, string>();
      let fetchCount = 0;
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCount++;
        if (fetchCount > 8) throw new Error(`runaway fetch of ${url}`);
        if (url === "https://esm.sh/self") {
          return Promise.resolve(
            jsonResponse(`export { x } from "https://esm.sh/self";\nexport const x = 1;`),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/self", tmpDir, localAdapter, esmCache);

      assertEquals(fetchCount, 1, "a module that imports itself is fetched once");
      assertEquals(
        files.get(result)?.includes(`file://${result}`),
        true,
        "the self edge resolves to the module's own local path",
      );
    });

    it("rewrites a URL that another URL starts with to its own local path", async () => {
      // "https://esm.sh/react" is a prefix of "https://esm.sh/react-dom", and
      // regex alternation commits to the first branch that matches. Without
      // longest-first ordering the second import becomes the first
      // dependency's path with a dangling "-dom" glued on.
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/react") {
          return Promise.resolve(jsonResponse(`export const react = 1;`));
        }
        if (url === "https://esm.sh/react-dom") {
          return Promise.resolve(jsonResponse(`export const reactDom = 2;`));
        }
        if (url === "https://esm.sh/root") {
          return Promise.resolve(jsonResponse(
            `import { react } from "https://esm.sh/react";\n` +
              `import { reactDom } from "https://esm.sh/react-dom";`,
          ));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      const rootContent = files.get(result) ?? "";

      const reactPath = esmCache.get("https://esm.sh/react") ?? "";
      const domPath = esmCache.get("https://esm.sh/react-dom") ?? "";
      assertEquals(
        files.get(domPath),
        `export const reactDom = 2;`,
        "the longer URL must be fetched and written as its own module",
      );

      assertEquals(
        rootContent,
        `import { react } from "file://${reactPath}";\n` +
          `import { reactDom } from "file://${domPath}";`,
        "each import must point at the file fetched for that exact URL",
      );
      assertEquals(
        rootContent.includes(`file://${reactPath}-dom`),
        false,
        "a prefix URL must not swallow the head of the longer URL",
      );
    });

    it("leaves a failed lazy URL intact when a fetched URL is its prefix", async () => {
      // "https://esm.sh/react" fetches and enters the replacement map;
      // "https://esm.sh/react-dom" is only imported lazily and fails, so it is
      // absent from the map and longest-first ordering cannot protect it. The
      // replacement must still match whole specifiers, or the failed URL
      // becomes the shorter dependency's path with "-dom" glued on.
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/react") {
          return Promise.resolve(jsonResponse(`export const react = 1;`));
        }
        if (url === "https://esm.sh/react-dom") {
          return Promise.resolve(new Response("upstream broken", { status: 500 }));
        }
        if (url === "https://esm.sh/root") {
          return Promise.resolve(jsonResponse(
            `import { react } from "https://esm.sh/react";\n` +
              `const dom = () => import("https://esm.sh/react-dom");`,
          ));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      }) as typeof fetch;

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      const rootContent = files.get(result) ?? "";
      const reactPath = esmCache.get("https://esm.sh/react") ?? "";

      assertEquals(
        rootContent,
        `import { react } from "file://${reactPath}";\n` +
          `const dom = () => import("https://esm.sh/react-dom");`,
        "the failed lazy URL must survive verbatim for runtime resolution",
      );
      assertEquals(
        rootContent.includes(`file://${reactPath}-dom`),
        false,
        "a fetched prefix URL must not be substituted inside the failed longer URL",
      );
      assertEquals(
        esmCache.has("https://esm.sh/react-dom"),
        false,
        "a failed lazy URL must not be cached as resolved",
      );
    });

    it("does not cache a cycle member when an ancestor of the cycle fails", async () => {
      // The back edge points at the entry module's predicted path, which the
      // entry module only writes on its way out. A static dependency failing
      // first means that file never appears, so keeping the cycle member
      // cached would hand every later fetch an artifact importing a path that
      // does not exist.
      const esmCache = new Map<string, string>();
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://esm.sh/root") {
          return Promise.resolve(jsonResponse(
            `import { b } from "https://esm.sh/cycle-b";\n` +
              `import { x } from "https://esm.sh/broken";`,
          ));
        }
        if (url === "https://esm.sh/cycle-b") {
          return Promise.resolve(jsonResponse(
            `import { r } from "https://esm.sh/root";\nexport const b = 2;`,
          ));
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

      assertEquals(
        esmCache.has("https://esm.sh/cycle-b"),
        false,
        "a cycle member written against an unwritten ancestor must not survive the failure",
      );
      assertEquals(
        [...esmCache.keys()],
        [],
        "no entry from a failed graph may be handed to a later fetch",
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
