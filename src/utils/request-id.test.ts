import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateRequestId } from "./request-id.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateRequestId", () => {
  it("preserves a bounded incoming correlation ID", () => {
    assertEquals(generateRequestId("upstream-request-123"), "upstream-request-123");
  });

  it("generates a UUID when the incoming ID is absent", () => {
    assertEquals(UUID_PATTERN.test(generateRequestId()), true);
    assertEquals(UUID_PATTERN.test(generateRequestId("")), true);
  });

  it("replaces oversized or control-bearing incoming IDs", () => {
    const oversized = "x".repeat(256);
    const generatedForOversized = generateRequestId(oversized);
    const generatedForControl = generateRequestId("unsafe\u0000request");

    assertEquals(generatedForOversized === oversized, false);
    assertEquals(UUID_PATTERN.test(generatedForOversized), true);
    assertEquals(generatedForControl === "unsafe\u0000request", false);
    assertEquals(UUID_PATTERN.test(generatedForControl), true);
  });
});
