import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { toCjsDestructureBindings } from "./cjs-destructure-bindings.ts";

describe("toCjsDestructureBindings", () => {
  it("preserves the established CommonJS destructuring conversion", () => {
    assertEquals(
      toCjsDestructureBindings("{ parse as parsePdf, version }"),
      "{ parse: parsePdf, version }",
    );
    assertEquals(
      toCjsDestructureBindings("{ default as foo, bar as baz }"),
      "{ default: foo, bar: baz }",
    );
    assertEquals(toCjsDestructureBindings("{ foo, bar }"), "{ foo, bar }");
    assertEquals(toCjsDestructureBindings("{   }"), "{}");
  });
});
