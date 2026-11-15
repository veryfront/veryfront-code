import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TEST_SENSITIVE_ENV_KEYS } from "./test-sensitive-env-keys.ts";

describe("test-sensitive-env-keys", () => {
  it("lists both API credential names for the test process to remove", () => {
    const names: readonly string[] = TEST_SENSITIVE_ENV_KEYS;
    assertEquals(names.includes("VERYFRONT_API_KEY"), true);
    assertEquals(names.includes("VERYFRONT_API_TOKEN"), true);
  });
});
