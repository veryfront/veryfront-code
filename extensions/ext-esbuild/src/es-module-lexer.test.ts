/**
 * EsModuleLexer smoke tests.
 *
 * @module extensions/ext-esbuild/es-module-lexer.test
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { EsModuleLexer } from "./es-module-lexer.ts";

describe("EsModuleLexer", () => {
  it("parses static imports after init()", async () => {
    const lexer = new EsModuleLexer();
    await lexer.init();
    const imports = lexer.parse(`import x from "react";\nimport { y } from "vue";`);
    assertEquals(imports.length, 2);
    assertEquals(imports[0]!.n, "react");
    assertEquals(imports[1]!.n, "vue");
  });

  it("parses dynamic imports with d > -1", async () => {
    const lexer = new EsModuleLexer();
    await lexer.init();
    const imports = lexer.parse(`const mod = await import("lodash");`);
    assertEquals(imports.length, 1);
    assertEquals(imports[0]!.n, "lodash");
    assertEquals(imports[0]!.d > -1, true);
  });

  it("init() is idempotent", async () => {
    const lexer = new EsModuleLexer();
    await lexer.init();
    await lexer.init();
    const imports = lexer.parse(`import "./x.ts";`);
    assertEquals(imports.length, 1);
  });
});
