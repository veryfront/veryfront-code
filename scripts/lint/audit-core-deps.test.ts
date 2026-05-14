import { assertEquals } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  findCoreThirdPartyImports,
  findCoreThirdPartySourceImports,
} from "./audit-core-deps.ts";

describe("findCoreThirdPartyImports", () => {
  it("flags npm and remote imports that are not allowlisted", () => {
    const issues = findCoreThirdPartyImports(
      {
        imports: {
          "#veryfront/foo": "./src/foo.ts",
          "@std/path": "jsr:@std/path",
          "bash-tool": "npm:bash-tool@1.3.16",
          "react": "https://esm.sh/react@19.2.4",
        },
      },
      { allowedSpecifiers: new Set(["react"]) },
    );

    assertEquals(issues, [
      { specifier: "bash-tool", target: "npm:bash-tool@1.3.16" },
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
    const issues = findCoreThirdPartySourceImports([
      {
        path: "src/react/component.tsx",
        content: [
          'import React from "react";',
          'import { join } from "#veryfront/platform/path";',
          'import { defineConfig } from "veryfront/config";',
          'import extSchema from "@veryfront/ext-schema-zod";',
          'import { assertEquals } from "jsr:@std/assert";',
          'import local from "./local.ts";',
        ].join("\n"),
      },
      {
        path: "src/tool/factory.test.ts",
        content: 'import { z } from "zod";',
      },
      {
        path: "cli/templates/files/app/tool.ts",
        content: 'import { z } from "zod";',
      },
    ]);

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
});
