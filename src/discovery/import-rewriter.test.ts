import "#veryfront/schemas/_test-setup.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteDiscoveryImports, rewriteForDeno } from "./import-rewriter.ts";

describe("discovery/import-rewriter", () => {
  it("rewrites veryfront public imports for Deno temp module imports", async () => {
    const transformed = await rewriteForDeno(
      [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { projectKnowledge } from "veryfront/knowledge";',
        'import { step, workflow } from "veryfront/workflow";',
        'import { evalAgent } from "veryfront/eval";',
        'import { executeRemoteIntegrationTool } from "veryfront/integrations";',
      ].join("\n"),
      "/project/workflows",
    );

    assertStringIncludes(transformed, import.meta.resolve("veryfront/schemas"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/tool"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/knowledge"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/workflow"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/eval"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/integrations"));
    assertEquals(transformed.includes('from "veryfront/'), false);
  });

  it("propagates veryfront resolution failures instead of leaving broken imports", async () => {
    await assertRejects(
      () =>
        rewriteForDeno('import { tool } from "veryfront/tool";', "/project/tools", {
          resolveSpecifier: () => {
            throw new Error("resolution unavailable");
          },
        }),
      Error,
      "resolution unavailable",
    );
  });

  it("rewrites supported veryfront public imports to globals in compiled Deno binaries", async () => {
    const transformed = await rewriteForDeno(
      [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { projectKnowledge } from "veryfront/knowledge";',
        'import { step, workflow } from "veryfront/workflow";',
        'import { evalAgent } from "veryfront/eval";',
        'import { executeRemoteIntegrationTool } from "veryfront/integrations";',
      ].join("\n"),
      "/project/workflows",
      { compiled: true },
    );

    assertStringIncludes(
      transformed,
      'const { defineSchema } = globalThis.__VERYFRONT_MODULES__["veryfront/schemas"]',
    );
    assertStringIncludes(
      transformed,
      'const { tool } = globalThis.__VERYFRONT_MODULES__["veryfront/tool"]',
    );
    assertStringIncludes(
      transformed,
      'const { projectKnowledge } = globalThis.__VERYFRONT_MODULES__["veryfront/knowledge"]',
    );
    assertStringIncludes(
      transformed,
      'const { step, workflow } = globalThis.__VERYFRONT_MODULES__["veryfront/workflow"]',
    );
    assertStringIncludes(
      transformed,
      'const { evalAgent } = globalThis.__VERYFRONT_MODULES__["veryfront/eval"]',
    );
    assertStringIncludes(
      transformed,
      'const { executeRemoteIntegrationTool } = globalThis.__VERYFRONT_MODULES__["veryfront/integrations"]',
    );
    assertEquals(transformed.includes('from "veryfront/'), false);
  });

  it("rewrites the chat uploads route handler import in compiled Deno binaries", async () => {
    // app/api/uploads/route.ts mounts the framework handler; it must resolve
    // from the bundled module registry, not as an unresolvable bare specifier.
    const transformed = await rewriteForDeno(
      'import { createChatUploadHandler } from "veryfront/chat/uploads";',
      "/project/app/api/uploads",
      { compiled: true },
    );

    assertStringIncludes(
      transformed,
      'const { createChatUploadHandler } = globalThis.__VERYFRONT_MODULES__["veryfront/chat/uploads"]',
    );
    assertEquals(transformed.includes('from "veryfront/'), false);
  });

  it("rewrites compiled default, dynamic, side-effect, and named re-export imports", async () => {
    const transformed = await rewriteForDeno(
      [
        'import toolModule from "veryfront/tool";',
        'import "veryfront/tool";',
        'const lazy = import("veryfront/tool");',
        'export { tool as makeTool } from "veryfront/tool";',
      ].join("\n"),
      "/project/tools",
      { compiled: true },
    );

    assertStringIncludes(
      transformed,
      'const toolModule = globalThis.__VERYFRONT_MODULES__["veryfront/tool"].default',
    );
    assertStringIncludes(
      transformed,
      'Promise.resolve(globalThis.__VERYFRONT_MODULES__["veryfront/tool"])',
    );
    assertStringIncludes(transformed, "export { __vf_reexport_");
    assertEquals(transformed.includes('"veryfront/tool";'), false);
  });

  it("rewrites provider-safe namespace identifiers containing dollar signs", async () => {
    const transformed = await rewriteForDeno(
      'import * as $tools from "veryfront/tool";',
      "/project/tools",
      { compiled: true },
    );

    assertStringIncludes(
      transformed,
      'const $tools = globalThis.__VERYFRONT_MODULES__["veryfront/tool"]',
    );
    assertEquals(transformed.includes("import * as $tools"), false);
  });

  it("ignores import-looking text in comments and strings", async () => {
    const transformed = await rewriteForDeno(
      [
        "const source = 'import { tool } from \"veryfront/tool\";';",
        '// import { tool } from "veryfront/tool";',
        'import { tool } from "veryfront/tool";',
      ].join("\n"),
      "/project/tools",
      { compiled: true },
    );

    assertStringIncludes(
      transformed,
      "const source = 'import { tool } from \"veryfront/tool\";';",
    );
    assertStringIncludes(transformed, '// import { tool } from "veryfront/tool";');
    assertStringIncludes(
      transformed,
      'const { tool } = globalThis.__VERYFRONT_MODULES__["veryfront/tool"]',
    );
  });

  it("uses unique collision-free bindings for compiled named re-exports", async () => {
    const transformed = await rewriteForDeno(
      [
        'const __vf_reexport_0 = "reserved";',
        'export { tool as makeTool } from "veryfront/tool";',
        'export { workflow as makeWorkflow } from "veryfront/workflow";',
      ].join("\n"),
      "/project/tools",
      { compiled: true },
    );

    assertStringIncludes(transformed, 'const __vf_reexport_0 = "reserved";');
    assertStringIncludes(transformed, "export { __vf_reexport_1 as makeWorkflow }");
    assertStringIncludes(transformed, "export { __vf_reexport_2 as makeTool }");
  });

  it("rejects wildcard veryfront re-exports in compiled discovery modules", async () => {
    await assertRejects(
      () =>
        rewriteForDeno('export * from "veryfront/tool";', "/project/tools", {
          compiled: true,
        }),
      TypeError,
      "Wildcard re-exports",
    );
  });

  it("rejects veryfront modules that are not embedded in compiled discovery", async () => {
    await assertRejects(
      () =>
        rewriteForDeno('import { createRunsClient } from "veryfront/runs";', "/project/tools", {
          compiled: true,
        }),
      TypeError,
      "not embedded",
    );

    await assertRejects(
      () =>
        rewriteForDeno('import { tool } from "veryfront";', "/project/tools", {
          compiled: true,
        }),
      TypeError,
      "explicit supported subpath",
    );
  });

  it("prefixes arbitrary bare npm imports with npm: for Deno temp module imports", async () => {
    const transformed = await rewriteForDeno(
      [
        'import pdfParse from "pdf-parse";',
        'import mammoth from "mammoth";',
        'const pdf = await import("pdf-parse");',
        'import { z } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'from "npm:pdf-parse"');
    assertStringIncludes(transformed, 'from "npm:mammoth"');
    assertStringIncludes(transformed, 'import("npm:pdf-parse")');
    assertStringIncludes(transformed, 'from "npm:zod"');
    assertEquals(transformed.includes('from "pdf-parse"'), false);
    assertEquals(transformed.includes('from "mammoth"'), false);
  });

  it("prefixes bare side-effect imports for Deno temp module imports", async () => {
    const transformed = await rewriteForDeno(
      [
        'import "reflect-metadata";',
        'import "dotenv/config";',
        'import { z } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'import "npm:reflect-metadata"');
    assertStringIncludes(transformed, 'import "npm:dotenv/config"');
    assertStringIncludes(transformed, 'from "npm:zod"');
  });

  it("bounds Deno discovery import processing", async () => {
    const code = Array.from(
      { length: 2_001 },
      (_, index) => `import "package-${index}";`,
    ).join("\n");

    await assertRejects(
      () => rewriteForDeno(code, "/project/tools"),
      RangeError,
      "import count",
    );
  });

  it("leaves node: and relative side-effect imports untouched", async () => {
    const transformed = await rewriteForDeno(
      [
        'import "node:crypto";',
        'import "./side-effects.ts";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'import "node:crypto"');
    assertStringIncludes(transformed, 'import "./side-effects.ts"');
  });

  it("rewrites `export ... from` re-exports of bare npm packages for Deno", async () => {
    const transformed = await rewriteForDeno(
      [
        'export { z } from "zod";',
        'export * from "pdf-parse";',
        'export { type ZodSchema } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'export { z } from "npm:zod"');
    assertStringIncludes(transformed, 'export * from "npm:pdf-parse"');
    assertEquals(transformed.includes('from "zod";'), false);
    assertEquals(transformed.includes('from "pdf-parse";'), false);
  });

  it("does not rewrite `import type` / `export type` lines for Deno", async () => {
    const transformed = await rewriteForDeno(
      [
        'import type { ZodSchema } from "zod";',
        'export type { ZodSchema } from "zod";',
        'import { z, type ZodTypeAny } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    // type-only lines are erased by TS; they must not gain an npm: prefix
    assertStringIncludes(transformed, 'import type { ZodSchema } from "zod"');
    assertStringIncludes(transformed, 'export type { ZodSchema } from "zod"');
    // The value-bearing `import { z, type ZodTypeAny }` is still rewritten
    assertStringIncludes(transformed, 'import { z, type ZodTypeAny } from "npm:zod"');
  });

  it("leaves runtime schemes, package-import aliases, and relative specifiers untouched", async () => {
    const transformed = await rewriteForDeno(
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        'import local from "./helpers.ts";',
        'import remote from "https://esm.sh/some-pkg";',
        'import inline from "data:text/javascript,export default 1";',
        'import alias from "#project/runtime";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'from "node:fs"');
    assertStringIncludes(transformed, 'from "node:path"');
    assertStringIncludes(transformed, 'from "./helpers.ts"');
    assertStringIncludes(transformed, 'from "https://esm.sh/some-pkg"');
    assertStringIncludes(transformed, 'from "data:text/javascript,export default 1"');
    assertStringIncludes(transformed, 'from "#project/runtime"');
    assertEquals(transformed.includes("npm:data:"), false);
    assertEquals(transformed.includes("npm:#project"), false);
  });

  it("resolves bare-package subpath imports via package.json#exports in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const reactDir = `${projectDir}/node_modules/react`;
    await Deno.mkdir(reactDir, { recursive: true });
    await Deno.writeTextFile(
      `${reactDir}/package.json`,
      JSON.stringify({
        name: "react",
        version: "19.0.0",
        exports: {
          ".": "./index.js",
          "./jsx-runtime": "./jsx-runtime.js",
        },
      }),
    );
    await Deno.writeTextFile(`${reactDir}/index.js`, "");
    await Deno.writeTextFile(`${reactDir}/jsx-runtime.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          "const example = 'import React from \"react\";';",
          '// import React from "react";',
          'import { jsx } from "react/jsx-runtime";',
          'import React from "react";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, "react/jsx-runtime.js");
      assertStringIncludes(transformed, "react/index.js");
      assertStringIncludes(transformed, "const example = 'import React from \"react\";';");
      assertStringIncludes(transformed, '// import React from "react";');
      assertEquals(transformed.includes('from "react/jsx-runtime"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("starts Node package resolution from the importing module directory", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-nested-package-" });
    const fileDir = `${projectDir}/packages/worker/src`;
    const packageDir = `${projectDir}/packages/worker/node_modules/local-only`;
    await Deno.mkdir(fileDir, { recursive: true });
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: "local-only", exports: "./index.js" }),
    );
    await Deno.writeTextFile(`${packageDir}/index.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        'import value from "local-only";',
        projectDir,
        createFileSystem(),
        fileDir,
      );

      assertStringIncludes(transformed, "packages/worker/node_modules/local-only/index.js");
      assertEquals(transformed.includes('from "local-only"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("resolves legacy package main and subpath entries with Node extension rules", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-legacy-package-" });
    const packageDir = `${projectDir}/node_modules/legacy-package`;
    await Deno.mkdir(`${packageDir}/features/example`, { recursive: true });
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: "legacy-package", main: "./entry" }),
    );
    await Deno.writeTextFile(`${packageDir}/entry.js`, "");
    await Deno.writeTextFile(`${packageDir}/features/example/index.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import root from "legacy-package";',
          'import feature from "legacy-package/features/example";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/tools`,
      );

      assertStringIncludes(transformed, "legacy-package/entry.js");
      assertStringIncludes(transformed, "legacy-package/features/example/index.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("resolves root string and conditional package exports", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-root-exports-" });
    const stringDir = `${projectDir}/node_modules/string-exports`;
    const conditionalDir = `${projectDir}/node_modules/conditional-exports`;
    await Deno.mkdir(stringDir, { recursive: true });
    await Deno.mkdir(conditionalDir, { recursive: true });
    await Deno.writeTextFile(
      `${stringDir}/package.json`,
      JSON.stringify({ name: "string-exports", exports: "./entry.js" }),
    );
    await Deno.writeTextFile(`${stringDir}/entry.js`, "");
    await Deno.writeTextFile(
      `${conditionalDir}/package.json`,
      JSON.stringify({
        name: "conditional-exports",
        exports: { import: "./import.js", default: "./default.js" },
      }),
    );
    await Deno.writeTextFile(`${conditionalDir}/import.js`, "");
    await Deno.writeTextFile(`${conditionalDir}/default.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import first from "string-exports";',
          'import second from "conditional-exports";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, "string-exports/entry.js");
      assertStringIncludes(transformed, "conditional-exports/import.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not bypass a package exports map for an unexported subpath", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-private-export-" });
    const packageDir = `${projectDir}/node_modules/encapsulated`;
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: "encapsulated", exports: { ".": "./index.js" } }),
    );
    await Deno.writeTextFile(`${packageDir}/index.js`, "");
    await Deno.writeTextFile(`${packageDir}/private.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        'import secret from "encapsulated/private.js";',
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, 'from "encapsulated/private.js"');
      assertEquals(transformed.includes("file://"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("propagates malformed installed package metadata", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-malformed-package-" });
    const packageDir = `${projectDir}/node_modules/broken-package`;
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(`${packageDir}/package.json`, "{not-json");

    try {
      await assertRejects(() =>
        rewriteDiscoveryImports(
          'import value from "broken-package";',
          projectDir,
          createFileSystem(),
          `${projectDir}/app`,
        )
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects oversized package metadata before reading its contents", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-large-package-" });
    const packageDir = `${projectDir}/node_modules/oversized-package`;
    await Deno.mkdir(packageDir, { recursive: true });
    const packageJsonPath = `${packageDir}/package.json`;
    await Deno.writeTextFile(packageJsonPath, " ".repeat(1 * 1_024 * 1_024 + 1));
    const underlying = createFileSystem();
    let packageMetadataReads = 0;
    const monitored = new Proxy(underlying, {
      get(target, property, receiver) {
        if (property === "readTextFile") {
          return async (path: string) => {
            if (path === packageJsonPath) packageMetadataReads++;
            return await target.readTextFile(path);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    try {
      await assertRejects(
        () =>
          rewriteDiscoveryImports(
            'import value from "oversized-package";',
            projectDir,
            monitored,
            `${projectDir}/app`,
          ),
        RangeError,
        "metadata exceeds",
      );
      assertEquals(packageMetadataReads, 0);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("bounds nested conditional package export traversal", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-deep-exports-" });
    const packageDir = `${projectDir}/node_modules/deep-exports`;
    await Deno.mkdir(packageDir, { recursive: true });
    let packageExport: unknown = "./index.js";
    for (let depth = 0; depth < 80; depth++) {
      packageExport = { import: packageExport };
    }
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: "deep-exports", exports: packageExport }),
    );
    await Deno.writeTextFile(`${packageDir}/index.js`, "");

    try {
      await assertRejects(
        () =>
          rewriteDiscoveryImports(
            'import value from "deep-exports";',
            projectDir,
            createFileSystem(),
            `${projectDir}/app`,
          ),
        RangeError,
        "export traversal",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("bounds concurrent package filesystem resolution", async () => {
    const underlying = createFileSystem();
    let active = 0;
    let maxActive = 0;
    const monitored = new Proxy(underlying, {
      get(target, property, receiver) {
        if (property === "exists") {
          return async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
            active--;
            return false;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const code = Array.from(
      { length: 100 },
      (_, index) => `import value${index} from "missing-package-${index}";`,
    ).join("\n");

    await rewriteDiscoveryImports(code, "/project", monitored, "/project/app");

    assertEquals(maxActive <= 32, true);
  });

  it("resolves side-effect imports via the project's node_modules in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const dotenvDir = `${projectDir}/node_modules/dotenv`;
    await Deno.mkdir(dotenvDir, { recursive: true });
    await Deno.writeTextFile(
      `${dotenvDir}/package.json`,
      JSON.stringify({
        name: "dotenv",
        version: "16.0.0",
        exports: {
          ".": "./lib/main.js",
          "./config": "./config.js",
        },
      }),
    );
    await Deno.writeTextFile(`${dotenvDir}/config.js`, "");
    await Deno.mkdir(`${dotenvDir}/lib`, { recursive: true });
    await Deno.writeTextFile(`${dotenvDir}/lib/main.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import "dotenv/config";',
          'import { config } from "dotenv";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, 'import "file://');
      assertStringIncludes(transformed, "dotenv/config.js");
      assertStringIncludes(transformed, "dotenv/lib/main.js");
      assertEquals(transformed.includes('import "dotenv/config"'), false);
      assertEquals(transformed.includes('from "dotenv"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rewrites `export ... from` re-exports of bare npm packages in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const zodDir = `${projectDir}/node_modules/zod`;
    await Deno.mkdir(zodDir, { recursive: true });
    await Deno.writeTextFile(
      `${zodDir}/package.json`,
      JSON.stringify({ name: "zod", version: "3.24.0", main: "./index.js" }),
    );
    await Deno.writeTextFile(`${zodDir}/index.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'export { z } from "zod";',
          'export * from "zod";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, "zod/index.js");
      assertEquals(transformed.includes('export { z } from "zod"'), false);
      assertEquals(transformed.includes('export * from "zod"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not resolve `import type` lines in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    // Intentionally no node_modules, because a real resolution would fail.
    // The rewriter must not even try, because `import type` is erased.

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import type { Foo } from "some-pkg-not-installed";',
          'export type { Bar } from "another-missing-pkg";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, 'import type { Foo } from "some-pkg-not-installed"');
      assertStringIncludes(transformed, 'export type { Bar } from "another-missing-pkg"');
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("resolves bare-package subpath imports via package.json#exports glob patterns (lodash-es style)", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const pkgDir = `${projectDir}/node_modules/lodash-es`;
    await Deno.mkdir(pkgDir, { recursive: true });
    await Deno.writeTextFile(
      `${pkgDir}/package.json`,
      JSON.stringify({
        name: "lodash-es",
        version: "4.17.21",
        type: "module",
        exports: {
          ".": "./lodash.js",
          "./*": "./*.js",
        },
      }),
    );
    await Deno.writeTextFile(`${pkgDir}/lodash.js`, "");
    await Deno.writeTextFile(`${pkgDir}/debounce.js`, "");
    await Deno.writeTextFile(`${pkgDir}/throttle.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import debounce from "lodash-es/debounce";',
          'import throttle from "lodash-es/throttle";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      // Glob pattern `./*` → `./*.js` must produce `debounce.js`, not bare `debounce`
      assertStringIncludes(transformed, "lodash-es/debounce.js");
      assertStringIncludes(transformed, "lodash-es/throttle.js");
      assertEquals(transformed.includes('"lodash-es/debounce"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not cache missing-package lookups, so a later install is picked up without restart", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const pkgDir = `${projectDir}/node_modules/late-installed`;
    const code = 'import x from "late-installed";';

    try {
      // First pass: package not present yet → should leave bare import alone.
      const before = await rewriteDiscoveryImports(
        code,
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(before, 'from "late-installed"');
      assert(!before.includes("file://"));

      // Simulate `npm install` between passes.
      await Deno.mkdir(pkgDir, { recursive: true });
      await Deno.writeTextFile(
        `${pkgDir}/package.json`,
        JSON.stringify({ name: "late-installed", main: "./index.js" }),
      );
      await Deno.writeTextFile(`${pkgDir}/index.js`, "");

      // Second pass must now resolve. Null lookups are intentionally
      // NOT cached so dev servers recover after `npm install` without a
      // process restart.
      const after = await rewriteDiscoveryImports(
        code,
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(after, "late-installed/index.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("refuses to resolve a package whose exports map escapes the package directory", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const pkgDir = `${projectDir}/node_modules/evil`;
    const outside = `${projectDir}/SECRET.js`;
    await Deno.mkdir(pkgDir, { recursive: true });
    // The malicious exports value attempts to point the bare import at
    // `<projectDir>/SECRET.js`, which sits outside `node_modules/evil`.
    await Deno.writeTextFile(
      `${pkgDir}/package.json`,
      JSON.stringify({
        name: "evil",
        version: "1.0.0",
        exports: { ".": "../../SECRET.js" },
      }),
    );
    await Deno.writeTextFile(outside, 'throw new Error("you should never load me");');

    try {
      const transformed = await rewriteDiscoveryImports(
        'import x from "evil";',
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      // The rewriter must refuse the resolution. The import must be left
      // bare (or otherwise NOT point at the file outside the package dir).
      assertEquals(transformed.includes("SECRET.js"), false);
      assertStringIncludes(transformed, 'from "evil"');
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("refuses package export symlinks that escape the package directory", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-symlink-export-" });
    const packageDir = `${projectDir}/node_modules/linked-package`;
    const outsideFile = `${projectDir}/outside.js`;
    await Deno.mkdir(packageDir, { recursive: true });
    await Deno.writeTextFile(outsideFile, "export default 'outside';");
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: "linked-package", exports: "./entry.js" }),
    );
    await Deno.symlink(outsideFile, `${packageDir}/entry.js`);

    try {
      const transformed = await rewriteDiscoveryImports(
        'import linked from "linked-package";',
        projectDir,
        createFileSystem(),
        `${projectDir}/tools`,
      );

      assertEquals(transformed, 'import linked from "linked-package";');
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("resolves veryfront public imports for Node discovery modules without project-local dependencies", async () => {
    const transformed = await rewriteDiscoveryImports(
      [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { step, workflow } from "veryfront/workflow";',
      ].join("\n"),
      "/tmp/veryfront-project-without-node-modules",
      createFileSystem(),
      "/tmp/veryfront-project-without-node-modules/workflows",
    );

    assertStringIncludes(transformed, import.meta.resolve("veryfront/schemas"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/tool"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/workflow"));
    assertEquals(transformed.includes('from "veryfront/'), false);
  });
});
