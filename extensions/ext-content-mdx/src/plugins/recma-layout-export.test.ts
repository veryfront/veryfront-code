import { Parser } from "acorn";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recmaLayoutExport } from "./recma-layout-export.ts";

describe("MDX layout export", () => {
  it("exports the private wrapper exactly once", () => {
    const program = Parser.parse("const MDXLayout = () => null;", {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    const transform = recmaLayoutExport();
    transform(program);
    transform(program);
    assertEquals(program.body.length, 2);
    const exported = program.body[1];
    assertEquals(exported?.type, "ExportNamedDeclaration");
    if (exported?.type === "ExportNamedDeclaration") {
      assertEquals(
        exported.specifiers.map(({ exported }) =>
          exported.type === "Identifier" ? exported.name : exported.value
        ),
        ["MDXLayout"],
      );
    }
  });
  for (
    const source of [
      "export const MDXLayout = () => null;",
      "const MDXLayout = () => null; export { MDXLayout };",
      "const MDXLayout = () => null; const Frame = () => null; export { Frame as MDXLayout };",
      'const text = "const MDXLayout = () => null"; // const MDXLayout = null',
      "function helper() { const MDXLayout = () => null; }",
    ]
  ) {
    it(`preserves authored declarations: ${source}`, () => {
      const program = Parser.parse(source, { ecmaVersion: "latest", sourceType: "module" });
      const before = JSON.stringify(program);
      recmaLayoutExport()(program);
      assertEquals(JSON.stringify(program), before);
    });
  }
});
