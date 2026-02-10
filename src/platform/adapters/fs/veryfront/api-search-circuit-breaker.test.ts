import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ApiSearchCircuitBreaker } from "./api-search-circuit-breaker.ts";

describe("veryfront/api-search-circuit-breaker", () => {
  it("stays closed until threshold failures, then opens", () => {
    const breaker = new ApiSearchCircuitBreaker({
      threshold: 3,
      cooldownMs: 1000,
    });

    assertEquals(breaker.canSearch(0), true);
    assertEquals(breaker.recordFailure(0), { tripped: false, failures: 1 });
    assertEquals(breaker.recordFailure(0), { tripped: false, failures: 2 });
    assertEquals(breaker.recordFailure(0), { tripped: true, failures: 3 });
    assertEquals(breaker.canSearch(999), false);
    assertEquals(breaker.canSearch(1000), true);
  });

  it("resets failure count on success", () => {
    const breaker = new ApiSearchCircuitBreaker({
      threshold: 3,
      cooldownMs: 1000,
    });

    assertEquals(breaker.recordFailure(0), { tripped: false, failures: 1 });
    breaker.recordSuccess();
    assertEquals(breaker.recordFailure(0), { tripped: false, failures: 1 });
  });
});
