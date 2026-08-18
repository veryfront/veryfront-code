import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findFailOpenDefaults,
  isScannedFile,
  stripComments,
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

  it("flags a destructuring or parameter default of true", () => {
    assertEquals(rules("        dev = true,"), ["1:dev-default"]);
  });

  it("flags an aliased destructuring default", () => {
    const source = [
      "const { dev: renderDev = true } = options;",
      "const { isLocalProject: local = true } = options;",
    ].join("\n");
    assertEquals(rules(source), ["1:dev-default", "2:dev-default"]);
  });

  it("flags a render mode defaulting to development", () => {
    const source = [
      'this.mode = options.mode ?? "development";',
      '    mode: "development" | "production" = "development",',
    ].join("\n");
    assertEquals(rules(source), ["1:mode-fallback", "2:mode-default"]);
  });

  it("accepts production-safe defaults", () => {
    const source = [
      "const dev = options.dev ?? false;",
      "        dev = false,",
      'this.mode = options.mode ?? "production";',
      '    mode: "development" | "production" = "production",',
      "this.isLocalProject = options?.isLocalProject ?? false;",
    ].join("\n");
    assertEquals(rules(source), []);
  });

  it("accepts an explicit value at a call site", () => {
    const source = [
      "  dev: true,",
      '  mode: "development",',
      '  dev: mode === "development",',
      "  isLocalProject: !!ctx.isLocalProject,",
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

  it("keeps line numbers correct after a multi-line block comment", () => {
    const source = [
      "/*", // 1
      " * a comment", // 2
      " * spanning lines", // 3
      " */", // 4
      "const dev = options?.dev ?? true;", // 5
    ].join("\n");
    assertEquals(findFailOpenDefaults(source)[0]?.line, 5);
  });

  it("does not treat a comment delimiter inside a string as a comment", () => {
    const source = [
      'const open = "/*";', // 1
      'const shut = "*/";', // 2
      "const dev = options?.dev ?? true;", // 3
      'const slashes = "http://example.test";', // 4
      "const dev2 = options?.dev ?? true;", // 5
    ].join("\n");
    assertEquals(rules(source), ["3:dev-fallback", "5:dev-fallback"]);
  });

  it("does not treat a comment delimiter inside a template literal as a comment", () => {
    const source = [
      "const t = `/* not a comment`;",
      "const dev = options?.dev ?? true;",
    ].join("\n");
    assertEquals(rules(source), ["2:dev-fallback"]);
  });

  it("keeps scanning past an escaped quote inside a string", () => {
    const source = [
      'const s = "he said \\"/*\\" and left";',
      "const dev = options?.dev ?? true;",
    ].join("\n");
    assertEquals(rules(source), ["2:dev-fallback"]);
  });

  it("reports one violation per line and a 1-based line number", () => {
    const source = ["const a = 1;", "", "const dev = options?.dev ?? true;"]
      .join("\n");
    assertEquals(findFailOpenDefaults(source).length, 1);
    assertEquals(findFailOpenDefaults(source)[0]?.line, 3);
  });
});

describe("stripComments", () => {
  it("keeps string literals so mode rules can still match", () => {
    assertEquals(
      stripComments('const m = "development"; // note').trim(),
      'const m = "development";',
    );
  });

  it("blanks a block comment without removing its line breaks", () => {
    const stripped = stripComments("/*\n * x\n */\ncode;");
    assertEquals(stripped.split("\n").length, 4);
    assertEquals(stripped.split("\n")[3], "code;");
  });

  it("leaves code after a string that contains a comment delimiter", () => {
    assertEquals(
      stripComments('const a = "/*";\nconst b = 1;'),
      'const a = "/*";\nconst b = 1;',
    );
  });

  it("preserves column positions when blanking a line comment", () => {
    const source = "const a = 1; // note";
    const stripped = stripComments(source);

    assertEquals(stripped.length, source.length);
    assertEquals(stripped.trimEnd(), "const a = 1;");
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
