import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  findCoreThirdPartyImports,
  findCoreThirdPartySourceImports,
  findRootNpmSpecifierLiterals,
} from "./audit-core-deps.ts";

describe("findCoreThirdPartyImports", () => {
  it("flags npm, remote, and non-standard JSR imports", () => {
    const issues = findCoreThirdPartyImports(
      {
        imports: {
          "#veryfront/foo": "./src/foo.ts",
          "@std/path": "jsr:@std/path",
          "bash-tool": "npm:bash-tool@1.3.16",
          "react": "https://esm.sh/react@19.2.4",
          "remote-http": "http://packages.example.test/runtime.ts",
          "jsr-third-party": "jsr:@acme/package@1.0.0",
        },
      },
    );

    assertEquals(issues, [
      { specifier: "bash-tool", target: "npm:bash-tool@1.3.16" },
      { specifier: "react", target: "https://esm.sh/react@19.2.4" },
      {
        specifier: "remote-http",
        target: "http://packages.example.test/runtime.ts",
      },
      {
        specifier: "jsr-third-party",
        target: "jsr:@acme/package@1.0.0",
      },
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
          path: "templates/files/app/tool.ts",
          content: 'import { z } from "zod";',
        },
      ],
      {
        importMap: {
          react: "./react/react.ts",
          "react-dom/client": "./react/react-dom-client.ts",
        },
      },
    );

    assertEquals(issues, []);
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

  it("flags statically assembled dynamic npm and remote specifiers", () => {
    const issues = findCoreThirdPartySourceImports([
      {
        path: "src/cache/hidden-imports.ts",
        content: [
          "const redisClient = [",
          '  "npm:@redis/client",',
          '  "@1.5.8",',
          '].join("");',
          "await import(redisClient);",
          'await import("npm:" + "redis@5.11.0");',
          'await import(["https://esm.sh/", "zod@4.3.6"].join(""));',
          'const local = ["./", "local.ts"].join("");',
          "await import(local);",
          '// import("npm:comment-only@1.0.0");',
          'const pattern = /import\\("npm:regex-only@1.0.0"\\)/;',
          "const sourceText = 'import(\"npm:string-only@1.0.0\")';",
        ].join("\n"),
      },
    ]);

    assertEquals(issues, [
      {
        path: "src/cache/hidden-imports.ts",
        line: 5,
        specifier: "npm:@redis/client@1.5.8",
      },
      {
        path: "src/cache/hidden-imports.ts",
        line: 6,
        specifier: "npm:redis@5.11.0",
      },
      {
        path: "src/cache/hidden-imports.ts",
        line: 7,
        specifier: "https://esm.sh/zod@4.3.6",
      },
    ]);
  });

  it("resolves lexical constants without confusing shadowed local imports", () => {
    const issues = findCoreThirdPartySourceImports([
      {
        path: "src/cache/scoped-imports.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "{",
          '  const dependency = "./local.ts";',
          "  await import(dependency);",
          "}",
          "await import(dependency);",
        ].join("\n"),
      },
    ]);

    assertEquals(issues, [
      {
        path: "src/cache/scoped-imports.ts",
        line: 6,
        specifier: "npm:ioredis@5.8.2",
      },
    ]);
  });

  it("models parameter patterns, loop scopes, and function-scoped var bindings", () => {
    const issues = findCoreThirdPartySourceImports([
      {
        path: "src/cache/default-parameter.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "function load(value = dependency) {",
          "  return import(dependency);",
          "}",
        ].join("\n"),
      },
      {
        path: "src/cache/destructured-parameter.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "function load({ dependency: local }) {",
          "  return import(dependency);",
          "}",
        ].join("\n"),
      },
      {
        path: "src/cache/loop-scope.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          'for (const dependency of ["./local.ts"]) {',
          "  await import(dependency);",
          "}",
          "await import(dependency);",
        ].join("\n"),
      },
      {
        path: "src/cache/var-scope.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "function load() {",
          "  { var dependency = './local.ts'; }",
          "  return import(dependency);",
          "}",
        ].join("\n"),
      },
      {
        path: "src/cache/parameter-var-scope.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "function load(value = import(dependency)) {",
          "  var dependency = './local.ts';",
          "}",
        ].join("\n"),
      },
      {
        path: "src/cache/static-block-scope.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "class Cache {",
          "  static {",
          "    var dependency = './local.ts';",
          "    void import(dependency);",
          "  }",
          "}",
          "void import(dependency);",
        ].join("\n"),
      },
      {
        path: "src/cache/named-class-expression.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "const Cache = class dependency {",
          "  static { void import(dependency); }",
          "};",
        ].join("\n"),
      },
      {
        path: "src/cache/computed-class-method.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "class Cache {",
          "  [import(dependency)](dependency: string) {}",
          "}",
        ].join("\n"),
      },
      {
        path: "src/cache/computed-object-method.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "const cache = {",
          "  [import(dependency)](dependency: string) {}",
          "};",
        ].join("\n"),
      },
      {
        path: "src/cache/namespace-scope.ts",
        content: [
          'const dependency = "npm:ioredis@5.8.2";',
          "namespace Cache {",
          '  const dependency = "./local.ts";',
          "  void import(dependency);",
          "}",
          "void import(dependency);",
        ].join("\n"),
      },
    ]);

    assertEquals(issues, [
      {
        path: "src/cache/default-parameter.ts",
        line: 3,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/destructured-parameter.ts",
        line: 3,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/loop-scope.ts",
        line: 5,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/parameter-var-scope.ts",
        line: 2,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/static-block-scope.ts",
        line: 8,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/computed-class-method.ts",
        line: 3,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/computed-object-method.ts",
        line: 3,
        specifier: "npm:ioredis@5.8.2",
      },
      {
        path: "src/cache/namespace-scope.ts",
        line: 6,
        specifier: "npm:ioredis@5.8.2",
      },
    ]);
  });
});
