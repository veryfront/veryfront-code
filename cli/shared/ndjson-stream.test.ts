import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { streamJsonLine } from "./json-output.ts";

describe("NDJSON Streaming", () => {
  it("streamJsonLine is a function", () => {
    assertEquals(typeof streamJsonLine, "function");
  });
});
