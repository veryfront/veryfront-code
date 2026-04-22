import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import extBabel, { BabelCodeParser } from "./index.ts";
import type { CodeParser } from "veryfront/extensions/interfaces";

function makeCtx(): Parameters<NonNullable<ReturnType<typeof extBabel>["setup"]>>[0] {
  const provided: Record<string, unknown> = {};
  const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  return {
    config: {},
    logger: noopLogger,
    provide: (name: string, impl: unknown) => {
      provided[name] = impl;
    },
    get: () => undefined,
    resolve: () => {
      throw new Error("resolve not used in setup");
    },
  } as never;
}

describe("ext-babel", () => {
  it("factory returns a descriptor with the CodeParser capability", () => {
    const ext = extBabel();
    assertEquals(ext.name, "ext-babel");
    assertEquals(ext.capabilities?.[0], { type: "contract", name: "CodeParser" });
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
  });
});
