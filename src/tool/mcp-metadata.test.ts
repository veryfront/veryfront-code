import { assertEquals } from "#veryfront/testing/assert.ts";
import { isToolAnnotations } from "./mcp-metadata.ts";

Deno.test("MCP annotation validation does not invoke caller accessors", () => {
  let accessorReads = 0;
  const annotations = Object.defineProperty({}, "readOnlyHint", {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return true;
    },
  });

  assertEquals(isToolAnnotations(annotations), false);
  assertEquals(accessorReads, 0);
});

Deno.test("MCP annotation validation rejects transparent proxies", () => {
  assertEquals(isToolAnnotations(new Proxy({ readOnlyHint: true }, {})), false);
});
