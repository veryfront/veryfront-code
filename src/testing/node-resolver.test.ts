import "#veryfront/schemas/_test-setup.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("Node test resolver", { ignore: !isNode }, () => {
  it("honors workspace exports, scoped imports, and vendored JSR modules", async () => {
    const [schemaExtension, react, yaml] = await Promise.all([
      import("@veryfront/ext-schema-zod"),
      import("@veryfront/react"),
      import("@std/yaml/parse"),
    ]);

    assertEquals(typeof schemaExtension.createZodAdapter, "function");
    assertEquals(typeof react.createElement, "function");
    assertEquals(yaml.parse("nested:\n  value: 42"), { nested: { value: 42 } });
  });
});
