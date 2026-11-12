import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TEST_SENSITIVE_ENV_KEYS } from "./sanitize-process-env.ts";

describe("sanitize-process-env", () => {
  it("removes both API credential names from the test process", () => {
    const names: readonly string[] = TEST_SENSITIVE_ENV_KEYS;
    assertEquals(names.includes("VERYFRONT_API_KEY"), true);
    assertEquals(names.includes("VERYFRONT_API_TOKEN"), true);
  });
});
