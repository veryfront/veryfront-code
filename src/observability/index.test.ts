import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as observability from "veryfront/observability";

describe("veryfront/observability public export surface", () => {
  it("does not expose test resets or mutable metrics state", () => {
    assertEquals("_resetShimForTests" in observability, false);
    assertEquals("resetMetrics" in observability, false);
    assertEquals("state" in observability, false);
    assertEquals("reset" in observability.metrics, false);
  });
});
