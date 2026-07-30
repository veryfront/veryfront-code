import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCanonicalToolInput } from "./tool-input.ts";

describe("parseCanonicalToolInput", () => {
  it("distinguishes valid empty input from malformed and non-object input", () => {
    assertEquals(parseCanonicalToolInput("{}"), { ok: true, value: {} });
    assertEquals(parseCanonicalToolInput('{}{"path":"a.md"}'), {
      ok: true,
      value: { path: "a.md" },
    });
    assertEquals(parseCanonicalToolInput('{"path":'), {
      ok: false,
      reason: "malformed",
    });
    assertEquals(parseCanonicalToolInput("[]"), {
      ok: false,
      reason: "invalid",
    });
    assertEquals(parseCanonicalToolInput(null), {
      ok: false,
      reason: "invalid",
    });
  });
});
