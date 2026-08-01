import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  findCoreThirdPartyImports,
  findCoreThirdPartySourceImports,
  findRootNpmSpecifierLiterals,
  readCoreDependencyConfigs,
  readCoreSourceFiles,
} from "./audit-core-deps.ts";

describe("findCoreThirdPartyImports", () => {
  it("flags npm and remote imports without a built-in React allowlist", () => {
    const issues = findCoreThirdPartyImports(
      {
        imports: {
          "#veryfront/foo": "./src/foo.ts",
          "@std/path": "jsr:@std/path",
          "bash-tool": "npm:bash-tool@1.3.16",
          "react": "https://esm.sh/react@19.2.4",
        },
      },
    );

    assertEquals(issues, [
      { specifier: "bash-tool", target: "npm:bash-tool@1.3.16" },
      { specifier: "react", target: "https://esm.sh/react@19.2.4" },
    ]);
  });

  it("ignores local imports and std imports", () => {
    const issues = findCoreThirdPartyImports({
      imports: {
        "#veryfront/foo": "./src/foo.ts",
        "veryfront/foo": "./src/foo.ts",
        "@std/path": "jsr:@std/path",
        "#std/path": "jsr:@std/path",
      },
    });

    assertEquals(issues, []);
  });

  it("flags schema and content implementation packages in the core import map", () => {
    const issues = findCoreThirdPartyImports({
      imports: {
        "@mdx-js/mdx": "npm:@mdx-js/mdx@3.1.1",
        "gray-matter": "npm:gray-matter@4.0.3",
        "unified": "npm:unified@11.0.5",
        "zod": "npm:zod@4.3.6",
      },
    });

    assertEquals(issues, [
      { specifier: "@mdx-js/mdx", target: "npm:@mdx-js/mdx@3.1.1" },
      { specifier: "gray-matter", target: "npm:gray-matter@4.0.3" },
      { specifier: "unified", target: "npm:unified@11.0.5" },
      { specifier: "zod", target: "npm:zod@4.3.6" },
    ]);
  });

  it("fails closed for every non-core import-map target scheme", () => {
    const issues = findCoreThirdPartyImports({
      imports: {
        "evil-jsr": "jsr:@evil/pkg@1",
        "evil-http": "http://evil.test/mod.ts",
        "evil-upper-http": "HTTP://evil.test/mod.ts",
        "evil-data": "data:text/javascript,export default 1",
      },
    });

    assertEquals(issues, [
      { specifier: "evil-jsr", target: "jsr:@evil/pkg@1" },
      { specifier: "evil-http", target: "http://evil.test/mod.ts" },
      { specifier: "evil-upper-http", target: "HTTP://evil.test/mod.ts" },
      {
        specifier: "evil-data",
        target: "data:text/javascript,export default 1",
      },
    ]);
  });
});

describe("findRootNpmSpecifierLiterals", () => {
  it("flags npm specifier literals anywhere in root deno.json", () => {
    const issues = findRootNpmSpecifierLiterals({
      imports: {
        zod: "npm:zod@4.3.6",
      },
      compilerOptions: {
        types: ["npm:@types/react@19.2.14"],
      },
      allowScripts: {
        allow: ["npm:sharp@0.33.5"],
        deny: ["npm:protobufjs@7.5.4"],
      },
    });

    assertEquals(issues, [
      { path: "imports.zod", value: "npm:zod@4.3.6" },
      {
        path: "compilerOptions.types[0]",
        value: "npm:@types/react@19.2.14",
      },
      { path: "allowScripts.allow[0]", value: "npm:sharp@0.33.5" },
      { path: "allowScripts.deny[0]", value: "npm:protobufjs@7.5.4" },
    ]);
  });

  it("ignores jsr, local, remote, and non-specifier strings", () => {
    const issues = findRootNpmSpecifierLiterals({
      imports: {
        "#std/path": "jsr:@std/path",
        react: "https://esm.sh/react@19.2.4",
        local: "./src/local.ts",
      },
      tasks: {
        build: "deno task build:npm",
      },
    });

    assertEquals(issues, []);
  });

  it("allows Deno minimum dependency age excludes", () => {
    const issues = findRootNpmSpecifierLiterals({
      minimumDependencyAge: {
        age: "P2D",
        exclude: ["npm:esbuild", "npm:@esbuild/linux-x64"],
      },
    });

    assertEquals(issues, []);
  });
});

describe("findCoreThirdPartySourceImports", () => {
  it("flags direct third-party source imports that bypass the core import map", () => {
    const issues = findCoreThirdPartySourceImports(
      [
        {
          path: "src/agent/runtime/provider.ts",
          content: 'import { streamText } from "@ai-sdk/provider";\n',
        },
        {
          path: "cli/main.ts",
          content: 'const z = await import("npm:zod@4.3.6");\n',
        },
        {
          path: "src/tool/index.ts",
          content:
            'export { compile } from "https://esm.sh/@mdx-js/mdx@3.1.1";\n',
        },
      ],
      { allowedSpecifiers: new Set(["react"]) },
    );

    assertEquals(issues, [
      {
        path: "src/agent/runtime/provider.ts",
        line: 1,
        specifier: "@ai-sdk/provider",
      },
      {
        path: "cli/main.ts",
        line: 1,
        specifier: "npm:zod@4.3.6",
      },
      {
        path: "src/tool/index.ts",
        line: 1,
        specifier: "https://esm.sh/@mdx-js/mdx@3.1.1",
      },
    ]);
  });

  it("ignores local, internal, first-party, std, test, template, and allowlisted imports", () => {
    const issues = findCoreThirdPartySourceImports(
      [
        {
          path: "src/react/component.tsx",
          content: [
            'import React from "react";',
            'import { hydrateRoot } from "react-dom/client";',
            'import { join } from "#veryfront/platform/path";',
            'import { defineConfig } from "veryfront/config";',
            'import extSchema from "@veryfront/ext-schema-zod";',
            'import { assertEquals } from "#std/assert";',
            'import local from "./local.ts";',
          ].join("\n"),
        },
        {
          path: "src/tool/factory.test.ts",
          content: 'import { z } from "zod";',
        },
        {
          path: "src/tool/__tests__/extension-setup.ts",
          content:
            'import extension from "../../../extensions/ext-example/src/index.ts";',
        },
        {
          path: "cli/templates/files/app/tool.ts",
          content: 'import { z } from "zod";',
        },
      ],
      {
        importMap: {
          "#veryfront/": "./src/",
          "#std/": "jsr:@std/",
          react: "./react/react.ts",
          "react-dom/client": "./react/react-dom-client.ts",
        },
      },
    );

    assertEquals(issues, []);
  });

  it("flags relative imports that bypass first-party extension package boundaries", () => {
    const issues = findCoreThirdPartySourceImports([
      {
        path: "src/extensions/builtin-schema-validator.ts",
        content:
          'import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";\n',
      },
      {
        path: "src/provider/adapter.ts",
        content:
          'import provider from "../../extensions/ext-llm-openai/src/index.ts";\n',
      },
      {
        path: "src/extensions/valid.ts",
        content: 'import extSchema from "@veryfront/ext-schema-zod";\n',
      },
    ]);

    assertEquals(issues, [
      {
        path: "src/extensions/builtin-schema-validator.ts",
        line: 1,
        specifier: "../../extensions/ext-schema-zod/src/adapter.ts",
      },
      {
        path: "src/provider/adapter.ts",
        line: 1,
        specifier: "../../extensions/ext-llm-openai/src/index.ts",
      },
    ]);
  });

  it("handles multiline imports and reports the import start line", () => {
    const issues = findCoreThirdPartySourceImports([
      {
        path: "src/config/example.ts",
        content: [
          "import {",
          "  z,",
          '} from "zod";',
          "export {",
          "  compile,",
          '} from "@mdx-js/mdx";',
        ].join("\n"),
      },
    ]);

    assertEquals(issues, [
      { path: "src/config/example.ts", line: 1, specifier: "zod" },
      { path: "src/config/example.ts", line: 4, specifier: "@mdx-js/mdx" },
    ]);
  });

  it("rejects aliases mapped to non-core schemes", () => {
    const issues = findCoreThirdPartySourceImports(
      [{
        path: "src/config/example.ts",
        content: [
          'import "evil-jsr";',
          'import "evil-http";',
          'import "evil-upper-http";',
          'import "evil-data";',
        ].join("\n"),
      }],
      {
        importMap: {
          "evil-jsr": "jsr:@evil/pkg@1",
          "evil-http": "http://evil.test/mod.ts",
          "evil-upper-http": "HTTP://evil.test/mod.ts",
          "evil-data": "data:text/javascript,export default 1",
        },
      },
    );

    assertEquals(issues, [
      { path: "src/config/example.ts", line: 1, specifier: "evil-jsr" },
      { path: "src/config/example.ts", line: 2, specifier: "evil-http" },
      {
        path: "src/config/example.ts",
        line: 3,
        specifier: "evil-upper-http",
      },
      { path: "src/config/example.ts", line: 4, specifier: "evil-data" },
    ]);
  });

  it("rejects unresolved internal aliases instead of trusting their spelling", () => {
    const issues = findCoreThirdPartySourceImports(
      [{
        path: "cli/example.ts",
        content: 'import "#evil";\nimport "#missing";\n',
      }],
      { importMap: { "#evil": "npm:evil@1.0.0" } },
    );

    assertEquals(issues, [
      { path: "cli/example.ts", line: 1, specifier: "#evil" },
      { path: "cli/example.ts", line: 2, specifier: "#missing" },
    ]);
  });

  it("applies the nearest scoped import map over the repository map", () => {
    const issues = findCoreThirdPartySourceImports(
      [
        {
          path: "src/example.ts",
          content: 'import "#shared";\n',
        },
        {
          path: "cli/example.ts",
          content: 'import "#shared";\nimport "#cli/shared/args";\n',
        },
      ],
      {
        importMap: { "#shared": "./src/shared.ts" },
        scopedImportMaps: [{
          root: "cli/",
          imports: {
            "#shared": "npm:evil@1.0.0",
            "#cli/": "./cli/",
          },
        }],
      },
    );

    assertEquals(issues, [
      { path: "cli/example.ts", line: 1, specifier: "#shared" },
    ]);
  });
});

Deno.test("core dependency audit loads every in-scope configuration", async () => {
  const configs = await readCoreDependencyConfigs();
  assertEquals(
    configs.map(({ path, root }) => ({ path, root })),
    [
      { path: "deno.json", root: "" },
      { path: "cli/deno.json", root: "cli/" },
    ],
  );
});

Deno.test("core dependency audit traverses the repository root", async () => {
  const files = await readCoreSourceFiles();
  assertEquals(files.some(({ path }) => path === "src/index.ts"), true);
  assertEquals(files.some(({ path }) => path === "cli/main.ts"), true);
});
