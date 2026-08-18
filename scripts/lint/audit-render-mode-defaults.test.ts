import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findFailOpenDefaults,
  isScannedFile,
} from "./audit-render-mode-defaults.ts";

function rules(source: string): string[] {
  return findFailOpenDefaults(source).map((hit) => `${hit.line}:${hit.rule}`);
}

describe("findFailOpenDefaults", () => {
  it("flags a nullish fallback that resolves to development", () => {
    const source = [
      "const dev = options?.dev ?? true;",
      "this.isLocalProject = options?.isLocalProject ?? true;",
    ].join("\n");
    assertEquals(rules(source), ["1:dev-fallback", "2:dev-fallback"]);
  });

  it("flags a multiline nullish fallback", () => {
    const source = [
      "const dev = options?.dev ??",
      "  true;",
    ].join("\n");

    assertEquals(rules(source), ["1:dev-fallback"]);
  });

  it("flags a destructuring or parameter default of true", () => {
    const source = [
      "const { dev = true } = options;",
      "function load(isLocalProject: boolean = true) {}",
    ].join("\n");
    assertEquals(rules(source), ["1:dev-default", "2:dev-default"]);
  });

  it("flags aliased destructuring defaults", () => {
    const source = [
      "const { dev: renderDev = true } = options;",
      'const { mode: renderMode = "development" } = options;',
      "const { isLocalProject: local = true } = options;",
    ].join("\n");

    assertEquals(rules(source), [
      "1:dev-default",
      "2:mode-default",
      "3:dev-default",
    ]);
  });

  it("flags a render mode defaulting to development", () => {
    const source = [
      'class Loader { mode = options.mode ?? "development"; }',
      'function render(mode: "development" | "production" = "development") {}',
    ].join("\n");
    assertEquals(rules(source), ["1:mode-fallback", "2:mode-default"]);
  });

  it("accepts production-safe defaults", () => {
    const source = [
      "const dev = options.dev ?? false;",
      "function load(dev = false) {}",
      'class Loader { mode = options.mode ?? "production"; }',
      'function render(mode: "development" | "production" = "production") {}',
      "this.isLocalProject = options?.isLocalProject ?? false;",
    ].join("\n");
    assertEquals(rules(source), []);
  });

  it("accepts an explicit value at a call site", () => {
    const source = [
      "const options = {",
      "  dev: true,",
      '  mode: "development",',
      '  nestedDev: mode === "development",',
      "  isLocalProject: !!ctx.isLocalProject,",
      "};",
    ].join("\n");
    assertEquals(rules(source), []);
  });

  it("accepts explicit assignments and declarations", () => {
    const source = [
      "let dev = false;",
      "dev = true;",
      'const mode = "development";',
    ].join("\n");

    assertEquals(rules(source), []);
  });

  it("ignores defaults written inside comments", () => {
    const source = [
      "// const dev = options?.dev ?? true;",
      '/* this.mode = options.mode ?? "development"; */',
      "/**",
      " * @example",
      ' * return json({ mode: getEnv("MODE") ?? "development" });',
      " */",
    ].join("\n");
    assertEquals(rules(source), []);
  });

  it("does not treat comment delimiters in strings as comments", () => {
    const source = [
      'const opening = "/*";',
      "const dev = options.dev ?? true;",
      'const closing = "*/";',
      "/* real",
      " * block comment",
      " */",
      'const mode = options.mode ?? "development";',
    ].join("\n");

    assertEquals(rules(source), ["2:dev-fallback", "7:mode-fallback"]);
  });

  it("reports one violation per line and a 1-based line number", () => {
    const source = ["const a = 1;", "", "const dev = options?.dev ?? true;"]
      .join("\n");
    assertEquals(findFailOpenDefaults(source).length, 1);
    assertEquals(findFailOpenDefaults(source)[0]?.line, 3);
  });
});

describe("isScannedFile", () => {
  it("scans runtime sources only", () => {
    assertEquals(isScannedFile("src/transforms/pipeline/context.ts"), true);
    assertEquals(
      isScannedFile("src/rendering/rsc/server-renderer/rsc-renderer.tsx"),
      true,
    );
    assertEquals(
      isScannedFile("src/transforms/pipeline/context.test.ts"),
      false,
    );
    assertEquals(isScannedFile("src/rendering/thing.test.tsx"), false);
    assertEquals(isScannedFile("src/workflow/__tests__/helper.ts"), false);
    assertEquals(
      isScannedFile(
        "src/server/services/rsc/endpoints/endpoint-router.test-helpers.ts",
      ),
      false,
    );
    assertEquals(isScannedFile("src/testing/preload.ts"), false);
    assertEquals(isScannedFile("src/rendering/notes.md"), false);
  });
});
