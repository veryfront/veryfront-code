import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatContextText, serializeError } from "./core.ts";

describe("logger/core", () => {
  it("bounds serialized error fields", () => {
    const error = new Error("m".repeat(10_000));
    error.name = "n".repeat(200);
    error.stack = "s".repeat(40_000);

    const serialized = serializeError(error)!;
    assertEquals(serialized.name.length, 128);
    assertEquals(serialized.message.length, 8_192);
    assertEquals(serialized.stack?.length, 32_768);
    assertEquals(serialized.message.endsWith("[TRUNCATED]"), true);
  });

  it("normalizes context keys so text logs stay on one unambiguous line", () => {
    assertEquals(
      formatContextText({ "unsafe\nkey=value": "ok" }, undefined, false),
      "\n                       unsafe_key_value=ok",
    );
  });
});
