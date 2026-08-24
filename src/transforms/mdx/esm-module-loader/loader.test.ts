import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/loader.test */

import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { findVfModuleImports, resolveProjectDir } from "./loader-helpers.ts";
import { rewriteProjectAliasImports, transformImports } from "./import-transformer.ts";
import type { ESMLoaderContext } from "./types.ts";

function makeContext(overrides: Partial<ESMLoaderContext> = {}): ESMLoaderContext {
  return {
    moduleCache: new LRUCache({ maxEntries: 10 }),
    ...overrides,
  };
}

function envAdapter(values: Record<string, string>): ESMLoaderContext["adapter"] {
  return {
    env: { get: (key: string) => values[key] },
  } as ESMLoaderContext["adapter"];
}

describe("esm-module-loader/loader", () => {
  describe("resolveProjectDir", () => {
    it("returns projectDir when provided directly", () => {
      assertEquals(
        resolveProjectDir(makeContext({ projectDir: "/my/project" })),
        "/my/project",
        "an explicit projectDir wins",
      );
    });

    it("falls back to VERYFRONT_PROJECT_DIR env var", () => {
      const context = makeContext({
        adapter: envAdapter({ VERYFRONT_PROJECT_DIR: "/env/project" }),
      });
      assertEquals(resolveProjectDir(context), "/env/project", "VERYFRONT_PROJECT_DIR is read");
    });

    it("falls back to VF_PROJECT_DIR env var", () => {
      const context = makeContext({
        adapter: envAdapter({ VF_PROJECT_DIR: "/vf/project" }),
      });
      assertEquals(resolveProjectDir(context), "/vf/project", "VF_PROJECT_DIR is read");
    });

    it("prefers VERYFRONT_PROJECT_DIR over VF_PROJECT_DIR", () => {
      const context = makeContext({
        adapter: envAdapter({
          VERYFRONT_PROJECT_DIR: "/preferred",
          VF_PROJECT_DIR: "/fallback",
        }),
      });
      assertEquals(resolveProjectDir(context), "/preferred", "VERYFRONT_PROJECT_DIR wins");
    });

    it("throws when no project dir available", () => {
      const error = assertThrows(
        () => resolveProjectDir(makeContext()),
        VeryfrontError,
        "projectDir is required",
      ) as VeryfrontError;

      assertEquals(
        error.slug,
        "invalid-argument",
        "a missing projectDir is classified as an invalid argument",
      );
    });

    it("throws when adapter has no matching env vars", () => {
      const error = assertThrows(
        () => resolveProjectDir(makeContext({ adapter: envAdapter({}) })),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(
        error.slug,
        "invalid-argument",
        "an adapter without project-dir env vars is still an invalid argument",
      );
    });
  });

  describe("rewriteProjectAliasImports", () => {
    it("rewrites @/ imports to /_vf_modules/ paths", async () => {
      const code = `import Foo from "@/components/Foo";`;
      assertEquals(
        await rewriteProjectAliasImports(code),
        `import Foo from "/_vf_modules/components/Foo.js";`,
        "an alias import is mapped onto the module server path",
      );
    });

    it("preserves .js extension if already present", async () => {
      const code = `import utils from "@/lib/utils.js";`;
      assertEquals(
        await rewriteProjectAliasImports(code),
        `import utils from "/_vf_modules/lib/utils.js";`,
        "an existing .js extension is not doubled",
      );
    });

    it("handles single-quoted imports", async () => {
      const code = `import Bar from '@/components/Bar';`;
      assertEquals(
        await rewriteProjectAliasImports(code),
        `import Bar from '/_vf_modules/components/Bar.js';`,
        "single-quoted alias imports are rewritten",
      );
    });

    it("rewrites multiple alias imports", async () => {
      const code = [`import A from "@/a";`, `import B from "@/b";`, `import C from "react";`].join(
        "\n",
      );
      const result = await rewriteProjectAliasImports(code);
      assertEquals(result.includes(`"/_vf_modules/a.js"`), true, "the first alias is rewritten");
      assertEquals(result.includes(`"/_vf_modules/b.js"`), true, "the second alias is rewritten");
      assertEquals(result.includes(`"react"`), true, "a bare specifier is left alone");
    });

    it("rewrites dynamic @/ imports", async () => {
      const code = `const Lazy = await import("@/components/Button");`;
      assertEquals(
        await rewriteProjectAliasImports(code),
        `const Lazy = await import("/_vf_modules/components/Button.js");`,
        "the specifier-aware rewriter also sees dynamic imports",
      );
    });

    it("does not rewrite non-alias imports", async () => {
      const code = `import React from "react";`;
      assertEquals(await rewriteProjectAliasImports(code), code, "bare imports are untouched");
    });

    it("does not rewrite @scoped packages", async () => {
      const code = `import pkg from "@scope/package";`;
      assertEquals(await rewriteProjectAliasImports(code), code, "scoped packages are untouched");
    });
  });

  describe("transformImports strips React from the import map", () => {
    it("removes react from imports", () => {
      const result = transformImports(`import React from "react";\n`, {
        imports: {
          react: "https://esm.sh/react@18",
          lodash: "https://esm.sh/lodash",
        },
      });
      assertEquals(
        result.includes("https://esm.sh/react@18"),
        false,
        "react must stay bare so SSR uses one React instance",
      );
    });

    it("removes react-dom from imports", () => {
      const result = transformImports(
        [`import ReactDOM from "react-dom";`, `import other from "other";`, ``].join("\n"),
        {
          imports: {
            "react-dom": "https://esm.sh/react-dom@18",
            other: "https://other.com/other.js",
          },
        },
      );
      assertEquals(
        result.includes("https://esm.sh/react-dom@18"),
        false,
        "react-dom must stay bare",
      );
      assertEquals(
        result.includes("https://other.com/other.js"),
        true,
        "non-React entries are still applied",
      );
    });

    it("removes react subpath imports", () => {
      const result = transformImports(
        [
          `import { jsx } from "react/jsx-runtime";`,
          `import { createRoot } from "react-dom/client";`,
          `import fp from "lodash/fp";`,
          ``,
        ].join("\n"),
        {
          imports: {
            "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime",
            "react-dom/client": "https://esm.sh/react-dom@18/client",
            "lodash/fp": "https://esm.sh/lodash/fp",
          },
        },
      );
      assertEquals(
        result.includes("https://esm.sh/react@18/jsx-runtime"),
        false,
        "react subpaths must stay bare",
      );
      assertEquals(
        result.includes("https://esm.sh/react-dom@18/client"),
        false,
        "react-dom subpaths must stay bare",
      );
      assertEquals(
        result.includes("https://esm.sh/lodash/fp"),
        true,
        "non-React subpaths are still applied",
      );
    });

    it("strips react from scopes", () => {
      const importMap = {
        imports: {},
        scopes: {
          "/": {
            react: "https://esm.sh/react@18",
            lodash: "https://esm.sh/lodash",
          },
        },
      };
      const result = transformImports(`import React from "react";\n`, importMap);

      assertEquals(
        result.includes("https://esm.sh/react@18"),
        false,
        "a scoped react entry must not reach the emitted code",
      );
      assertEquals(
        importMap.scopes["/"].react,
        "https://esm.sh/react@18",
        "the caller's scopes object must not be mutated",
      );
    });

    it("handles empty import map", () => {
      const code = `import { foo } from "bar";\n`;
      assertEquals(transformImports(code, {}), code, "an empty import map changes nothing");
    });

    it("does not mutate the original", () => {
      const importMap = { imports: { react: "https://esm.sh/react@18", other: "url2" } };
      transformImports(`import React from "react";\n`, importMap);
      assertEquals(
        importMap.imports.react,
        "https://esm.sh/react@18",
        "the caller's import map must not be mutated",
      );
    });
  });

  describe("findVfModuleImports", () => {
    it("finds _vf_modules/ imports with leading slash", () => {
      const code = `import Foo from "/_vf_modules/components/Foo.js";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1, "one import is found");
      const first = imports[0];
      assertExists(first);
      assertEquals(first.path, "_vf_modules/components/Foo.js", "the leading slash is dropped");
      assertEquals(first.suffix, "", "a specifier without a query has an empty suffix");
      assertEquals(first.isDynamic, undefined, "a static import is not flagged dynamic");
      assertEquals(
        code.slice(first.start, first.end),
        first.original,
        "the reported span covers the original match text",
      );
    });

    it("finds _vf_modules/ imports without leading slash", () => {
      const code = `import Bar from "_vf_modules/pages/Bar.js";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1, "one import is found");
      const first = imports[0];
      assertExists(first);
      assertEquals(first.path, "_vf_modules/pages/Bar.js", "the path is reported verbatim");
    });

    it("finds multiple imports", () => {
      const code = [
        `import A from "/_vf_modules/a.js";`,
        `import B from "_vf_modules/b.js";`,
        `import C from "react";`,
      ].join("\n");
      assertEquals(findVfModuleImports(code).length, 2, "only the vf module imports are found");
    });

    it("returns empty array for code without _vf_modules", () => {
      const code = `import React from "react";`;
      assertEquals(findVfModuleImports(code).length, 0, "no vf module imports are found");
    });

    it("handles single-quoted imports", () => {
      const code = `import Foo from '/_vf_modules/foo.js';`;
      assertEquals(findVfModuleImports(code).length, 1, "single-quoted imports are found");
    });

    it("preserves full original match for replacement", () => {
      const code = `import { useState } from "/_vf_modules/_veryfront/react/hooks.js";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1, "one import is found");
      const first = imports[0];
      assertExists(first);
      assertEquals(
        first.original.includes("_vf_modules/_veryfront/react/hooks.js"),
        true,
        "the original match text is kept for replacement",
      );
    });

    it("flags dynamic imports and splits their query suffix", () => {
      const code = `const mod = await import("/_vf_modules/lazy.js?ssr=true");`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1, "one dynamic import is found");
      const first = imports[0];
      assertExists(first);
      assertEquals(first.path, "_vf_modules/lazy.js", "the query suffix is split off the path");
      assertEquals(first.suffix, "?ssr=true", "the query suffix is reported separately");
      assertEquals(first.isDynamic, true, "a dynamic import is flagged");
    });
  });
});
