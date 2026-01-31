/** @module transforms/mdx/esm-module-loader/loader.test */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

function resolveProjectDir(context: {
  projectDir?: string;
  adapter?: { env: { get(key: string): string | undefined } };
}): string {
  if (context.projectDir) return context.projectDir;

  const env = context.adapter?.env;
  const envProjectDir = env?.get("VERYFRONT_PROJECT_DIR") ?? env?.get("VF_PROJECT_DIR");
  if (envProjectDir) return envProjectDir;

  throw new Error(
    "[MDX] projectDir is required for import map resolution. Pass it explicitly to loadModuleESM.",
  );
}

function rewriteProjectAliasImports(code: string): string {
  return code.replace(/from\s*["']@\/([^"']+)["']/g, (_match, path: string) => {
    const jsPath = path.endsWith(".js") ? path : `${path}.js`;
    return `from "/_vf_modules/${jsPath}"`;
  });
}

function stripReactFromImportMap(importMap: {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}): { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> } {
  const isReactSpecifier = (key: string): boolean =>
    key === "react" ||
    key === "react-dom" ||
    key.startsWith("react/") ||
    key.startsWith("react-dom/");

  const imports = importMap.imports ? { ...importMap.imports } : undefined;
  if (imports) {
    for (const key of Object.keys(imports)) {
      if (isReactSpecifier(key)) delete imports[key];
    }
  }

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => {
        const filtered = { ...mappings };
        for (const key of Object.keys(filtered)) {
          if (isReactSpecifier(key)) delete filtered[key];
        }
        return [scope, filtered];
      }),
    )
    : undefined;

  return { imports, scopes };
}

function findVfModuleImports(code: string): Array<{ original: string; path: string }> {
  const imports: Array<{ original: string; path: string }> = [];
  const pattern = /from\s*["'](\/?)(_vf_modules\/[^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const [original, , path] = match;
    imports.push({ original, path });
  }

  return imports;
}

describe("esm-module-loader/loader", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("resolveProjectDir", () => {
    it("returns projectDir when provided directly", () => {
      assertEquals(resolveProjectDir({ projectDir: "/my/project" }), "/my/project");
    });

    it("falls back to VERYFRONT_PROJECT_DIR env var", () => {
      const ctx = {
        adapter: {
          env: {
            get: (key: string) => (key === "VERYFRONT_PROJECT_DIR" ? "/env/project" : undefined),
          },
        },
      };
      assertEquals(resolveProjectDir(ctx), "/env/project");
    });

    it("falls back to VF_PROJECT_DIR env var", () => {
      const ctx = {
        adapter: {
          env: {
            get: (key: string) => (key === "VF_PROJECT_DIR" ? "/vf/project" : undefined),
          },
        },
      };
      assertEquals(resolveProjectDir(ctx), "/vf/project");
    });

    it("prefers VERYFRONT_PROJECT_DIR over VF_PROJECT_DIR", () => {
      const ctx = {
        adapter: {
          env: {
            get: (key: string) => {
              if (key === "VERYFRONT_PROJECT_DIR") return "/preferred";
              if (key === "VF_PROJECT_DIR") return "/fallback";
              return undefined;
            },
          },
        },
      };
      assertEquals(resolveProjectDir(ctx), "/preferred");
    });

    it("throws when no project dir available", () => {
      try {
        resolveProjectDir({});
      } catch (e) {
        assertEquals((e as Error).message.includes("projectDir is required"), true);
        return;
      }
      assertEquals(true, false);
    });

    it("throws when adapter has no matching env vars", () => {
      try {
        resolveProjectDir({ adapter: { env: { get: () => undefined } } });
      } catch {
        return;
      }
      assertEquals(true, false);
    });
  });

  describe("rewriteProjectAliasImports", () => {
    it("rewrites @/ imports to /_vf_modules/ paths", () => {
      const code = `import Foo from "@/components/Foo";`;
      assertEquals(
        rewriteProjectAliasImports(code),
        `import Foo from "/_vf_modules/components/Foo.js";`,
      );
    });

    it("preserves .js extension if already present", () => {
      const code = `import utils from "@/lib/utils.js";`;
      assertEquals(
        rewriteProjectAliasImports(code),
        `import utils from "/_vf_modules/lib/utils.js";`,
      );
    });

    it("handles single-quoted imports", () => {
      const code = `import Bar from '@/components/Bar';`;
      assertEquals(
        rewriteProjectAliasImports(code),
        `import Bar from "/_vf_modules/components/Bar.js";`,
      );
    });

    it("rewrites multiple alias imports", () => {
      const code = [`import A from "@/a";`, `import B from "@/b";`, `import C from "react";`].join(
        "\n",
      );
      const result = rewriteProjectAliasImports(code);
      assertEquals(result.includes(`"/_vf_modules/a.js"`), true);
      assertEquals(result.includes(`"/_vf_modules/b.js"`), true);
      assertEquals(result.includes(`"react"`), true);
    });

    it("does not rewrite non-alias imports", () => {
      const code = `import React from "react";`;
      assertEquals(rewriteProjectAliasImports(code), code);
    });

    it("does not rewrite @scoped packages", () => {
      const code = `import pkg from "@scope/package";`;
      assertEquals(rewriteProjectAliasImports(code), code);
    });
  });

  describe("stripReactFromImportMap", () => {
    it("removes react from imports", () => {
      const result = stripReactFromImportMap({
        imports: {
          react: "https://esm.sh/react@18",
          lodash: "https://esm.sh/lodash",
        },
      });
      assertEquals(result.imports?.react, undefined);
      assertEquals(result.imports?.lodash, "https://esm.sh/lodash");
    });

    it("removes react-dom from imports", () => {
      const result = stripReactFromImportMap({
        imports: {
          "react-dom": "https://esm.sh/react-dom@18",
          other: "https://other.com",
        },
      });
      assertEquals(result.imports?.["react-dom"], undefined);
      assertEquals(result.imports?.other, "https://other.com");
    });

    it("removes react subpath imports", () => {
      const result = stripReactFromImportMap({
        imports: {
          "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime",
          "react-dom/client": "https://esm.sh/react-dom@18/client",
          "lodash/fp": "https://esm.sh/lodash/fp",
        },
      });
      assertEquals(result.imports?.["react/jsx-runtime"], undefined);
      assertEquals(result.imports?.["react-dom/client"], undefined);
      assertEquals(result.imports?.["lodash/fp"], "https://esm.sh/lodash/fp");
    });

    it("strips react from scopes", () => {
      const result = stripReactFromImportMap({
        imports: {},
        scopes: {
          "/": {
            react: "https://esm.sh/react@18",
            lodash: "https://esm.sh/lodash",
          },
        },
      });
      assertEquals(result.scopes?.["/"]?.react, undefined);
      assertEquals(result.scopes?.["/"]?.lodash, "https://esm.sh/lodash");
    });

    it("handles empty import map", () => {
      const result = stripReactFromImportMap({});
      assertEquals(result.imports, undefined);
      assertEquals(result.scopes, undefined);
    });

    it("does not mutate the original", () => {
      const original = { imports: { react: "url", other: "url2" } };
      stripReactFromImportMap(original);
      assertEquals(original.imports.react, "url");
    });
  });

  describe("findVfModuleImports", () => {
    it("finds _vf_modules/ imports with leading slash", () => {
      const code = `import Foo from "/_vf_modules/components/Foo.js";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1);
      const first = imports[0];
      assertExists(first);
      assertEquals(first.path, "_vf_modules/components/Foo.js");
    });

    it("finds _vf_modules/ imports without leading slash", () => {
      const code = `import Bar from "_vf_modules/pages/Bar.js";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1);
      const first = imports[0];
      assertExists(first);
      assertEquals(first.path, "_vf_modules/pages/Bar.js");
    });

    it("finds multiple imports", () => {
      const code = [
        `import A from "/_vf_modules/a.js";`,
        `import B from "_vf_modules/b.js";`,
        `import C from "react";`,
      ].join("\n");
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 2);
    });

    it("returns empty array for code without _vf_modules", () => {
      const code = `import React from "react";`;
      assertEquals(findVfModuleImports(code).length, 0);
    });

    it("handles single-quoted imports", () => {
      const code = `import Foo from '/_vf_modules/foo.js';`;
      assertEquals(findVfModuleImports(code).length, 1);
    });

    it("preserves full original match for replacement", () => {
      const code = `import { useState } from "/_vf_modules/react/hooks.js";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1);
      const first = imports[0];
      assertExists(first);
      assertEquals(first.original.includes("_vf_modules/react/hooks.js"), true);
    });
  });

  describe("MDXLayout detection regex", () => {
    const hasLayoutDecl = (code: string): boolean => /\bconst\s+MDXLayout\b/.test(code);
    const hasLayoutExport = (code: string): boolean => /export\s+\{[^}]*MDXLayout/.test(code);

    it("detects const MDXLayout declaration", () => {
      assertEquals(hasLayoutDecl("const MDXLayout = SomeLayout;"), true);
    });

    it("does not match MDXLayout in other contexts", () => {
      assertEquals(hasLayoutDecl("let MDXLayout = SomeLayout;"), false);
    });

    it("detects export { MDXLayout }", () => {
      assertEquals(hasLayoutExport("export { MDXLayout as __vfLayout };"), true);
    });

    it("returns false when no export of MDXLayout", () => {
      assertEquals(hasLayoutExport("export { foo };"), false);
    });

    it("auto-export needed when layout declared but not exported", () => {
      const code = "const MDXLayout = Layout;";
      assertEquals(hasLayoutDecl(code) && !hasLayoutExport(code), true);
    });

    it("auto-export not needed when already exported", () => {
      const code = "const MDXLayout = Layout;\nexport { MDXLayout as __vfLayout };";
      assertEquals(hasLayoutDecl(code) && !hasLayoutExport(code), false);
    });
  });
});
