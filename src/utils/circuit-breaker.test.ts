import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CircuitBreaker, CircuitBreakerOpen, getCircuitBreaker } from "./circuit-breaker.ts";

function ignoreRejection(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("CircuitBreaker", () => {
  it("should execute operation in CLOSED state", async () => {
    const cb = new CircuitBreaker({ name: "test" });
    const result = await cb.execute(() => Promise.resolve(42));
    assertEquals(result, 42);
    assertEquals(cb.getState(), "CLOSED");
  });

  it("should stay CLOSED when failures below threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, name: "test-threshold" });

    for (let i = 0; i < 2; i++) {
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    }

    assertEquals(cb.getState(), "CLOSED");
  });

  it("should transition to OPEN after failure threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, name: "test-open" });

    for (let i = 0; i < 3; i++) {
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    }

    assertEquals(cb.getState(), "OPEN");
  });

  it("should throw CircuitBreakerOpen when OPEN", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60000,
      name: "test-reject",
    });

    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));

    assertEquals(cb.getState(), "OPEN");

    await assertRejects(() => cb.execute(() => Promise.resolve("ok")), CircuitBreakerOpen);
  });

  it("should transition to HALF_OPEN after resetTimeout", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1,
      name: "test-halfopen",
    });

    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));

    assertEquals(cb.getState(), "OPEN");

    await sleep(10);

    const result = await cb.execute(() => Promise.resolve("recovered"));
    assertEquals(result, "recovered");
  });

  it("should transition back to CLOSED after success threshold in HALF_OPEN", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1,
      successThreshold: 2,
      name: "test-recover",
    });

    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));

    await sleep(10);

    await cb.execute(() => Promise.resolve("ok"));
    await cb.execute(() => Promise.resolve("ok"));

    assertEquals(cb.getState(), "CLOSED");
  });

  it("should transition from HALF_OPEN back to OPEN on failure", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1,
      name: "test-halfopen-fail",
    });

    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));

    await sleep(10);

    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail again"))));

    assertEquals(cb.getState(), "OPEN");
  });

  it("should reset failure count on success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, name: "test-reset" });

    for (let i = 0; i < 2; i++) {
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    }

    await cb.execute(() => Promise.resolve("ok"));

    for (let i = 0; i < 2; i++) {
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    }

    assertEquals(cb.getState(), "CLOSED");
  });
});

describe("CircuitBreakerOpen", () => {
  it("should include breaker name and retry info", () => {
    const error = new CircuitBreakerOpen("my-breaker", 5000);
    assertEquals(error.breakerName, "my-breaker");
    assertEquals(error.nextAttemptMs, 5000);
    assertEquals(error.name, "CircuitBreakerOpen");
    assertEquals(error.message.includes("my-breaker"), true);
  });
});

describe("getCircuitBreaker", () => {
  it("should return same instance for same name", () => {
    const cb1 = getCircuitBreaker("singleton-test-cb");
    const cb2 = getCircuitBreaker("singleton-test-cb");
    assertEquals(cb1, cb2);
  });

  it("should return different instances for different names", () => {
    const cb1 = getCircuitBreaker("cb-a");
    const cb2 = getCircuitBreaker("cb-b");
    assertEquals(cb1 !== cb2, true);
  });
});
