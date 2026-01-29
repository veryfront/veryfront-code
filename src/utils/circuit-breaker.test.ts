import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CircuitBreaker, CircuitBreakerOpen, getCircuitBreaker } from "./circuit-breaker.ts";

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
      try {
        await cb.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    assertEquals(cb.getState(), "CLOSED");
  });

  it("should transition to OPEN after failure threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, name: "test-open" });

    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    assertEquals(cb.getState(), "OPEN");
  });

  it("should throw CircuitBreakerOpen when OPEN", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60000,
      name: "test-reject",
    });

    try {
      await cb.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    assertEquals(cb.getState(), "OPEN");

    await assertRejects(
      () => cb.execute(() => Promise.resolve("ok")),
      CircuitBreakerOpen,
    );
  });

  it("should transition to HALF_OPEN after resetTimeout", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1,
      name: "test-halfopen",
    });

    try {
      await cb.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    assertEquals(cb.getState(), "OPEN");

    // Wait for reset timeout to pass
    await new Promise((r) => setTimeout(r, 10));

    // Next call should transition to HALF_OPEN and execute
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

    // Trigger OPEN
    try {
      await cb.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    await new Promise((r) => setTimeout(r, 10));

    // Succeed enough times to close
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

    // Trigger OPEN
    try {
      await cb.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    await new Promise((r) => setTimeout(r, 10));

    // Fail in HALF_OPEN
    try {
      await cb.execute(() => Promise.reject(new Error("fail again")));
    } catch { /* expected */ }

    assertEquals(cb.getState(), "OPEN");
  });

  it("should reset failure count on success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, name: "test-reset" });

    // Two failures
    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    // One success resets count
    await cb.execute(() => Promise.resolve("ok"));

    // Two more failures shouldn't trigger OPEN
    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
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
