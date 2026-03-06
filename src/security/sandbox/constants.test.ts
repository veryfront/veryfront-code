import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./constants.ts";

describe("sandbox constants", () => {
  it("should define sandbox timeout", () => {
    assertEquals(DEFAULT_SANDBOX_TIMEOUT_MS, 5000);
  });
});
