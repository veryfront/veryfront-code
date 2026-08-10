import { BasicTracerProvider } from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteNpmProtocolImports } from "./npm-protocol-imports.ts";

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
});
