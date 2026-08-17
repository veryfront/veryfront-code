import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NODE_BUILTINS } from "#veryfront/transforms/import-rewriter/node-builtins.ts";
import {
  rewriteMdxRootDependencyImports,
  rewriteProjectAliasImports,
  transformImports,
} from "./import-transformer.ts";

describe("rewriteProjectAliasImports", () => {
  it("rewrites @/ alias to /_vf_modules/ path", async () => {
    const code = `import { Foo } from "@/components/Foo";\n`;
    const result = await rewriteProjectAliasImports(code);
    assertEquals(result.includes("/_vf_modules/components/Foo.js"), true);
  });

  it("adds .js extension if missing", async () => {
    const code = `import { Foo } from "@/components/Foo";\n`;
    const result = await rewriteProjectAliasImports(code);
    assertEquals(result.includes(".js"), true);
  });

  it("does not double-add .js extension", async () => {
    const code = `import { Foo } from "@/components/Foo.js";\n`;
    const result = await rewriteProjectAliasImports(code);
    assertEquals(result.includes(".js.js"), false);
    assertEquals(result.includes("/_vf_modules/components/Foo.js"), true);
  });

  it("returns code unchanged when no @/ imports", async () => {
    const code = `import { useState } from "react";\n`;
    assertEquals(await rewriteProjectAliasImports(code), code);
  });

  it("handles deeply nested paths", async () => {
    const code = `import { x } from "@/lib/utils/helpers";\n`;
    const result = await rewriteProjectAliasImports(code);
    assertEquals(result.includes("/_vf_modules/lib/utils/helpers.js"), true);
  });

  it("rewrites multiple @/ imports", async () => {
    const code = [
      `import { A } from "@/a";`,
      `import { B } from "@/b";`,
    ].join("\n");
    const result = await rewriteProjectAliasImports(code);
    assertEquals(result.includes("/_vf_modules/a.js"), true);
    assertEquals(result.includes("/_vf_modules/b.js"), true);
  });

  it("rewrites dynamic @/ imports", async () => {
    const code = `const mod = await import("@/components/Foo");`;
    const result = await rewriteProjectAliasImports(code);
    assertEquals(result.includes(`import("/_vf_modules/components/Foo.js")`), true);
  });

  it("does not rewrite import-looking text inside strings", async () => {
    const code = `const text = 'from "@/components/Foo"';`;
    assertEquals(await rewriteProjectAliasImports(code), code);
  });
});

describe("transformImports", () => {
  it("applies import map to bare specifiers", () => {
    const code = `import { foo } from "my-lib";\n`;
    const result = transformImports(code, {
      imports: { "my-lib": "/mapped/my-lib.js" },
    });
    assertEquals(result.includes("/mapped/my-lib.js"), true);
  });

  it("strips react from import map", () => {
    const code = `import React from "react";\n`;
    const result = transformImports(code, {
      imports: { "react": "/mapped/react.js", "other": "/mapped/other.js" },
    });
    // React should NOT be rewritten
    assertEquals(result.includes("react"), true);
    assertEquals(result.includes("/mapped/react.js"), false);
  });

  it("returns code unchanged when import map has no matching entries", () => {
    const code = `import { foo } from "bar";\n`;
    const result = transformImports(code, { imports: {} });
    assertEquals(result.includes("bar"), true);
  });
});

describe("rewriteMdxRootDependencyImports", () => {
  const baseOptions = {
    projectDir: "/project",
    projectId: "project-id",
    reactVersion: "19.1.1",
    dependencyPinningCacheKey: "on:snapshot-a",
    dependencyPinningDependencies: {
      lodash: "4.17.21",
      zod: "4.0.5",
      react: "19.1.1",
    },
  } as const;

  it("pins static and dynamic root imports after explicit import-map rewrites", async () => {
    const result = await rewriteMdxRootDependencyImports(
      [
        `import mapped from "mapped";`,
        `import lodash from "lodash";`,
        `const schema = import("zod");`,
        `export { default as debounce } from "lodash/debounce";`,
      ].join("\n"),
      {
        imports: {
          mapped: "/mapped/module.js",
          lodash: "/mapped/lodash.js",
          "lodash/": "/mapped/lodash/",
        },
      },
      baseOptions,
    );

    assertEquals(result.includes(`from "/mapped/module.js"`), true);
    assertEquals(result.includes(`from "/mapped/lodash.js"`), true);
    assertEquals(result.includes(`import("https://esm.sh/zod@4.0.5`), true);
    assertEquals(result.includes(`from "/mapped/lodash/debounce"`), true);
  });

  it("keeps React on the existing path and observes unresolved dependencies", async () => {
    const observations: string[] = [];
    const result = await rewriteMdxRootDependencyImports(
      [
        `import React from "react";`,
        `import rangeDependency from "range-dependency";`,
        `const undeclaredDependency = import("undeclared-dependency");`,
      ].join("\n"),
      { imports: { react: "/user/react.js" } },
      {
        ...baseOptions,
        dependencyPinningDependencies: {
          ...baseOptions.dependencyPinningDependencies,
          "range-dependency": "^2.0.0",
        },
        onDependencyResolutionObserved: (observation) => {
          observations.push(observation.packageName);
        },
      },
    );

    assertEquals(result.includes("/user/react.js"), false);
    assertEquals(result.includes(`from "react"`), true);
    assertEquals(result.includes("https://esm.sh/range-dependency?"), true);
    assertEquals(result.includes("https://esm.sh/undeclared-dependency?"), true);
    assertEquals(observations.includes("range-dependency"), true);
    assertEquals(observations.includes("undeclared-dependency"), true);
  });

  it("keeps Node builtins unchanged while pinning npm dependencies", async () => {
    const code = [
      `import fs from "fs";`,
      `import path from "path";`,
      `import { readFile } from "fs/promises";`,
      `export { strict } from "assert/strict";`,
      `const crypto = import("node:crypto");`,
      `const pathPosix = import("node:path/posix");`,
      `import lodash from "lodash";`,
      `const importLookingText = 'import("fs")';`,
    ].join("\n");

    const result = await rewriteMdxRootDependencyImports(
      code,
      { imports: {} },
      baseOptions,
    );

    assertEquals(
      result,
      code.replace(
        `import lodash from "lodash";`,
        `import lodash from "https://esm.sh/lodash@4.17.21?external=react,react-dom&target=es2022";`,
      ),
    );
  });

  it("rejects configured server external packages with pinning on or off", async () => {
    const code = [
      `import knex from "knex";`,
      `import prisma from "@prisma/client";`,
      `const queryBuilder = import("knex/query");`,
    ].join("\n");

    for (const dependencyPinningCacheKey of ["on:snapshot-a", "off"]) {
      const error = await assertRejects(
        () =>
          rewriteMdxRootDependencyImports(
            code,
            { imports: {} },
            {
              ...baseOptions,
              dependencyPinningCacheKey,
              serverExternalPackages: ["knex", "@prisma/client"],
            },
          ),
        Error,
        "build.serverExternalPackages",
      );
      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).message.includes(baseOptions.projectDir), false);
      assertEquals(
        (error as VeryfrontError).message.includes("__veryfront_mdx_root__.mjs"),
        true,
      );
      assertEquals(
        (error as VeryfrontError).instance,
        "__veryfront_mdx_root__.mjs",
      );
    }
  });

  it("rejects configured CommonJS packages with pinning on or off", async () => {
    for (
      const code of [
        `const database = require("knex");`,
        `const database = require?.("knex");`,
        `const database = require.resolve("knex");`,
      ]
    ) {
      for (const dependencyPinningCacheKey of ["on:snapshot-a", "off"]) {
        await assertRejects(
          () =>
            rewriteMdxRootDependencyImports(
              code,
              { imports: {} },
              {
                ...baseOptions,
                dependencyPinningCacheKey,
                serverExternalPackages: ["knex"],
              },
            ),
          Error,
          "build.serverExternalPackages",
        );
      }
    }
  });

  it("rejects import-map aliases that resolve to configured server externals", async () => {
    const cases = [
      [`import database from "db";`, { db: "knex" }, ["knex"]],
      [`const database = import("db");`, { db: "knex" }, ["knex"]],
      [
        `import database from "db";`,
        { db: "npm:@prisma/client/runtime/library" },
        ["@prisma/client"],
      ],
      [`import query from "db/query";`, { "db/": "knex/" }, ["knex"]],
      [
        `import database from "db";`,
        { db: "https://esm.sh/knex@3.1.0" },
        ["knex"],
      ],
    ] as const;

    for (const [code, imports, serverExternalPackages] of cases) {
      for (const dependencyPinningCacheKey of ["on:snapshot-a", "off"]) {
        await assertRejects(
          () =>
            rewriteMdxRootDependencyImports(
              code,
              { imports },
              {
                ...baseOptions,
                dependencyPinningCacheKey,
                serverExternalPackages,
              },
            ),
          Error,
          "build.serverExternalPackages",
        );
      }
    }
  });

  it("keeps every supported bare Node builtin and its node: form unchanged", async () => {
    const code = NODE_BUILTINS.flatMap((specifier) => [
      `import "${specifier}";`,
      `import("node:${specifier}");`,
    ]).join("\n");

    const result = await rewriteMdxRootDependencyImports(
      code,
      { imports: {} },
      baseOptions,
    );

    assertEquals(result, code);
  });

  it("rewrites bare packages that only exist as node:-prefixed builtins", async () => {
    const result = await rewriteMdxRootDependencyImports(
      [
        `import testPackage from "test";`,
        `import sqlitePackage from "sqlite";`,
        `import denoAliasPackage from "traceEvents";`,
        `import "node:test";`,
        `import "node:sqlite";`,
        `import "node:sea";`,
      ].join("\n"),
      { imports: {} },
      baseOptions,
    );

    assertEquals(result.includes("https://esm.sh/test?"), true);
    assertEquals(result.includes("https://esm.sh/sqlite?"), true);
    assertEquals(result.includes("https://esm.sh/traceEvents?"), true);
    assertEquals(result.includes(`import "node:test"`), true);
    assertEquals(result.includes(`import "node:sqlite"`), true);
    assertEquals(result.includes(`import "node:sea"`), true);
  });

  it("leaves non-npm URL and runtime schemes unchanged", async () => {
    const code = [
      `import "jsr:@std/path";`,
      `import "data:text/javascript,export default 1";`,
      `import "blob:https://example.test/id";`,
      `import "bun:test";`,
      `import "file:///project/module.js";`,
      `import "custom:module";`,
    ].join("\n");
    const result = await rewriteMdxRootDependencyImports(
      `${code}\nimport "npm:zod@4.0.5";`,
      { imports: {} },
      baseOptions,
    );

    assertEquals(result.includes(code), true);
    assertEquals(result.includes("https://esm.sh/zod@4.0.5"), true);
  });

  it("preserves the exact flag-off result", async () => {
    const code = [
      `import fs from "fs";`,
      `const path = import("node:path");`,
      `import lodash from "lodash";`,
      `const importLookingText = 'import("fs")';`,
    ].join("\n");
    const result = await rewriteMdxRootDependencyImports(
      code,
      { imports: {} },
      {
        ...baseOptions,
        dependencyPinningCacheKey: "off",
      },
    );

    assertEquals(result.includes("https://esm.sh/lodash@4.17.21"), false);
    assertEquals(result, code);
  });
});
