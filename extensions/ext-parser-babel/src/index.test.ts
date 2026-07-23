import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import extBabel, { BabelCodeParser } from "./index.ts";
import type { CodeParser } from "veryfront/extensions/parser";

describe("ext-parser-babel", () => {
  it("factory returns a descriptor with the CodeParser contract", () => {
    const ext = extBabel();
    assertEquals(ext.name, "ext-parser-babel");
    assertEquals(ext.contracts?.provides, ["CodeParser"]);
    assertEquals(ext.capabilities, []);
  });

  it("setup registers the CodeParser contract", () => {
    const ext = extBabel();
    const registered: Record<string, unknown> = {};
    const ctx = {
      config: {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      provide: (n: string, v: unknown) => {
        registered[n] = v;
      },
      get: () => undefined,
      resolve: () => {
        throw new Error("resolve unused");
      },
    };
    ext.setup?.(ctx as never);
    assert(registered.CodeParser instanceof BabelCodeParser);
  });

  describe("BabelCodeParser", () => {
    const parser: CodeParser = new BabelCodeParser();

    it("injectJsxNodePositions stamps data-node-* attributes", () => {
      const out = parser.injectJsxNodePositions(
        `export default function Page() { return <div>hi</div>; }`,
        { filePath: "app/page.tsx" },
      );
      assert(out.includes('data-node-file="app/page.tsx"'));
      assert(out.includes('data-node-name="div"'));
    });

    it("parse + generate roundtrips simple TS source", async () => {
      const ast = await parser.parse({
        code: "const x: number = 1;",
        filePath: "file.ts",
      });
      const { code } = await parser.generate(ast);
      assert(code.includes("const x"));
    });

    it("parses TypeScript module variants used by the browser bundler", async () => {
      for (const filePath of ["file.mts", "file.cts"]) {
        const ast = await parser.parse({
          code: "const value: string = 'ok';",
          filePath,
        });
        assert(ast);
      }
    });

    it("parses CommonJS top-level return accepted by the bundler", async () => {
      const ast = await parser.parse({
        code: "if (module.parent) return; module.exports = true;",
        filePath: "file.cjs",
      });
      assert(ast);
    });

    it("parses legacy import assertions accepted by the bundler", async () => {
      const ast = await parser.parse({
        code: 'import data from "./data.json" assert { type: "json" };',
        filePath: "file.mjs",
      });
      assert(ast);
    });

    it("parses decorator auto-accessors accepted by the bundler", async () => {
      const ast = await parser.parse({
        code: "class Store { @logged accessor value = 1; }",
        filePath: "file.ts",
      });
      assert(ast);
    });

    it("reports function directives without exposing Babel AST details", async () => {
      assertEquals(
        await parser.hasFunctionDirective?.({
          code: `export async function save() { "use server"; return true; }`,
          filePath: "actions.ts",
          directive: "use server",
        }),
        true,
      );
      assertEquals(
        await parser.hasFunctionDirective?.({
          code: `export function shared() { const ready = true; "use server"; return ready; }`,
          filePath: "shared.ts",
          directive: "use server",
        }),
        false,
      );
    });

    it("traverse visits matching node types", async () => {
      const ast = await parser.parse({ code: "const x = 1; const y = 2;", filePath: "f.ts" });
      let count = 0;
      parser.traverse(ast, {
        VariableDeclarator: () => {
          count++;
        },
      });
      assertEquals(count, 2);
    });

    it("exposes parent nodes separately from parent traversal paths", async () => {
      const ast = await parser.parse({ code: "const value = 1;", filePath: "f.ts" });
      let parentType: string | undefined;
      let parentPathType: string | undefined;
      parser.traverse(ast, {
        VariableDeclarator: (path) => {
          parentType = path.parent?.type;
          parentPathType = path.parentPath?.node.type;
        },
      });

      assertEquals(parentType, "VariableDeclaration");
      assertEquals(parentPathType, "VariableDeclaration");
    });
  });
});
