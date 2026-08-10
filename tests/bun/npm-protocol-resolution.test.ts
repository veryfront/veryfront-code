import { BasicTracerProvider } from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteNpmProtocolImports } from "./npm-protocol-imports.ts";
import { bunPreloadRewriteFilter, rewriteBunPreloadSource } from "./preload-rewrite.ts";

describe("Bun npm protocol resolution", () => {
  it("loads versioned scoped and unscoped npm imports", () => {
    const document = new JSDOM("<p>ready</p>").window.document;

    assertEquals(document.querySelector("p")?.textContent, "ready");
    assertEquals(typeof BasicTracerProvider, "function");
  });

  it("leaves import-looking fixture text and comments unchanged", () => {
    const source = [
      'const fixture = `import value from "npm:fixture@1.0.0"`;',
      '// import ignored from "npm:ignored@1.0.0";',
      'import value from "npm:fixture@1.0.0";',
      'const load = () => import("npm:@scope/package@2.0.0/subpath");',
    ].join("\n");

    assertEquals(
      rewriteNpmProtocolImports(source),
      [
        'const fixture = `import value from "npm:fixture@1.0.0"`;',
        '// import ignored from "npm:ignored@1.0.0";',
        'import value from "fixture";',
        'const load = () => import("@scope/package/subpath");',
      ].join("\n"),
    );
  });

  it("rewrites extension and test sources after normalizing path separators", () => {
    const extensionSource =
      'import { defineExtension } from "veryfront/extensions";\nexport const marker = "kept";\n';
    const testSource =
      'import { BasicTracerProvider } from "npm:@opentelemetry/sdk-trace-base@2.9.0";\nexport const marker = "kept";\n';

    for (
      const extensionPath of [
        "/repo/extensions/ext-yaml/src/adapter.ts",
        String.raw`C:\repo\extensions\ext-yaml\src\adapter.ts`,
      ]
    ) {
      assertEquals(bunPreloadRewriteFilter.test(extensionPath), true);
      assertEquals(
        rewriteBunPreloadSource(extensionPath, extensionSource, (source) =>
          source.replace(
            '"veryfront/extensions"',
            '"../../../src/extensions/types.ts"',
          )),
        'import { defineExtension } from "../../../src/extensions/types.ts";\nexport const marker = "kept";\n',
      );
    }

    for (
      const testPath of [
        "/repo/tests/bun/npm-protocol-resolution.test.ts",
        String.raw`C:\repo\tests\bun\npm-protocol-resolution.test.ts`,
        "/repo/extensions/fixtures/npm-protocol-resolution.test.ts",
        String.raw`C:\repo\extensions\fixtures\npm-protocol-resolution.test.ts`,
      ]
    ) {
      assertEquals(bunPreloadRewriteFilter.test(testPath), true);
      assertEquals(
        rewriteBunPreloadSource(testPath, testSource, () => {
          throw new Error("test files must not use extension import rewriting");
        }),
        'import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";\nexport const marker = "kept";\n',
      );
    }
  });
});
