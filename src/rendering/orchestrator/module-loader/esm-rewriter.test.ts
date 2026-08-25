import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { register, resolve } from "#veryfront/extensions/contracts.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
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
    beforeEach(() => {
      files.clear();
    });

    afterEach(() => {
      restoreMockFetch();
    });

    function jsonResponse(body: string, status = 200): Response {
      return new Response(body, {
        status,
        headers: { "Content-Type": "application/javascript" },
      });
    }

    it("resolves the top-level URL when all nested URLs succeed", async () => {
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(
              jsonResponse(`import { a } from "https://esm.sh/a";`),
            );
          }
          if (url === "https://esm.sh/a") {
            return Promise.resolve(jsonResponse(`export const a = 1;`));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      assertEquals(result.startsWith(tmpDir), true);
      // The root's reference to the nested URL should have been rewritten to
      // the cached file path.
      const rootContent = files.get(result) ?? "";
      assertMatch(rootContent, /file:\/\//);
      assertEquals(/esm\.sh\/a/.test(rootContent), false);
    });

    it("keeps the regex fallback when final specifier substitution cannot lex", async () => {
      const esmCache = new Map<string, string>();
      const originalLexer = resolve<ModuleLexer>("ModuleLexer");
      const rootCode = `/* reject-configured-lexer */ import { a } from "https://esm.sh/a";`;
      register<ModuleLexer>("ModuleLexer", {
        init: originalLexer.init?.bind(originalLexer),
        parse(code) {
          if (code.includes("reject-configured-lexer")) {
            throw new Error("configured lexer rejected source");
          }
          return originalLexer.parse(code);
        },
      });
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") return Promise.resolve(jsonResponse(rootCode));
          if (url === "https://esm.sh/a") {
            return Promise.resolve(jsonResponse("export const a = 1;"));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      try {
        const result = await fetchEsmModule(
          "https://esm.sh/root",
          tmpDir,
          localAdapter,
          esmCache,
        );

        assertEquals(
          files.get(result),
          rootCode,
          "a final lexer failure must retain the fetched source and its remote specifier",
        );
      } finally {
        register("ModuleLexer", originalLexer);
      }
    });

    it("fails the load when an unlexable module keeps an unrewritable specifier", async () => {
      // Leaving `./dep.js` verbatim would make the runtime resolve it inside
      // `tmpDir`, so a "successful" fetch would hand back an artifact that
      // cannot load. Failing is the only honest outcome.
      const esmCache = new Map<string, string>();
      const originalLexer = resolve<ModuleLexer>("ModuleLexer");
      const rootCode = `/* reject-configured-lexer */ import { a } from "./dep.js";`;
      register<ModuleLexer>("ModuleLexer", {
        init: originalLexer.init?.bind(originalLexer),
        parse(code) {
          if (code.includes("reject-configured-lexer")) {
            throw new Error("configured lexer rejected source");
          }
          return originalLexer.parse(code);
        },
      });
      const rootUrl = "https://esm.sh/v135/root@1.0.0/es2022/root.js";
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === rootUrl) return Promise.resolve(jsonResponse(rootCode));
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      try {
        await assertRejects(
          () => fetchEsmModule(rootUrl, tmpDir, localAdapter, esmCache),
          Error,
          "./dep.js",
          "a relative specifier the lexer could not rewrite must fail the load",
        );
        assertEquals(
          files.size,
          0,
          "no artifact may be written for a module whose relative specifier stayed unrewritten",
        );
        assertEquals(
          esmCache.size,
          0,
          "a failed load must not publish a cache entry",
        );
      } finally {
        register("ModuleLexer", originalLexer);
      }
    });

    it("fails the load when an unlexable module keeps a template-literal path", async () => {
      // esm.sh emits template-literal dynamic imports, so a fallback that only
      // looked for single and double quotes would let `./chunk.js` through and
      // write the same unloadable artifact the quoted case is rejected for.
      const esmCache = new Map<string, string>();
      const originalLexer = resolve<ModuleLexer>("ModuleLexer");
      const rootCode = `/* reject-configured-lexer */ const load = () => import(\`./chunk.js\`);`;
      register<ModuleLexer>("ModuleLexer", {
        init: originalLexer.init?.bind(originalLexer),
        parse(code) {
          if (code.includes("reject-configured-lexer")) {
            throw new Error("configured lexer rejected source");
          }
          return originalLexer.parse(code);
        },
      });
      const rootUrl = "https://esm.sh/v135/root@1.0.0/es2022/root.js";
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === rootUrl) return Promise.resolve(jsonResponse(rootCode));
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      try {
        await assertRejects(
          () => fetchEsmModule(rootUrl, tmpDir, localAdapter, esmCache),
          Error,
          "./chunk.js",
          "a backtick-quoted relative specifier must fail the load like a quoted one",
        );
        assertEquals(
          files.size,
          0,
          "no artifact may be written for a module whose template-literal path stayed unrewritten",
        );
      } finally {
        register("ModuleLexer", originalLexer);
      }
    });

    it("fails the load when a comment separates the keyword from a relative path", async () => {
      // Anchoring the fallback on `import`/`from` would mean re-deriving JS
      // syntax by regex: a comment in the middle is enough to hide the
      // specifier and reinstate the unloadable artifact.
      const esmCache = new Map<string, string>();
      const originalLexer = resolve<ModuleLexer>("ModuleLexer");
      const rootCode = `/* reject-configured-lexer */ import /* generated */ "./dep.js";`;
      register<ModuleLexer>("ModuleLexer", {
        init: originalLexer.init?.bind(originalLexer),
        parse(code) {
          if (code.includes("reject-configured-lexer")) {
            throw new Error("configured lexer rejected source");
          }
          return originalLexer.parse(code);
        },
      });
      const rootUrl = "https://esm.sh/v135/root@1.0.0/es2022/root.js";
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === rootUrl) return Promise.resolve(jsonResponse(rootCode));
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      try {
        await assertRejects(
          () => fetchEsmModule(rootUrl, tmpDir, localAdapter, esmCache),
          Error,
          "./dep.js",
          "a comment before the specifier must not hide it from the fallback",
        );
        assertEquals(
          files.size,
          0,
          "no artifact may be written for a comment-separated relative specifier",
        );
      } finally {
        register("ModuleLexer", originalLexer);
      }
    });

    it("fails the load when an escaped quote precedes a relative path", async () => {
      // A naive quoted-string scan pairs the escaped quote with the next real
      // one, walks out of phase, and never sees the specifier that follows.
      const esmCache = new Map<string, string>();
      const originalLexer = resolve<ModuleLexer>("ModuleLexer");
      const rootCode = `/* reject-configured-lexer */ const s = "a\\"b"; import "./dep.js";`;
      register<ModuleLexer>("ModuleLexer", {
        init: originalLexer.init?.bind(originalLexer),
        parse(code) {
          if (code.includes("reject-configured-lexer")) {
            throw new Error("configured lexer rejected source");
          }
          return originalLexer.parse(code);
        },
      });
      const rootUrl = "https://esm.sh/v135/root@1.0.0/es2022/root.js";
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === rootUrl) return Promise.resolve(jsonResponse(rootCode));
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      try {
        await assertRejects(
          () => fetchEsmModule(rootUrl, tmpDir, localAdapter, esmCache),
          Error,
          "./dep.js",
          "an escaped quote must not desynchronise the fallback scan",
        );
        assertEquals(
          files.size,
          0,
          "no artifact may be written for a specifier hidden behind an escaped quote",
        );
      } finally {
        register("ModuleLexer", originalLexer);
      }
    });

    it("still accepts an unlexable module whose specifiers are all absolute", async () => {
      // The companion to the case above: a lexer failure is not fatal by
      // itself, only a lexer failure that leaves a specifier resolving against
      // the temp directory.
      const esmCache = new Map<string, string>();
      const originalLexer = resolve<ModuleLexer>("ModuleLexer");
      const rootCode =
        `/* reject-configured-lexer */ import { a } from "/_vf_modules/local.js";\nimport "react";`;
      register<ModuleLexer>("ModuleLexer", {
        init: originalLexer.init?.bind(originalLexer),
        parse(code) {
          if (code.includes("reject-configured-lexer")) {
            throw new Error("configured lexer rejected source");
          }
          return originalLexer.parse(code);
        },
      });
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") return Promise.resolve(jsonResponse(rootCode));
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      try {
        const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
        assertEquals(
          files.get(result),
          rootCode,
          "a locally served path and a bare specifier are both safe to leave verbatim",
        );
      } finally {
        register("ModuleLexer", originalLexer);
      }
    });

    it("resolves relative specifiers against the URL the response came from", async () => {
      // esm.sh answers a bare or versionless path with a redirect to the
      // canonical build directory. The relative specifiers in that body belong
      // to the final directory, so resolving them against the requested URL
      // would fetch an unrelated chunk — or none at all.
      const esmCache = new Map<string, string>();
      const requestedUrl = "https://esm.sh/pkg";
      const finalUrl = "https://esm.sh/v135/pkg@1.0.0/es2022/pkg.mjs";
      const chunkUrl = "https://esm.sh/v135/pkg@1.0.0/es2022/chunk.mjs";
      const requested: string[] = [];
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          requested.push(url);
          if (url === requestedUrl) {
            const redirected = jsonResponse(`export { c } from "./chunk.mjs";`);
            // `Response.url` is read-only, and a synthetic response reports "";
            // defining it is how a followed redirect is simulated here.
            Object.defineProperty(redirected, "url", { value: finalUrl });
            return Promise.resolve(redirected);
          }
          if (url === chunkUrl) return Promise.resolve(jsonResponse(`export const c = 1;`));
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      const result = await fetchEsmModule(requestedUrl, tmpDir, localAdapter, esmCache);

      assertEquals(
        requested.includes(chunkUrl),
        true,
        "the relative specifier must be resolved against the final response URL",
      );
      assertEquals(
        requested.includes("https://esm.sh/chunk.mjs"),
        false,
        "the requested URL's directory must not be used as the base after a redirect",
      );
      assertMatch(
        files.get(result) ?? "",
        /^export \{ c \} from "file:\/\/\/tmp\/esm-rewriter-test\/esm-[a-f0-9]+\.js";$/,
        "the redirected module's chunk must be substituted with its local artifact",
      );
      assertEquals(
        esmCache.get(requestedUrl),
        result,
        "the cache stays keyed by the requested URL, not the redirect target",
      );
    });

    it("prefetches successful template-literal dynamic imports", async () => {
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(jsonResponse("const load = () => import(`https://esm.sh/a`);"));
          }
          if (url === "https://esm.sh/a") {
            return Promise.resolve(jsonResponse("export const a = 1;"));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      const rootContent = files.get(result) ?? "";
      assertEquals(
        /^const load = \(\) => import\(`file:\/\/\/tmp\/esm-rewriter-test\/esm-[a-f0-9]+\.js`\);$/
          .test(rootContent),
        true,
        "the template dynamic import must be rewritten to a local cache file",
      );
    });

    it("does not abort the render when a nested URL fetch fails", async () => {
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(
              jsonResponse(
                `import { a } from "https://esm.sh/a";\nimport("https://esm.sh/broken");`,
              ),
            );
          }
          if (url === "https://esm.sh/a") {
            return Promise.resolve(jsonResponse(`export const a = 1;`));
          }
          if (url === "https://esm.sh/broken") {
            return Promise.resolve(new Response("upstream broken", { status: 500 }));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      const result = await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      const rootContent = files.get(result) ?? "";
      // Successful URL replaced with file://; failed URL preserved for runtime
      // resolution instead of aborting the whole render.
      assertMatch(rootContent, /file:\/\//);
      assertMatch(rootContent, /esm\.sh\/broken/);
    });

    it("does not publish a lazy-failure cycle artifact", async () => {
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
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
        }) as typeof fetch,
      );

      await fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache);
      assertEquals(
        esmCache.size,
        0,
        "a cycle containing a failed lazy subtree must not publish partial artifacts",
      );
    });

    it("rejects a root that reused a cycle artifact with an unwritten dependency", async () => {
      const esmCache = new Map<string, string>();
      const dWritten = Promise.withResolvers<void>();
      const gatedAdapter = {
        fs: {
          writeFile(path: string, content: string) {
            files.set(path, content);
            if (content.includes("export const d = 1")) dWritten.resolve();
            return Promise.resolve();
          },
        },
      } as unknown as RuntimeAdapter;

      installMockFetch(
        (async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return jsonResponse(
              `import { x } from "https://esm.sh/x";\n` +
                `import("https://esm.sh/b");`,
            );
          }
          if (url === "https://esm.sh/b") {
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\n` +
                `import { missing } from "https://esm.sh/broken";\n` +
                `export const b = d;`,
            );
          }
          if (url === "https://esm.sh/d") {
            return jsonResponse(
              `import { b } from "https://esm.sh/b";\nexport const d = 1;`,
            );
          }
          if (url === "https://esm.sh/x") {
            await dWritten.promise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\nexport const x = d;`,
            );
          }
          if (url === "https://esm.sh/broken") {
            return new Response("upstream broken", { status: 500 });
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      );

      await assertRejects(
        () => fetchEsmModule("https://esm.sh/root", tmpDir, gatedAdapter, esmCache),
        Error,
      );
      assertEquals(
        esmCache.size,
        0,
        "a root that transitively points at an unwritten cycle owner must not be published",
      );
    });

    it("rejects a poisoned root when an intermediate hides an unwritten owner", async () => {
      const esmCache = new Map<string, string>();
      const bWritten = Promise.withResolvers<void>();
      const gatedAdapter = {
        fs: {
          writeFile(path: string, content: string) {
            files.set(path, content);
            if (content.includes("export const b = d")) bWritten.resolve();
            return Promise.resolve();
          },
        },
      } as unknown as RuntimeAdapter;

      installMockFetch(
        (async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return jsonResponse(
              `import { x } from "https://esm.sh/x";\n` +
                `import("https://esm.sh/a");`,
            );
          }
          if (url === "https://esm.sh/a") {
            return jsonResponse(
              `import { b } from "https://esm.sh/b";\n` +
                `import { missing } from "https://esm.sh/broken";\n` +
                `export const a = b;`,
            );
          }
          if (url === "https://esm.sh/b") {
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\n` +
                `import { a } from "https://esm.sh/a";\n` +
                `export const b = d;`,
            );
          }
          if (url === "https://esm.sh/d") {
            return jsonResponse(
              `import { b } from "https://esm.sh/b";\nexport const d = b;`,
            );
          }
          if (url === "https://esm.sh/x") {
            await bWritten.promise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\nexport const x = d;`,
            );
          }
          if (url === "https://esm.sh/broken") {
            return new Response("upstream broken", { status: 500 });
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      );

      await assertRejects(
        () => fetchEsmModule("https://esm.sh/root", tmpDir, gatedAdapter, esmCache),
        Error,
      );
      assertEquals(
        esmCache.size,
        0,
        "a poisoned root whose static chain hides an unwritten cycle owner must not publish",
      );
    });

    it("reuses a materialized cycle descendant after an unrelated lazy failure", async () => {
      const esmCache = new Map<string, string>();
      const dWritten = Promise.withResolvers<void>();
      const gatedAdapter = {
        fs: {
          writeFile(path: string, content: string) {
            files.set(path, content);
            if (content.includes("export const d = 1")) dWritten.resolve();
            return Promise.resolve();
          },
        },
      } as unknown as RuntimeAdapter;

      installMockFetch(
        (async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return jsonResponse(
              `import("https://esm.sh/a");\n` +
                `import { x } from "https://esm.sh/x";\n` +
                `export const root = x;`,
            );
          }
          if (url === "https://esm.sh/a") {
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\n` +
                `import("https://esm.sh/broken");\n` +
                `export const a = d;`,
            );
          }
          if (url === "https://esm.sh/d") {
            return jsonResponse(
              `import { a } from "https://esm.sh/a";\nexport const d = 1;`,
            );
          }
          if (url === "https://esm.sh/x") {
            await dWritten.promise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\nexport const x = d;`,
            );
          }
          if (url === "https://esm.sh/broken") {
            return new Response("upstream broken", { status: 500 });
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      );

      const result = await fetchEsmModule(
        "https://esm.sh/root",
        tmpDir,
        gatedAdapter,
        esmCache,
      );

      assertEquals(
        files.has(result),
        true,
        "the root must resolve once every predicted cycle path has materialized",
      );
      assertEquals(
        esmCache.size,
        0,
        "the lazy failure still keeps provisional graph artifacts out of the shared cache",
      );
    });

    it("waits for a cycle owner before a concurrent sibling reuses its descendant", async () => {
      const esmCache = new Map<string, string>();
      const dWritten = Promise.withResolvers<void>();
      const gatedAdapter = {
        fs: {
          writeFile(path: string, content: string) {
            files.set(path, content);
            if (content.includes("export const d = a")) dWritten.resolve();
            return Promise.resolve();
          },
        },
      } as unknown as RuntimeAdapter;

      installMockFetch(
        (async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return jsonResponse(
              `import { a } from "https://esm.sh/a";\n` +
                `import { x } from "https://esm.sh/x";\n` +
                `export const root = a + x;`,
            );
          }
          if (url === "https://esm.sh/a") {
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\n` +
                `import { slow } from "https://esm.sh/slow";\n` +
                `export const a = d + slow;`,
            );
          }
          if (url === "https://esm.sh/d") {
            return jsonResponse(
              `import { a } from "https://esm.sh/a";\nexport const d = a;`,
            );
          }
          if (url === "https://esm.sh/x") {
            await dWritten.promise;
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\nexport const x = d;`,
            );
          }
          if (url === "https://esm.sh/slow") {
            await dWritten.promise;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return jsonResponse("export const slow = 1;");
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      );

      const result = await fetchEsmModule(
        "https://esm.sh/root",
        tmpDir,
        gatedAdapter,
        esmCache,
      );

      assertEquals(files.has(result), true);
      assertEquals(
        esmCache.has("https://esm.sh/x"),
        true,
        "the sibling must finish after the cycle owner materializes its predicted path",
      );
    });
    it("does not await a cycle owner that is still unwinding up the caller's own stack", async () => {
      // The root itself closes the cycle here: `d` points at the root's
      // predicted path, and sibling `x` reuses `d` while the root is still
      // inside its own `Promise.allSettled`. Waiting for the root to write
      // would be waiting on the frame that is waiting for `x`.
      const esmCache = new Map<string, string>();
      const dWritten = Promise.withResolvers<void>();
      const gatedAdapter = {
        fs: {
          writeFile(path: string, content: string) {
            files.set(path, content);
            if (content.includes("export const d = root")) dWritten.resolve();
            return Promise.resolve();
          },
        },
      } as unknown as RuntimeAdapter;

      installMockFetch(
        (async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\n` +
                `import { x } from "https://esm.sh/x";\n` +
                `export const root = d + x;`,
            );
          }
          if (url === "https://esm.sh/d") {
            return jsonResponse(
              `import { root } from "https://esm.sh/root";\nexport const d = root;`,
            );
          }
          if (url === "https://esm.sh/x") {
            await dWritten.promise;
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\nexport const x = d;`,
            );
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlocked = new Promise<"deadlocked">((resolve) => {
        timer = setTimeout(() => resolve("deadlocked"), 2000);
      });
      try {
        const outcome = await Promise.race([
          fetchEsmModule("https://esm.sh/root", tmpDir, gatedAdapter, esmCache),
          deadlocked,
        ]);

        assertEquals(
          outcome === "deadlocked",
          false,
          "a descendant must never wait on an ancestor that is itself waiting on that descendant",
        );
        assertEquals(
          files.has(outcome),
          true,
          "the root artifact must still be written once its own cycle closes",
        );
        assertEquals(
          esmCache.has("https://esm.sh/x"),
          true,
          "the sibling that reused the cyclic descendant must still be published",
        );
        assertEquals(
          esmCache.has("https://esm.sh/root"),
          true,
          "the cycle owner must be published once it writes its own predicted path",
        );
      } finally {
        clearTimeout(timer);
      }
    });

    it("does not await a cycle owner that transitively waits on the sibling reusing its descendant", async () => {
      // `x` reuses `d` after `d` has written a file that points at `a`'s
      // predicted path. `a` is not on `x`'s caller stack, but `a` is waiting on
      // `y`, and `y` is waiting on the in-flight `x`. Waiting for `a` from `x`
      // would deadlock even though the direct `pending` set does not show it.
      const esmCache = new Map<string, string>();
      const dWritten = Promise.withResolvers<void>();
      const gatedAdapter = {
        fs: {
          writeFile(path: string, content: string) {
            files.set(path, content);
            if (content.includes("export const d = a")) dWritten.resolve();
            return Promise.resolve();
          },
        },
      } as unknown as RuntimeAdapter;

      installMockFetch(
        (async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return jsonResponse(
              `import { a } from "https://esm.sh/a";\n` +
                `import { x } from "https://esm.sh/x";\n` +
                `export const root = a + x;`,
            );
          }
          if (url === "https://esm.sh/a") {
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\n` +
                `import { y } from "https://esm.sh/y";\n` +
                `export const a = d + y;`,
            );
          }
          if (url === "https://esm.sh/d") {
            return jsonResponse(
              `import { a } from "https://esm.sh/a";\nexport const d = a;`,
            );
          }
          if (url === "https://esm.sh/y") {
            return jsonResponse(
              `import { x } from "https://esm.sh/x";\nexport const y = x;`,
            );
          }
          if (url === "https://esm.sh/x") {
            await dWritten.promise;
            return jsonResponse(
              `import { d } from "https://esm.sh/d";\nexport const x = d;`,
            );
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlocked = new Promise<"deadlocked">((resolve) => {
        timer = setTimeout(() => resolve("deadlocked"), 2000);
      });
      try {
        const outcome = await Promise.race([
          fetchEsmModule("https://esm.sh/root", tmpDir, gatedAdapter, esmCache),
          deadlocked,
        ]);

        assertEquals(
          outcome === "deadlocked",
          false,
          "a sibling must not wait on a cycle owner that already waits on that sibling",
        );
        assertEquals(
          files.has(outcome),
          true,
          "the root artifact must still be written once the transitive sibling wait closes",
        );
        assertEquals(
          esmCache.has("https://esm.sh/x"),
          true,
          "the sibling that reused the cyclic descendant must still be published",
        );
        assertEquals(
          esmCache.has("https://esm.sh/a"),
          true,
          "the cycle owner must be published once it writes its own predicted path",
        );
      } finally {
        clearTimeout(timer);
      }
    });

    it("breaks a cycle between two siblings that are both still in flight", async () => {
      // The root pulls `a` and `b` concurrently and they statically import each
      // other. Each sibling finds the other in `graph.inFlight` before either
      // has produced an artifact, so neither the caller-stack `pending` set nor
      // `graph.artifacts` shows the cycle: only the recorded wait edges do.
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(jsonResponse(
              `import { a } from "https://esm.sh/a";\n` +
                `import { b } from "https://esm.sh/b";\n` +
                `export const root = a + b;`,
            ));
          }
          if (url === "https://esm.sh/a") {
            return Promise.resolve(jsonResponse(
              `import { b } from "https://esm.sh/b";\nexport const a = b;`,
            ));
          }
          if (url === "https://esm.sh/b") {
            return Promise.resolve(jsonResponse(
              `import { a } from "https://esm.sh/a";\nexport const b = a;`,
            ));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlocked = new Promise<"deadlocked">((resolve) => {
        timer = setTimeout(() => resolve("deadlocked"), 2000);
      });
      try {
        const outcome = await Promise.race([
          fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache),
          deadlocked,
        ]);

        assertEquals(
          outcome === "deadlocked",
          false,
          "two in-flight siblings that import each other must not wait on each other forever",
        );
        assertEquals(
          files.has(outcome),
          true,
          "the root artifact must be written once the sibling cycle is broken",
        );
        for (const member of ["https://esm.sh/a", "https://esm.sh/b"]) {
          assertEquals(
            esmCache.has(member),
            true,
            `${member} must be published once the whole graph materializes`,
          );
        }
        const bContent = files.get(esmCache.get("https://esm.sh/b") ?? "") ?? "";
        assertMatch(bContent, /file:\/\//);
        assertEquals(
          /esm\.sh\/a/.test(bContent),
          false,
          "the sibling that broke the cycle must still point at its owner's local path",
        );
        assertEquals(
          files.has((esmCache.get("https://esm.sh/a") ?? "").replace("file://", "")),
          true,
          "the predicted path the cycle-breaking sibling emitted must actually be written",
        );
      } finally {
        clearTimeout(timer);
      }
    });

    it("breaks a sibling cycle that closes through a third module", async () => {
      // `a` and `b` start concurrently, `b` reaches `c`, and `c` imports `a`.
      // No single frame's `pending` set contains `a` when `c` asks for it, so
      // the cycle is only visible by following `a` -> `b` -> `c` through the
      // recorded wait edges.
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(jsonResponse(
              `import { a } from "https://esm.sh/a";\n` +
                `import { b } from "https://esm.sh/b";\n` +
                `export const root = a + b;`,
            ));
          }
          if (url === "https://esm.sh/a") {
            return Promise.resolve(jsonResponse(
              `import { b } from "https://esm.sh/b";\nexport const a = b;`,
            ));
          }
          if (url === "https://esm.sh/b") {
            return Promise.resolve(jsonResponse(
              `import { c } from "https://esm.sh/c";\nexport const b = c;`,
            ));
          }
          if (url === "https://esm.sh/c") {
            return Promise.resolve(jsonResponse(
              `import { a } from "https://esm.sh/a";\nexport const c = a;`,
            ));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlocked = new Promise<"deadlocked">((resolve) => {
        timer = setTimeout(() => resolve("deadlocked"), 2000);
      });
      try {
        const outcome = await Promise.race([
          fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache),
          deadlocked,
        ]);

        assertEquals(
          outcome === "deadlocked",
          false,
          "a transitive sibling cycle must be broken rather than awaited",
        );
        for (const member of ["https://esm.sh/a", "https://esm.sh/b", "https://esm.sh/c"]) {
          assertEquals(
            esmCache.has(member),
            true,
            `${member} must be published once the transitive sibling cycle materializes`,
          );
        }
        const cContent = files.get(esmCache.get("https://esm.sh/c") ?? "") ?? "";
        assertEquals(
          /esm\.sh\/a/.test(cContent),
          false,
          "the module that closed the cycle must point at a local path for its owner",
        );
      } finally {
        clearTimeout(timer);
      }
    });

    it("still throws when a nested URL is imported statically", async () => {
      // The emitted module's own import graph must be local before the runtime
      // loader is handed it. Leaving a static dependency remote would change
      // that contract, so this failure stays fatal.
      const esmCache = new Map<string, string>();
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(jsonResponse(`import { b } from "https://esm.sh/broken";`));
          }
          if (url === "https://esm.sh/broken") {
            return Promise.resolve(new Response("upstream broken", { status: 500 }));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

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
      installMockFetch(
        ((input: RequestInfo | URL) => {
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
        }) as typeof fetch,
      );

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
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          fetchCount++;
          if (fetchCount > 8) throw new Error(`runaway fetch of ${url}`);
          if (url === "https://esm.sh/self") {
            return Promise.resolve(
              jsonResponse(`export { x } from "https://esm.sh/self";\nexport const x = 1;`),
            );
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

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
      installMockFetch(
        ((input: RequestInfo | URL) => {
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
        }) as typeof fetch,
      );

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
      installMockFetch(
        ((input: RequestInfo | URL) => {
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
        }) as typeof fetch,
      );

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
      installMockFetch(
        ((input: RequestInfo | URL) => {
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
        }) as typeof fetch,
      );

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

    it("does not delete a cache entry published by a concurrent graph", async () => {
      const esmCache = new Map<string, string>();
      const concurrentRootPath = `${tmpDir}/concurrent-root.js`;
      installMockFetch(
        ((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === "https://esm.sh/root") {
            return Promise.resolve(jsonResponse(
              `import { b } from "https://esm.sh/cycle-b";`,
            ));
          }
          if (url === "https://esm.sh/cycle-b") {
            return Promise.resolve(jsonResponse(
              `import { r } from "https://esm.sh/root";\n` +
                `import { x } from "https://esm.sh/broken";\n` +
                `export const b = r;`,
            ));
          }
          if (url === "https://esm.sh/broken") {
            esmCache.set("https://esm.sh/root", concurrentRootPath);
            return Promise.resolve(new Response("upstream broken", { status: 500 }));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        }) as typeof fetch,
      );

      await assertRejects(
        () => fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache),
        Error,
      );

      assertEquals(
        esmCache.get("https://esm.sh/root"),
        concurrentRootPath,
        "a failed graph must not remove another graph's published root artifact",
      );
    });

    it("still throws when the top-level URL itself fails", async () => {
      const esmCache = new Map<string, string>();
      installMockFetch(
        (() => Promise.resolve(new Response("upstream broken", { status: 500 }))) as typeof fetch,
      );

      await assertRejects(
        () => fetchEsmModule("https://esm.sh/root", tmpDir, localAdapter, esmCache),
        Error,
      );
    });
  });
});
