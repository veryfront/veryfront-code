import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheHttpModuleFn } from "./specifier-resolver.ts";
import { buildReplacements, rewriteModuleImports } from "./specifier-resolver.ts";
import type { CacheOptions } from "./http-cache-helpers.ts";

describe("transforms/esm/specifier-resolver", () => {
  const defaultOptions: CacheOptions = {
    cacheDir: "/tmp/cache",
    importMap: { imports: {} },
  };

  const noopCache: CacheHttpModuleFn = async () => null;

  describe("buildReplacements", () => {
    it("returns empty map for code with no imports", async () => {
      const result = await buildReplacements("const x = 1;", undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("returns empty map for internal bare specifiers", async () => {
      const code = `import { foo } from "#veryfront/utils";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("returns empty map for node: scheme", async () => {
      const code = `import fs from "node:fs";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("does not rewrite private import-map aliases to esm.sh fragments", async () => {
      const code = `import { load } from "#std/dotenv.ts";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        "https://esm.sh/?external=react&target=es2022",
        defaultOptions,
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-std.mjs";
        },
      );

      assertEquals(result.replacements.size, 0);
      assertEquals(cacheCalls, []);
    });

    it("rewrites mapped private import-map aliases before skipping internal aliases", async () => {
      const code = `import pkg from "#pkg";`;
      const cacheCalls: string[] = [];
      const result = await buildReplacements(
        code,
        "https://esm.sh/parent@1/index.js",
        {
          ...defaultOptions,
          importMap: {
            imports: {
              "#pkg": "https://cdn.example.com/pkg.js",
            },
          },
        },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-pkg.mjs";
        },
      );

      assertEquals(result.replacements.get("#pkg"), "./http-pkg.mjs");
      assertEquals(cacheCalls, ["https://cdn.example.com/pkg.js"]);
    });

    it("returns empty map for jsr: specifiers", async () => {
      const code = `import { load } from "jsr:@std/dotenv@0.225.6";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("rewrites npm: specifiers when cache returns a path", async () => {
      const code = `import React from "npm:react@18";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-12345.mjs";
      const result = await buildReplacements(code, undefined, defaultOptions, mockCache);
      assertEquals(result.replacements.has("npm:react@18"), true);
      assertEquals(result.replacements.get("npm:react@18"), "file:///tmp/cache/http-12345.mjs");
    });

    it("npm: specifier falls back to bare name when cache returns null", async () => {
      const code = `import React from "npm:react@18";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.get("npm:react@18"), "react@18");
    });

    it("rewrites http URL when cache returns a path", async () => {
      const code = `import lodash from "https://esm.sh/lodash@4";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-99999.mjs";
      const result = await buildReplacements(code, undefined, defaultOptions, mockCache);
      assertEquals(result.replacements.has("https://esm.sh/lodash@4"), true);
      assertEquals(
        result.replacements.get("https://esm.sh/lodash@4"),
        "file:///tmp/cache/http-99999.mjs",
      );
    });

    it("rewrites mapped esm.sh veryfront URLs to local framework modules without caching", async () => {
      const specifier = "https://esm.sh/veryfront@0.1.759/chat";
      const code = `import { Chat } from "${specifier}";`;
      const cacheCalls: string[] = [];

      const result = await buildReplacements(
        code,
        undefined,
        {
          ...defaultOptions,
          importMap: {
            imports: {
              "veryfront/chat": "/_vf_modules/_veryfront/chat/index.js?ssr=true",
            },
          },
        },
        async (url) => {
          cacheCalls.push(url);
          return "/tmp/cache/http-veryfront.mjs";
        },
      );

      assertEquals(
        result.replacements.get(specifier),
        "/_vf_modules/_veryfront/chat/index.js?ssr=true",
      );
      assertEquals(cacheCalls, []);
    });

    it("uses relative path when parent is an HTTP module", async () => {
      const code = `import lodash from "https://esm.sh/lodash@4";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-99999.mjs";
      const result = await buildReplacements(
        code,
        "https://esm.sh/parent@1",
        defaultOptions,
        mockCache,
      );
      assertEquals(result.replacements.get("https://esm.sh/lodash@4"), "./http-99999.mjs");
    });

    it("resolves relative specifiers against HTTP base URL", async () => {
      const code = `import { foo } from "./utils.js";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-11111.mjs";
      const result = await buildReplacements(
        code,
        "https://esm.sh/my-lib@1/index.js",
        defaultOptions,
        mockCache,
      );
      assertEquals(result.replacements.has("./utils.js"), true);
      assertEquals(result.replacements.get("./utils.js"), "./http-11111.mjs");
    });

    it("ignores relative specifiers without HTTP base URL", async () => {
      const code = `import { foo } from "./utils.js";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.replacements.size, 0);
    });

    it("skips a dynamic specifier whose cache lookup throws instead of aborting", async () => {
      // The motivating case: a lazy `import(...)` that never runs at render
      // time. Pre-fetching it is an optimisation, so the specifier is left in
      // place for the runtime to resolve at call time, and one upstream 500
      // does not abort the whole SSR transform.
      const code = `export const load = () => import("https://esm.sh/foo");`;
      const result = await buildReplacements(
        code,
        undefined,
        defaultOptions,
        async () => {
          throw new Error("cache failed");
        },
      );
      assertEquals(result.replacements.size, 0);
    });

    it("aborts when a static specifier's cache lookup throws", async () => {
      // A static import belongs to the emitted module's own import graph. The
      // artifact contract is that every static dependency is local before the
      // runtime loader sees it, so this failure stays fatal.
      const code = `import foo from "https://esm.sh/foo";`;
      await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("aborts when a specifier is imported both statically and dynamically", async () => {
      const code = `import foo from "https://esm.sh/foo";\nexport const again = () =>` +
        ` import("https://esm.sh/foo");`;
      await assertRejects(
        () =>
          buildReplacements(code, undefined, defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("reports a skipped dynamic absolute URL as degraded", async () => {
      const code = `export const load = () => import("https://esm.sh/foo");`;
      const result = await buildReplacements(
        code,
        undefined,
        defaultOptions,
        async () => {
          throw new Error("cache failed");
        },
      );
      assertEquals(result.degraded, ["https://esm.sh/foo"]);
    });

    it("reports nothing as degraded when every specifier resolves", async () => {
      const code = `import ok from "https://esm.sh/ok";`;
      const result = await buildReplacements(
        code,
        undefined,
        defaultOptions,
        async () => "/tmp/cache/http-ok.mjs",
      );
      assertEquals(result.degraded, []);
    });

    it("aborts when a dynamic relative specifier fails to resolve", async () => {
      // A relative specifier inside an esm.sh bundle resolves at call time
      // against the local bundle cache directory, where the chunk was never
      // written. Leaving it in place would guarantee a runtime failure.
      const code = `export const load = () => import("./chunk-abc.mjs");`;
      await assertRejects(
        () =>
          buildReplacements(code, "https://esm.sh/parent@1/index.js", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("aborts when a dynamic npm: specifier fails to resolve", async () => {
      const code = `export const load = () => import("npm:some-package");`;
      await assertRejects(
        () =>
          buildReplacements(code, "https://esm.sh/parent@1/index.js", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("leaves a server-only package external instead of routing it to esm.sh", async () => {
      // `redis` and its explicit npm: form only run server-side. They must be
      // left in place for the runtime to resolve (node_modules / npm:), never
      // fetched from esm.sh — so the cache function is never called and nothing
      // is degraded or aborted.
      for (const specifier of ["redis", "npm:redis", "npm:redis@5.11.0"]) {
        const code = `export const load = () => import(${JSON.stringify(specifier)});`;
        let cacheCalls = 0;
        const result = await buildReplacements(
          code,
          "https://esm.sh/parent@1/index.js",
          defaultOptions,
          async () => {
            cacheCalls++;
            return null;
          },
        );
        assertEquals(cacheCalls, 0, `${specifier} must not hit esm.sh`);
        assertEquals(result.replacements.size, 0, `${specifier} must be left in place`);
        assertEquals(result.degraded, []);
      }
    });

    it("aborts when a dynamic bare specifier fails to resolve", async () => {
      const code = `export const load = () => import("some-package");`;
      await assertRejects(
        () =>
          buildReplacements(code, "https://esm.sh/parent@1/index.js", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });

    it("still resolves other specifiers when a dynamic one throws", async () => {
      const code = `import ok from "https://esm.sh/ok";\n` +
        `export const load = () => import("https://esm.sh/broken");`;
      const cache: CacheHttpModuleFn = async (url) => {
        if (url === "https://esm.sh/broken") throw new Error("upstream 500");
        return "/tmp/cache/http-ok.mjs";
      };
      const result = await buildReplacements(code, undefined, defaultOptions, cache);
      assertEquals(result.replacements.get("https://esm.sh/ok"), "file:///tmp/cache/http-ok.mjs");
      assertEquals(result.replacements.has("https://esm.sh/broken"), false);
    });
  });

  describe("rewriteModuleImports", () => {
    it("returns code unchanged when no replacements needed", async () => {
      const code = `import fs from "node:fs";`;
      const result = await rewriteModuleImports(code, "", defaultOptions, noopCache);
      assertEquals(result.code, code);
    });

    it("rewrites http import in code", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-12345.mjs";
      const result = await rewriteModuleImports(code, "", defaultOptions, mockCache);
      assertEquals(result.code.includes("file:///tmp/cache/http-12345.mjs"), true);
      assertEquals(result.code.includes("https://esm.sh/react@18"), false);
    });

    it("leaves a dynamic specifier untouched when its cache lookup throws", async () => {
      // Same split contract as buildReplacements: a lazy import that fails to
      // pre-fetch stays in the emitted code for the runtime to resolve.
      const original = `export const load = () => import("https://esm.sh/foo");`;
      const result = await rewriteModuleImports(
        original,
        "https://esm.sh/parent",
        defaultOptions,
        async () => {
          throw new Error("cache failed");
        },
      );
      assertEquals(result.code, original);
    });

    it("reports the specifiers left in place as degraded", async () => {
      const original = `export const load = () => import("https://esm.sh/foo");`;
      const result = await rewriteModuleImports(
        original,
        "https://esm.sh/parent",
        defaultOptions,
        async () => {
          throw new Error("cache failed");
        },
      );
      assertEquals(result.degraded, ["https://esm.sh/foo"]);
    });

    it("aborts when a static specifier's cache lookup throws", async () => {
      const original = `import foo from "https://esm.sh/foo";`;
      await assertRejects(
        () =>
          rewriteModuleImports(original, "https://esm.sh/parent", defaultOptions, async () => {
            throw new Error("cache failed");
          }),
        Error,
        "cache failed",
      );
    });
  });
});
