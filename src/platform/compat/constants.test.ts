import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_PORT, LOCALHOST } from "./constants.ts";

describe("platform/compat/constants", () => {
  it("exports stable runtime-independent defaults", () => {
    assertEquals(DEFAULT_PORT, 3000);
    assertEquals(LOCALHOST, {
      IPV4: "127.0.0.1",
      IPV6: "::1",
      HOSTNAME: "localhost",
    });
    assertEquals(Object.isFrozen(LOCALHOST), true);
  });
});
