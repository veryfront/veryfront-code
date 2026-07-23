import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateRequestId } from "./request-id.ts";

describe("request-id", () => {
  it("preserves a bounded visible upstream identifier", () => {
    assertEquals(generateRequestId("trace_123.example/service:1"), "trace_123.example/service:1");
  });

  it("replaces unsafe or unbounded upstream values", () => {
    for (const incoming of ["has space", "line\nbreak", "🦄", "x".repeat(129)]) {
      const generated = generateRequestId(incoming);
      assertNotEquals(generated, incoming);
      assertMatch(
        generated,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });
});
