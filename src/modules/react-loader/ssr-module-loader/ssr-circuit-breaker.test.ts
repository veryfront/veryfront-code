import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { failedComponents } from "./cache/index.ts";
import { CIRCUIT_BREAKER_RESET_MS, CIRCUIT_BREAKER_THRESHOLD } from "./constants.ts";
import { SSRCircuitBreaker } from "./ssr-circuit-breaker.ts";

describe("modules/react-loader/ssr-module-loader/ssr-circuit-breaker", () => {
  it("opens at the failure threshold and resets after the cooldown", () => {
    failedComponents.clear();
    let now = 1_000;
    const breaker = new SSRCircuitBreaker(() => now);

    for (let index = 0; index < CIRCUIT_BREAKER_THRESHOLD; index++) {
      breaker.recordFailure("component-key");
    }

    assertThrows(
      () => breaker.check("component-key", "/private/component.tsx"),
      Error,
      "temporarily unavailable",
    );
    now += CIRCUIT_BREAKER_RESET_MS;
    breaker.check("component-key", "/private/component.tsx");
    assertEquals(failedComponents.has("component-key"), false);
  });

  it("clears failure state after a successful load", () => {
    failedComponents.clear();
    const breaker = new SSRCircuitBreaker(() => 1_000);
    breaker.recordFailure("component-key");
    breaker.recordSuccess("component-key");
    assertEquals(failedComponents.has("component-key"), false);
  });

  it("rejects invalid circuit identities", () => {
    const breaker = new SSRCircuitBreaker(() => 1_000);
    assertThrows(() => breaker.recordFailure(""), TypeError);
    assertThrows(() => breaker.check("bad\nkey", "/component.tsx"), TypeError);
  });
});
