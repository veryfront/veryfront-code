import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/index.ts";
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

  it("limits concurrent half-open probes without reopening the circuit", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 0,
      successThreshold: 4,
      name: "half-open-probe-limit",
    });
    await ignoreRejection(cb.execute(() => Promise.reject(new Error("open"))));

    const resolvers: Array<() => void> = [];
    const probes = Array.from({ length: 3 }, () =>
      cb.execute(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      ));
    await Promise.resolve();

    await assertRejects(
      () => cb.execute(() => Promise.resolve()),
      CircuitBreakerOpen,
    );
    assertEquals(cb.getState(), "HALF_OPEN");

    for (const resolve of resolvers) resolve();
    await Promise.all(probes);
    await cb.execute(() => Promise.resolve());
    assertEquals(cb.getState(), "CLOSED");
  });

  it("reopens when a late probe fails after siblings reach the success threshold", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 0,
      successThreshold: 2,
      name: "late-half-open-failure",
    });
    await ignoreRejection(cb.execute(() => Promise.reject(new Error("first"))));
    await ignoreRejection(cb.execute(() => Promise.reject(new Error("second"))));

    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    let rejectThird: ((error: Error) => void) | undefined;
    const first = cb.execute(
      () => new Promise<void>((resolve) => (resolveFirst = resolve)),
    );
    const second = cb.execute(
      () => new Promise<void>((resolve) => (resolveSecond = resolve)),
    );
    const third = cb.execute(
      () => new Promise<void>((_resolve, reject) => (rejectThird = reject)),
    );
    await Promise.resolve();

    resolveFirst?.();
    resolveSecond?.();
    await Promise.all([first, second]);
    assertEquals(cb.getState(), "CLOSED");

    rejectThird?.(new Error("late probe failed"));
    await ignoreRejection(third);
    assertEquals(cb.getState(), "OPEN");
  });

  it("does not extend recovery for a stale probe after a newer failure reopens the circuit", async () => {
    const originalNow = Date.now;
    let now = 100;
    Date.now = () => now;
    try {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 10,
        successThreshold: 1,
        name: "stale-half-open-failure",
      });
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("open"))));

      now = 110;
      let rejectLateProbe: ((error: Error) => void) | undefined;
      const lateProbe = cb.execute(
        () => new Promise<void>((_resolve, reject) => (rejectLateProbe = reject)),
      );
      await cb.execute(() => Promise.resolve());
      assertEquals(cb.getState(), "CLOSED");

      now = 120;
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("new failure"))));
      assertEquals(cb.getState(), "OPEN");

      now = 129;
      rejectLateProbe?.(new Error("stale probe failure"));
      await ignoreRejection(lateProbe);

      now = 130;
      await cb.execute(() => Promise.resolve());
      assertEquals(cb.getState(), "CLOSED");
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects invalid options", () => {
    for (const failureThreshold of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new CircuitBreaker({ failureThreshold }),
        Error,
        "positive safe integer",
      );
    }
    for (const successThreshold of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new CircuitBreaker({ successThreshold }),
        Error,
        "positive safe integer",
      );
    }
    for (const resetTimeoutMs of [-1, 1.5, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new CircuitBreaker({ resetTimeoutMs }),
        Error,
        "non-negative safe integer",
      );
    }
  });

  it("sanitizes unreadable options", () => {
    const privateValue = "private-breaker-option";
    const options = Object.defineProperty({}, "failureThreshold", {
      get() {
        throw new Error(privateValue);
      },
    });

    assertThrows(
      () => new CircuitBreaker(options),
      Error,
      "Circuit breaker options are not readable",
    );
  });

  it("does not write the breaker name to transition logs", async () => {
    const privateName = "private-project-breaker";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    try {
      const cb = new CircuitBreaker({ failureThreshold: 1, name: privateName });
      await ignoreRejection(cb.execute(() => Promise.reject(new Error("fail"))));
    } finally {
      __resetLogRecordEmitterForTests();
    }

    assert(!JSON.stringify(entries).includes(privateName));
  });
});

describe("CircuitBreakerOpen", () => {
  it("should include breaker name and retry info", () => {
    const error = new CircuitBreakerOpen("my-breaker", 5000);
    assertEquals(error.breakerName, "my-breaker");
    assertEquals(error.nextAttemptMs, 5000);
    assertEquals(error.name, "CircuitBreakerOpen");
    assertEquals(error.message.includes("my-breaker"), false);
    assertEquals(JSON.stringify(error).includes("my-breaker"), false);
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

  it("rejects conflicting configurations for an existing name", () => {
    getCircuitBreaker("breaker-configuration-conflict", {
      failureThreshold: 2,
      resetTimeoutMs: 10,
      successThreshold: 2,
    });

    assertThrows(
      () =>
        getCircuitBreaker("breaker-configuration-conflict", {
          failureThreshold: 3,
          resetTimeoutMs: 10,
          successThreshold: 2,
        }),
      Error,
      "already configured",
    );
  });

  it("evicts idle entries instead of exceeding the registry cap", async () => {
    const isolated = await import("./circuit-breaker.ts?registry-cap-test");
    const first = isolated.getCircuitBreaker("bounded-breaker-registry-0");
    for (let index = 1; index <= 1_010; index++) {
      isolated.getCircuitBreaker(`bounded-breaker-registry-${index}`);
    }

    assert(isolated.getCircuitBreaker("bounded-breaker-registry-0") !== first);
  });
});
