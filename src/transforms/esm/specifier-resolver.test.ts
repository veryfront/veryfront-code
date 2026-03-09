import { assertEquals } from "#veryfront/testing/assert.ts";
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
      assertEquals(result.size, 0);
    });

    it("returns empty map for internal bare specifiers", async () => {
      const code = `import { foo } from "#veryfront/utils";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.size, 0);
    });

    it("returns empty map for node: scheme", async () => {
      const code = `import fs from "node:fs";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.size, 0);
    });

    it("rewrites npm: specifiers when cache returns a path", async () => {
      const code = `import React from "npm:react@18";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-12345.mjs";
      const result = await buildReplacements(code, undefined, defaultOptions, mockCache);
      assertEquals(result.has("npm:react@18"), true);
      assertEquals(result.get("npm:react@18"), "file:///tmp/cache/http-12345.mjs");
    });

    it("npm: specifier falls back to bare name when cache returns null", async () => {
      const code = `import React from "npm:react@18";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.get("npm:react@18"), "react@18");
    });

    it("rewrites http URL when cache returns a path", async () => {
      const code = `import lodash from "https://esm.sh/lodash@4";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-99999.mjs";
      const result = await buildReplacements(code, undefined, defaultOptions, mockCache);
      assertEquals(result.has("https://esm.sh/lodash@4"), true);
      assertEquals(result.get("https://esm.sh/lodash@4"), "file:///tmp/cache/http-99999.mjs");
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
      assertEquals(result.get("https://esm.sh/lodash@4"), "./http-99999.mjs");
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
      assertEquals(result.has("./utils.js"), true);
      assertEquals(result.get("./utils.js"), "./http-11111.mjs");
    });

    it("ignores relative specifiers without HTTP base URL", async () => {
      const code = `import { foo } from "./utils.js";`;
      const result = await buildReplacements(code, undefined, defaultOptions, noopCache);
      assertEquals(result.size, 0);
    });

    it("propagates cache errors", async () => {
      const code = `import foo from "https://esm.sh/foo";`;
      let caught: Error | null = null;
      try {
        await buildReplacements(code, undefined, defaultOptions, async () => {
          throw new Error("cache failed");
        });
      } catch (e) {
        caught = e as Error;
      }
      assertEquals(caught?.message, "cache failed");
    });
  });

  describe("rewriteModuleImports", () => {
    it("returns code unchanged when no replacements needed", async () => {
      const code = `import fs from "node:fs";`;
      const result = await rewriteModuleImports(code, "", defaultOptions, noopCache);
      assertEquals(result, code);
    });

    it("rewrites http import in code", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const mockCache: CacheHttpModuleFn = async () => "/tmp/cache/http-12345.mjs";
      const result = await rewriteModuleImports(code, "", defaultOptions, mockCache);
      assertEquals(result.includes("file:///tmp/cache/http-12345.mjs"), true);
      assertEquals(result.includes("https://esm.sh/react@18"), false);
    });

    it("propagates cache errors from rewriteModuleImports", async () => {
      let caught: Error | null = null;
      try {
        await rewriteModuleImports(
          `import foo from "https://esm.sh/foo";`,
          "https://esm.sh/parent",
          defaultOptions,
          async () => { throw new Error("cache failed"); },
        );
      } catch (e) {
        caught = e as Error;
      }
      assertEquals(caught?.message, "cache failed");
    });
  });
});
