import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import extBabel, { BabelCodeParser } from "./index.ts";
import { VeryfrontError } from "veryfront/errors";
import type { CodeParser } from "veryfront/extensions/parser";

const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

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
      for (const filePath of ["file.cjs", "file.js"]) {
        const ast = await parser.parse({
          code: "if (module.parent) return; module.exports = true;",
          filePath,
        });
        assert(ast);
      }
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

    it("parses decorators before and after export accepted by the bundler", async () => {
      for (
        const code of [
          "@logged export class Store {}",
          "export @logged class Store {}",
        ]
      ) {
        const ast = await parser.parse({ code, filePath: "file.ts" });
        assert(ast);
      }
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

    it("reports only unbound static CommonJS imports", async () => {
      const specifiers = await parser.findStaticCommonJsImports?.({
        code: [
          `require("direct");`,
          String.raw`requ\u0069re("escaped-identifier");`,
          `require?.("optional");`,
          `(require as any)?.("as-expression");`,
          `require!?.("non-null");`,
          `(<any> require)?.("type-assertion");`,
          `(require satisfies any)?.("satisfies");`,
          `require<string>?.("instantiation");`,
          `require.resolve("resolve");`,
          `require.resolve?.("optional-resolve");`,
          `require.call(null, "call");`,
          `require.resolve.call(null, "resolve-call");`,
          `module.require.call(module, "module-call");`,
          `require.apply(null, ["apply"]);`,
          `require.resolve.apply(null, ["resolve-apply"]);`,
          `module.require.apply(module, ["module-apply"]);`,
          `require.bind(null, "bind")();`,
          `require.resolve.bind(null, "resolve-bind")();`,
          `module.require.bind(module, "module-bind")();`,
          `require.bind(null)("bind-invocation");`,
          `require.resolve.bind(null)("resolve-bind-invocation");`,
          `module.require.bind(module)("module-bind-invocation");`,
          `require.main.require("require-main");`,
          `module.parent.require("module-parent");`,
          `module?.parent?.require?.("optional-module-parent");`,
          `module.require.resolve("not-module-resolve");`,
          `require.resolve.resolve("not-double-resolve");`,
          `(0, require)("sequence");`,
          `(require, require)("sequence-final");`,
          `new require("new-require");`,
          `new module.require("new-module-require");`,
          "require(`template`);",
          `module.require("member");`,
          String.raw`module.requ\u0069re("escaped-member");`,
          `module["require"]("computed");`,
          `module["requ" + "ire"]("concat-member");`,
          `require["res" + "olve"]("concat-resolve");`,
          'module[`requ${"ire"}`](`kn${"ex"}`);',
          'require.resolve(`kn${"ex"}`);',
          String.raw`module["requ\u0069re"]("escaped-property");`,
          `module?.require?.("optional-member");`,
          `(module as any)?.require?.("module-as-expression");`,
          `module!?.require?.("module-non-null");`,
          `module!.require?.("member-non-null");`,
          `module["require" as any]?.("computed-as-expression");`,
          `module.require<string>?.("member-instantiation");`,
          `require?.("argument-as" as const);`,
          `require?.(<string> "argument-type-assertion");`,
          `module.require?.("argument-satisfies" satisfies string);`,
          `require?.("argument-non-null"!);`,
          "require?.((`argument-template`) as const);",
          `function local(require: (name: string) => unknown) { require("local-require"); }`,
          `function localModule(module: { require(name: string): unknown }) { module.require("local-module"); }`,
          `function localMain(require: { main: { require(name: string): unknown } }) { require.main.require("local-main"); }`,
          `function localParent(module: { parent: { require(name: string): unknown } }) { module.parent.require("local-parent"); }`,
          `const sequenceLocal = (name: string) => name; (require, sequenceLocal)("local-sequence");`,
          `const packageName = "dynamic"; require(packageName);`,
          `const boundName = "dynamic"; require.bind(null, boundName)("outer-not-package");`,
        ].join("\n"),
        filePath: "commonjs.ts",
      });

      assertEquals(specifiers, [
        "direct",
        "escaped-identifier",
        "optional",
        "as-expression",
        "non-null",
        "type-assertion",
        "satisfies",
        "instantiation",
        "resolve",
        "optional-resolve",
        "call",
        "resolve-call",
        "module-call",
        "apply",
        "resolve-apply",
        "module-apply",
        "bind",
        "resolve-bind",
        "module-bind",
        "bind-invocation",
        "resolve-bind-invocation",
        "module-bind-invocation",
        "require-main",
        "module-parent",
        "optional-module-parent",
        "sequence",
        "sequence-final",
        "new-require",
        "new-module-require",
        "template",
        "member",
        "escaped-member",
        "computed",
        "concat-member",
        "concat-resolve",
        "knex",
        "knex",
        "escaped-property",
        "optional-member",
        "module-as-expression",
        "module-non-null",
        "member-non-null",
        "computed-as-expression",
        "member-instantiation",
        "argument-as",
        "argument-type-assertion",
        "argument-satisfies",
        "argument-non-null",
        "argument-template",
      ]);
    });

    it("analyzes top-level CommonJS returns for every browser script loader", async () => {
      for (
        const filePath of [
          "entry.js",
          "entry.jsx",
          "entry.mjs",
          "entry.cjs",
          "entry.ts",
          "entry.tsx",
          "entry.mts",
          "entry.cts",
        ]
      ) {
        assertEquals(
          await parser.findStaticCommonJsImports?.({
            code: 'if (module.parent) return; module.exports = require("knex");',
            filePath,
          }),
          ["knex"],
          filePath,
        );
      }
    });

    it("fails closed when CommonJS array primitives have changed", async () => {
      const isArray = Object.getOwnPropertyDescriptor(Array, "isArray")!;
      const push = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
      const some = Object.getOwnPropertyDescriptor(Array.prototype, "some")!;
      const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
      let error: unknown;
      Object.defineProperty(Array, "isArray", {
        configurable: true,
        value: () => false,
      });
      Object.defineProperty(Array.prototype, "push", {
        configurable: true,
        value: () => 0,
      });
      Object.defineProperty(Array.prototype, "some", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value: function* () {},
      });
      try {
        await parser.findStaticCommonJsImports?.({
          code: `require("knex");`,
          filePath: "poisoned-arrays.ts",
        });
      } catch (caught) {
        error = caught;
      } finally {
        Object.defineProperty(Array, "isArray", isArray);
        Object.defineProperty(Array.prototype, "push", push);
        Object.defineProperty(Array.prototype, "some", some);
        Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
      }

      assert(error instanceof Error);
      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "bundle-error");
    });

    it("fails closed when Babel traversal primitives have changed", async () => {
      const keys = Object.getOwnPropertyDescriptor(Object, "keys")!;
      let error: unknown;
      Object.defineProperty(Object, "keys", {
        configurable: true,
        value: () => [],
      });
      try {
        await parser.findStaticCommonJsImports?.({
          code: `require("knex");`,
          filePath: "poisoned-object-keys.ts",
        });
      } catch (caught) {
        error = caught;
      } finally {
        Object.defineProperty(Object, "keys", keys);
      }

      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "bundle-error");
    });

    it("fails closed before Babel uses changed traversal primordials", async () => {
      const cases: readonly (readonly [unknown, PropertyKey])[] = [
        [Array.prototype, "includes"],
        [Array.prototype, "concat"],
        [Array.prototype, "pop"],
        [Array.prototype, "forEach"],
        [Array.prototype, "join"],
        [Object, "assign"],
        [Object, "create"],
        [Object, "defineProperty"],
        [Object, "defineProperties"],
        [Map.prototype, "get"],
        [Map.prototype, "set"],
        [Map.prototype, "has"],
        [Set.prototype, "has"],
        [WeakMap.prototype, "get"],
        [WeakMap.prototype, "set"],
        [WeakSet.prototype, "add"],
        [WeakSet.prototype, "has"],
        [String.prototype, "charCodeAt"],
        [String.prototype, "slice"],
        [String.prototype, "startsWith"],
        [String.prototype, "endsWith"],
        [String.prototype, "split"],
        [String.prototype, "toLowerCase"],
        [RegExp.prototype, "exec"],
        [RegExp.prototype, "test"],
        [Function.prototype, "apply"],
        [Function.prototype, "bind"],
        [globalThis, "Map"],
        [globalThis, "Set"],
        [globalThis, "WeakMap"],
        [globalThis, "WeakSet"],
        [globalThis, "Promise"],
      ];

      for (const [target, key] of cases) {
        const descriptor = TestObjectGetOwnPropertyDescriptor(target as object, key)!;
        let calls = 0;
        let error: unknown;
        TestObjectDefineProperty(target as object, key, {
          configurable: true,
          value: () => {
            calls++;
            throw new Error(`poisoned ${String(key)}`);
          },
        });
        try {
          await parser.findStaticCommonJsImports?.({
            code: `require("knex");`,
            filePath: `poisoned-${String(key)}.ts`,
          });
        } catch (caught) {
          error = caught;
        } finally {
          TestObjectDefineProperty(target as object, key, descriptor);
        }

        assert(error instanceof VeryfrontError);
        assertEquals(error.slug, "bundle-error");
        assertEquals(calls, 0);
      }
    });

    it("rechecks traversal primitives after asynchronous parsing", async () => {
      const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
      const pending = parser.findStaticCommonJsImports?.({
        code: `require("knex");`,
        filePath: "async-poisoned-arrays.ts",
      });
      let error: unknown;
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value: function* () {},
      });
      try {
        await pending;
      } catch (caught) {
        error = caught;
      } finally {
        Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
      }

      assert(error instanceof VeryfrontError);
      assertEquals(error.slug, "bundle-error");
    });

    it("does not treat erased TypeScript bindings as runtime CommonJS shadows", async () => {
      const cases = [
        [
          `declare const require: ((name: string) => unknown) | undefined; require?.("ambient-const");`,
          [
            "ambient-const",
          ],
        ],
        [
          `declare let require: ((name: string) => unknown) | undefined; require?.("ambient-let");`,
          [
            "ambient-let",
          ],
        ],
        [
          `declare var require: ((name: string) => unknown) | undefined; require?.("ambient-var");`,
          [
            "ambient-var",
          ],
        ],
        [`import type require from "./types.ts"; require?.("type-import");`, ["type-import"]],
        [`import type * as require from "./types.ts"; require?.("type-namespace");`, [
          "type-namespace",
        ]],
        [`import { type require } from "./types.ts"; require?.("type-named");`, [
          "type-named",
        ]],
        [`import { type x as require } from "./types.ts"; require?.("type-aliased");`, [
          "type-aliased",
        ]],
        [`import type require = require("./types.ts"); require?.("type-import-equals");`, [
          "type-import-equals",
        ]],
        [
          `declare const module: { require?: (name: string) => unknown }; module?.require?.("ambient-module");`,
          ["ambient-module"],
        ],
        [
          `import type module from "./types.ts"; module?.require?.("type-module");`,
          ["type-module"],
        ],
        [
          `import type module = require("./types.ts"); module?.require?.("type-module-equals");`,
          ["type-module-equals"],
        ],
        [
          `declare namespace module { function require(name: string): unknown; } module.require("ambient-namespace");`,
          ["ambient-namespace"],
        ],
        [
          `namespace module { export type Value = string; } module.require("type-only-namespace-module");`,
          ["type-only-namespace-module"],
        ],
        [
          `namespace require { export type Value = string; } require?.("type-only-namespace-require");`,
          ["type-only-namespace-require"],
        ],
      ] as const;

      for (const [code, expected] of cases) {
        assertEquals(
          await parser.findStaticCommonJsImports?.({ code, filePath: "erased-bindings.ts" }),
          expected,
        );
      }
    });

    it("keeps runtime TypeScript bindings as CommonJS shadows", async () => {
      const cases = [
        `import require from "./runtime.ts"; require?.("runtime-import");`,
        `import module from "./runtime.ts"; module?.require?.("runtime-module");`,
        `const require = (name: string) => name; require("runtime-local");`,
        `const module = { require: (name: string) => name }; module.require("runtime-object");`,
        `import require = require("./runtime.ts"); require("runtime-import-equals");`,
        `namespace module { export function require(name: string) { return name; } } module.require("runtime-namespace");`,
        `namespace module { export declare const value: string; } module.require("declared-value-member");`,
        `namespace outer { export namespace module { export function require(name: string) { return name; } } export const value = module.require("nested-namespace"); }`,
      ];

      for (const code of cases) {
        assertEquals(
          await parser.findStaticCommonJsImports?.({ code, filePath: "runtime-bindings.ts" }),
          [],
        );
      }
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
