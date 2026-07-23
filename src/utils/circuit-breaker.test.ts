import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CircuitBreaker,
  CircuitBreakerOpen,
  createCircuitBreakerRegistry,
  getCircuitBreaker,
} from "./circuit-breaker.ts";

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
  it("rejects invalid thresholds and reset delays", () => {
    for (
      const value of [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(() => new CircuitBreaker({ failureThreshold: value }), RangeError);
      assertThrows(() => new CircuitBreaker({ successThreshold: value }), RangeError);
    }

    for (
      const value of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(() => new CircuitBreaker({ resetTimeoutMs: value }), RangeError);
    }

    new CircuitBreaker({ resetTimeoutMs: 0 });
  });

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

  it("should allow sequential recovery probes above the concurrency limit", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1,
      successThreshold: 4,
      name: "test-sequential-recovery",
    });

    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    await sleep(10);

    for (let i = 0; i < 4; i++) {
      await cb.execute(() => Promise.resolve("ok"));
    }

    assertEquals(cb.getState(), "CLOSED");
  });

  it("should not reopen when the half-open probe limit is temporarily full", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1,
      name: "test-concurrent-recovery",
    });
    await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    await sleep(10);

    let started = 0;
    let notifyStarted: (() => void) | undefined;
    const allStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = () =>
      cb.execute(async () => {
        started++;
        if (started === 3) notifyStarted?.();
        await gate;
        return "ok";
      });

    const probes = [probe(), probe(), probe()];
    await allStarted;
    await assertRejects(() => probe(), CircuitBreakerOpen);
    assertEquals(cb.getState(), "HALF_OPEN");

    release?.();
    await Promise.all(probes);
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

describe("circuit breaker registry capacity", () => {
  it("rejects unsafe capacities", () => {
    for (const capacity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(() => createCircuitBreakerRegistry(capacity), RangeError);
    }
  });

  it("evicts the least-recently-used closed breaker without exceeding capacity", () => {
    const registry = createCircuitBreakerRegistry(2);
    const first = registry.get("first");
    registry.get("second");
    registry.get("third");

    assertEquals(registry.size, 2);
    assertEquals(registry.get("first") === first, false);
    assertEquals(registry.size, 2);
  });

  it("keeps open breakers and fails closed when no safe eviction exists", async () => {
    const registry = createCircuitBreakerRegistry(2);
    const first = registry.get("open-first", { failureThreshold: 1 });
    const second = registry.get("open-second", { failureThreshold: 1 });
    await ignoreRejection(first.execute(() => Promise.reject(new Error("first failed"))));
    await ignoreRejection(second.execute(() => Promise.reject(new Error("second failed"))));

    assertThrows(() => registry.get("new-service"), CircuitBreakerOpen);
    assertEquals(registry.size, 2);
    assertEquals(registry.get("open-first"), first);
    assertEquals(registry.get("open-second"), second);
  });

  it("does not evict a closed breaker while an execution is in flight", async () => {
    const registry = createCircuitBreakerRegistry(1);
    const breaker = registry.get("in-flight", { failureThreshold: 1 });
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = breaker.execute(async () => {
      notifyStarted?.();
      await gate;
      throw new Error("dependency failed");
    });
    await started;

    assertThrows(() => registry.get("replacement"), CircuitBreakerOpen);
    assertEquals(registry.get("in-flight"), breaker);

    release?.();
    await assertRejects(() => pending, Error, "dependency failed");
    assertEquals(breaker.getState(), "OPEN");
    assertEquals(registry.get("in-flight"), breaker);
  });

  it("preserves accumulated failures when breaker names churn at capacity", async () => {
    const registry = createCircuitBreakerRegistry(1);
    const breaker = registry.get("dependency", { failureThreshold: 2 });

    await assertRejects(
      () => breaker.execute(() => Promise.reject(new Error("first failure"))),
      Error,
      "first failure",
    );
    assertEquals(breaker.getState(), "CLOSED");

    assertThrows(() => registry.get("unrelated-dependency"), CircuitBreakerOpen);
    assertEquals(registry.get("dependency"), breaker);

    await assertRejects(
      () => breaker.execute(() => Promise.reject(new Error("second failure"))),
      Error,
      "second failure",
    );
    assertEquals(breaker.getState(), "OPEN");
  });

  it("ages idle partial failures after the documented reset window", async () => {
    let now = 10_000;
    const registry = createCircuitBreakerRegistry(1);
    const breakerOptions = {
      failureThreshold: 2,
      resetTimeoutMs: 100,
      now: () => now,
    };
    const breaker = registry.get("aging-dependency", breakerOptions);

    await assertRejects(
      () => breaker.execute(() => Promise.reject(new Error("transient failure"))),
      Error,
      "transient failure",
    );

    assertThrows(() => registry.get("replacement"), CircuitBreakerOpen);
    now += 99;
    assertThrows(() => registry.get("replacement"), CircuitBreakerOpen);

    now += 1;
    const replacement = registry.get("replacement");
    assertEquals(registry.size, 1);
    assertEquals(registry.get("replacement"), replacement);
  });
});
