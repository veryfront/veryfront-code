import "#veryfront/schemas/_test-setup.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";
import type { CodeParser, NodePath } from "#veryfront/extensions/parser/index.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  applySSRImportRewrites,
  applySSRImportRewritesAsync,
} from "#veryfront/modules/server/ssr-import-rewriter.ts";
import { rewriteDiscoveryImports, rewriteForDeno } from "#veryfront/discovery/import-rewriter.ts";
import { addHMRTimestamps, rewriteBareImports } from "#veryfront/transforms/esm/import-rewriter.ts";
import { TAILWIND_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  stripJsonImportAttributes,
  upgradeImportAssertions,
} from "#veryfront/transforms/esm/import-attributes.ts";
import {
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
} from "#veryfront/routing/api/module-loader/external-import-rewriter.ts";
import {
  applyComputedDynamicImportPinning,
  applyImportEdits,
  parseImportEdits,
} from "./import-edit.ts";
import { rewriteWithImportRewriteCore } from "./core.ts";
import {
  rewriteCompiledVeryfrontImportsForRoute,
  rewriteDenoNodeBuiltinsForRoute,
  rewriteDenoNpmDependencyImportsForRoute,
} from "./route-adapter.ts";
import type { ImportRewriteStrategy, RewriteContext } from "./types.ts";
import {
  pickPackageExportEntry,
  resolveContainedPackagePath,
  resolvePackageExportPath,
  splitPackageSubpath,
} from "./package-resolution.ts";
import { rewriteSSRImportsCompat } from "./ssr-adapter.ts";

function createRewriteContext(overrides?: Partial<RewriteContext>): RewriteContext {
  return {
    filePath: "/project/app/page.tsx",
    projectDir: "/project",
    projectId: "p1",
    target: "browser",
    dev: false,
    reactVersion: "19.2.4",
    ...overrides,
  };
}

describe("import rewrite compatibility golden tests", () => {
  it("preserves transform query and attribute output", async () => {
    assertEquals(
      await addHMRTimestamps(`import m from "./mod.js?v=1";`, "222"),
      `import m from "./mod.js?v=1&t=222";`,
    );
    assertEquals(
      await upgradeImportAssertions(`import data from "./a.json" assert { type: "json" };`),
      `import data from "./a.json" with { type: "json" };`,
    );
    assertEquals(
      await stripJsonImportAttributes(
        `import data from "./a.mjs" with { type: "json" };`,
        () => true,
      ),
      `import data from "./a.mjs";`,
    );
  });

  it("preserves browser bare rewrite output shape", async () => {
    assertEquals(
      await rewriteBareImports(`import tw from "tailwindcss";`, undefined, "19.1.1", "p1"),
      `import tw from "https://esm.sh/tailwindcss@${TAILWIND_VERSION}?external=react&target=es2022";`,
    );
  });

  it("preserves SSR exact query byte ordering", async () => {
    assertEquals(
      applySSRImportRewrites(`import X from "@/page";`, {
        projectSlug: "demo",
        branch: "main",
        cacheBuster: "abc",
      }),
      `import X from "/_vf_modules/page.js?ssr=true&project=demo&branch=main&v=abc";`,
    );
    assertEquals(
      await applySSRImportRewritesAsync(`import X from "@/page";`, {
        resolveCacheBuster: () => "resolved",
      }),
      `import X from "/_vf_modules/page.js?ssr=true&v=resolved";`,
    );
  });

  it("preserves Deno discovery rewrites", () => {
    const out = rewriteForDeno(
      [
        `import { tool } from "veryfront/tool";`,
        `import "reflect-metadata";`,
        `export { z } from "zod";`,
        `import type { ZodSchema } from "zod";`,
      ].join("\n"),
      "/project/tools",
      { compiled: true },
    );
    assertStringIncludes(out, `globalThis.__VERYFRONT_MODULES__["veryfront/tool"]`);
    assertStringIncludes(out, `import "npm:reflect-metadata"`);
    assertStringIncludes(out, `export { z } from "npm:zod"`);
    assertStringIncludes(out, `import type { ZodSchema } from "zod"`);
  });

  it("preserves Node discovery package metadata behavior", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-import-core-" });
    try {
      await Deno.mkdir(`${projectDir}/node_modules/pkg`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/node_modules/pkg/package.json`,
        JSON.stringify({ exports: { ".": "./index.js", "./*": "./*.js" } }),
      );
      await Deno.writeTextFile(`${projectDir}/node_modules/pkg/index.js`, "");
      await Deno.writeTextFile(`${projectDir}/node_modules/pkg/sub.js`, "");

      const out = await rewriteDiscoveryImports(
        [`import main from "pkg";`, `import sub from "pkg/sub";`].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(out, "pkg/index.js");
      assertStringIncludes(out, "pkg/sub.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves route loader compiled and Deno rewrites", async () => {
    assertEquals(
      rewriteCompiledBinaryVeryfrontImports(`import { x } from "veryfront/agent";`),
      `import { x } from "./_vf_agent.mjs";`,
    );
    assertStringIncludes(
      rewriteCompiledBinaryUserDependencyImports(
        `const m = import("lodash/merge");`,
        new Map([["lodash", "^4"]]),
      ),
      `Promise.resolve(require("lodash/merge"))`,
    );
    assertEquals(
      rewriteDenoNodeBuiltinImports(`import { readFile } from "fs";`),
      `import { readFile } from "node:fs";`,
    );

    const fs = createFileSystem();
    const projectDir = await Deno.makeTempDir({ prefix: "vf-route-rewrite-" });
    try {
      await Deno.mkdir(`${projectDir}/node_modules/lodash`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/node_modules/lodash/package.json`,
        JSON.stringify({ version: "4.17.21" }),
      );
      assertEquals(
        await rewriteDenoNpmDependencyImports(
          `import merge from "lodash/merge";`,
          projectDir,
          fs,
          new Map([["lodash", "^4"]]),
        ),
        `import merge from "npm:lodash@4.17.21/merge";`,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("import edit core", () => {
  it("edits specifiers while preserving HTTP strings and attributes", async () => {
    const code =
      `const u = "https://example.com/a";\nimport m from "./a.json" with { type: "json" };\n`;
    const parsed = await parseImportEdits(code);
    const out = applyImportEdits(parsed, new Map([[0, { specifier: "./b.json" }]]));
    assertEquals(
      out,
      `const u = "https://example.com/a";\nimport m from "./b.json" with { type: "json" };\n`,
    );
  });

  it("does not restore masked URLs over user placeholder-looking identifiers", async () => {
    const code = [
      `const __VFURL_0__ = "untouched";`,
      `const endpoint = "https://example.com/api";`,
      `const expression = "./lazy.js";`,
      `const module = import(expression);`,
    ].join("\n");

    const parsed = await parseImportEdits(code);
    const out = applyComputedDynamicImportPinning(parsed, "/_vf_modules/page.js");

    assertStringIncludes(out, `const __VFURL_0__ = "untouched";`);
    assertStringIncludes(out, `const endpoint = "https://example.com/api";`);
    assertStringIncludes(out, `import(/*__vf_dependency_pinned__*/`);
  });
});

describe("package resolution core", () => {
  const windowsLikePathHelper = {
    SEPARATOR: "\\",
    resolve(packagePath: string, entryPoint: string): string {
      const parts = [
        ...packagePath.replaceAll("\\", "/").split("/"),
        ...entryPoint.replaceAll("\\", "/").split("/"),
      ];
      const resolved: string[] = [];
      for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
          resolved.pop();
          continue;
        }
        resolved.push(part);
      }
      return resolved.join("/");
    },
  };

  it("splits scoped and unscoped package subpaths", () => {
    assertEquals(splitPackageSubpath("react"), {
      name: "react",
      subpath: ".",
    });
    assertEquals(splitPackageSubpath("react/jsx-runtime"), {
      name: "react",
      subpath: "./jsx-runtime",
    });
    assertEquals(splitPackageSubpath("@scope/pkg"), {
      name: "@scope/pkg",
      subpath: ".",
    });
    assertEquals(splitPackageSubpath("@scope/pkg/sub/path"), {
      name: "@scope/pkg",
      subpath: "./sub/path",
    });
  });

  it("resolves exact, conditional, array, and glob export entries", () => {
    const exportsMap = {
      ".": [{ import: "./esm.js" }, "./fallback.js"],
      "./jsx-runtime": { import: "./jsx-runtime.js" },
      "./*": "./*.js",
    };

    assertEquals(resolvePackageExportPath(exportsMap, "."), "./esm.js");
    assertEquals(resolvePackageExportPath(exportsMap, "./jsx-runtime"), "./jsx-runtime.js");
    assertEquals(resolvePackageExportPath(exportsMap, "./debounce"), "./debounce.js");
  });

  it("preserves node conditional preference and rejects unsupported conditions", () => {
    assertEquals(
      pickPackageExportEntry({ node: "./node.js", default: "./default.js" }),
      "./node.js",
    );
    assertEquals(pickPackageExportEntry({ browser: "./browser.js" }), null);
  });

  it("uses the longest matching glob export pattern", () => {
    const exportsMap = {
      "./*": "./root/*.js",
      "./features/*": "./features/*.mjs",
    };

    assertEquals(
      resolvePackageExportPath(exportsMap, "./features/router"),
      "./features/router.mjs",
    );
  });

  it("rejects package paths that escape the package directory", () => {
    assertEquals(
      resolveContainedPackagePath("/app/node_modules/pkg", "./index.js"),
      "/app/node_modules/pkg/index.js",
    );
    assertEquals(resolveContainedPackagePath("/app/node_modules/pkg", "../../secret.js"), null);
  });

  it("contains trailing separators but rejects sibling prefixes and parent escapes", () => {
    assertEquals(
      resolveContainedPackagePath("/app/node_modules/pkg/", "./index.js"),
      "/app/node_modules/pkg/index.js",
    );
    assertEquals(
      resolveContainedPackagePath("/app/node_modules/pkg", "../pkg-evil/index.js"),
      null,
    );
    assertEquals(
      resolveContainedPackagePath("/app/node_modules/pkg", "./sub/../../../secret.js"),
      null,
    );
  });

  it("contains Windows-like normalized child paths without allowing escapes", () => {
    assertEquals(
      resolveContainedPackagePath(
        "C:/app/node_modules/pkg",
        "./sub.js",
        windowsLikePathHelper,
      ),
      "C:/app/node_modules/pkg/sub.js",
    );
    assertEquals(
      resolveContainedPackagePath(
        "C:/app/node_modules/pkg",
        "../pkg-evil/index.js",
        windowsLikePathHelper,
      ),
      null,
    );
    assertEquals(
      resolveContainedPackagePath(
        "C:/app/node_modules/pkg",
        "./sub/../../../secret.js",
        windowsLikePathHelper,
      ),
      null,
    );
  });
});

describe("import rewrite core runner", () => {
  it("rejects configured literal CommonJS imports in browser transforms", async () => {
    await assertRejects(
      () =>
        rewriteWithImportRewriteCore({
          code: `const knex = require("knex");`,
          strategies: [],
          context: createRewriteContext({ serverExternalPackages: ["knex"] }),
        }),
      Error,
      "build.serverExternalPackages",
    );
  });

  it("does not mistake CommonJS-like text or local calls for package imports", async () => {
    const code = [
      `const message = 'require("knex")';`,
      `// require("knex")`,
      `function load(require: (name: string) => unknown) { return require("knex"); }`,
      `const packageName = "knex";`,
      `const dynamicValue = require(packageName);`,
    ].join("\n");

    assertEquals(
      await rewriteWithImportRewriteCore({
        code,
        strategies: [],
        context: createRewriteContext({ serverExternalPackages: ["knex"] }),
      }),
      code,
    );
  });

  it("preserves local require calls when the active parser lacks CommonJS analysis", async () => {
    await ensureDefaultParserContracts();
    const parser = tryResolve<CodeParser>("CodeParser");
    if (!parser) throw new Error("CodeParser test setup failed");

    const compatibilityParser: CodeParser = {
      parse: (options) => parser.parse(options),
      traverse: (ast, visitor) => {
        const original = visitor.CallExpression;
        parser.traverse(ast, {
          ...visitor,
          CallExpression(path) {
            const contractPath: NodePath = {
              node: path.node,
              parent: path.parent,
              replaceWith: (node) => path.replaceWith(node),
              remove: () => path.remove(),
            };
            if (typeof original === "function") original(contractPath);
            else {
              original?.enter?.(contractPath);
              original?.exit?.(contractPath);
            }
          },
        });
      },
      generate: (ast, options) => parser.generate(ast, options),
      hasFunctionDirective: parser.hasFunctionDirective
        ? (options) => parser.hasFunctionDirective!(options)
        : undefined,
      injectJsxNodePositions: (source, options) => parser.injectJsxNodePositions(source, options),
    };

    unregister("CodeParser");
    register("CodeParser", compatibilityParser);
    try {
      const code = `function load(require: (name: string) => unknown) { return require("knex"); }`;
      assertEquals(
        await rewriteWithImportRewriteCore({
          code,
          strategies: [],
          context: createRewriteContext({ serverExternalPackages: ["knex"] }),
        }),
        code,
      );
      assertEquals(tryResolve<CodeParser>("CodeParser"), compatibilityParser);
    } finally {
      unregister("CodeParser");
      register("CodeParser", parser);
    }
  });

  it("enforces configured server externals before caller-provided strategies", async () => {
    const strategies: ImportRewriteStrategy[] = [{
      name: "bypass-attempt",
      priority: 0,
      matches: () => true,
      rewrite: () => ({ specifier: "https://cdn.example/knex.js" }),
    }];
    const code = `import knex from "knex";`;

    await assertRejects(
      () =>
        rewriteWithImportRewriteCore({
          code,
          strategies,
          context: createRewriteContext({ serverExternalPackages: ["knex"] }),
        }),
      Error,
      "build.serverExternalPackages",
    );
    assertEquals(
      await rewriteWithImportRewriteCore({
        code,
        strategies,
        context: createRewriteContext({
          target: "ssr",
          serverExternalPackages: ["knex"],
        }),
      }),
      code,
    );
  });

  it("runs strategies in caller-provided order even when priority would sort differently", async () => {
    const strategies: ImportRewriteStrategy[] = [
      {
        name: "first-supplied-low-priority",
        priority: 10,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: "first" }),
      },
      {
        name: "second-supplied-high-priority",
        priority: 0,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: "second" }),
      },
    ];

    const out = await rewriteWithImportRewriteCore({
      code: `import x from "target";`,
      strategies,
      context: createRewriteContext(),
    });

    assertEquals(out, `import x from "first";`);
  });

  it("falls through when a matching strategy returns a null specifier", async () => {
    const strategies: ImportRewriteStrategy[] = [
      {
        name: "matching-noop",
        priority: 0,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: null }),
      },
      {
        name: "matching-rewrite",
        priority: 1,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: "rewritten" }),
      },
    ];

    const out = await rewriteWithImportRewriteCore({
      code: `import x from "target";`,
      strategies,
      context: createRewriteContext(),
    });

    assertEquals(out, `import x from "rewritten";`);
  });

  it("treats a statement rewrite as a handled result", async () => {
    const strategies: ImportRewriteStrategy[] = [
      {
        name: "statement",
        priority: 0,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: null, statement: `const x = "handled";` }),
      },
      {
        name: "later",
        priority: 1,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: "later" }),
      },
    ];

    const out = await rewriteWithImportRewriteCore({
      code: `import x from "target"`,
      strategies,
      context: createRewriteContext(),
    });

    assertEquals(out, `const x = "handled";`);
  });
});

describe("route import Adapter", () => {
  it("preserves route compiled Veryfront shim parity with the facade", () => {
    const code = `const a = import("veryfront/react/head");`;

    assertEquals(
      rewriteCompiledVeryfrontImportsForRoute(code),
      rewriteCompiledBinaryVeryfrontImports(code),
    );
    assertEquals(
      rewriteCompiledVeryfrontImportsForRoute(code),
      `const a = import("./_vf_react_head.mjs");`,
    );
  });

  it("preserves route Deno builtin parity with the facade", () => {
    const code = `const p = import("path");`;

    assertEquals(rewriteDenoNodeBuiltinsForRoute(code), rewriteDenoNodeBuiltinImports(code));
    assertEquals(rewriteDenoNodeBuiltinsForRoute(code), `const p = import("node:path");`);
  });

  it("preserves route regex scope for import-looking strings", () => {
    const code = `const source = 'import x from "veryfront/react/head"; import("path");';`;

    assertEquals(
      rewriteDenoNodeBuiltinsForRoute(rewriteCompiledVeryfrontImportsForRoute(code)),
      `const source = 'import x from "./_vf_react_head.mjs"; import("node:path");';`,
    );
  });

  it("preserves Deno npm installed-version fallback to the declared range", async () => {
    const fs = createFileSystem();
    const projectDir = await Deno.makeTempDir({ prefix: "vf-route-adapter-" });
    try {
      assertEquals(
        await rewriteDenoNpmDependencyImportsForRoute(
          `import merge from "lodash/merge";`,
          projectDir,
          fs,
          new Map([["lodash", "^4"]]),
        ),
        `import merge from "npm:lodash@^4/merge";`,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("SSR import Adapter", () => {
  it("preserves query order and ignores import-looking strings", () => {
    const code = [
      `import X from "@/x";`,
      `import Y from "./y.js";`,
      `const text = 'import Z from "@/z";';`,
    ].join("\n");
    assertEquals(
      rewriteSSRImportsCompat(code, {
        projectSlug: "p",
        branch: "b",
        cacheBuster: "v",
      }),
      [
        `import X from "/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v";`,
        `import Y from "./y.js?ssr=true&project=p&branch=b&v=v";`,
        `const text = 'import Z from "@/z";';`,
      ].join("\n"),
    );
  });
});
