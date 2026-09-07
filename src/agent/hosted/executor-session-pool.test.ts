import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExecutorChannel } from "../executor/channel.ts";
import { createClockDeadlineTimer } from "../streaming/lifecycle/deadlines.ts";
import { ManualMonotonicClock } from "../streaming/lifecycle/testing.ts";
import type {
  HostedExecutorSession,
  HostedExecutorSessionCloseResult,
  HostedExecutorSessionOptions,
} from "./executor-session.ts";
import {
  createHostedExecutorSessionPool,
  type HostedExecutorSessionPool,
} from "./executor-session-pool.ts";

function sessionDouble() {
  const closed = Promise.withResolvers<HostedExecutorSessionCloseResult>();
  const settled = Promise.withResolvers<void>();
  const controller = new AbortController();
  let closeCalls = 0;
  const session: HostedExecutorSession = {
    ready: Promise.withResolvers<ExecutorChannel>().promise,
    closed: closed.promise,
    settled: settled.promise,
    signal: controller.signal,
    binding: undefined,
    accepted: false,
    accept() {},
    close() {
      closeCalls++;
      controller.abort();
      return closed.promise;
    },
  };
  return {
    session,
    closed,
    settled,
    get closeCalls() {
      return closeCalls;
    },
    finish(release: HostedExecutorSessionCloseResult["release"] = "released") {
      closed.resolve({ reason: "canceled", release });
      settled.resolve();
    },
  };
}

const sessionOptions: HostedExecutorSessionOptions = {
  request: {
    allocationId: "11111111-1111-4111-8111-111111111111",
    invocationId: "22222222-2222-4222-8222-222222222222",
    projectId: "project-test",
    source: { type: "release", releaseId: "release-test" },
    requestedAt: 1000,
    prepareDeadlineAt: 2000,
    hardDeadlineAt: 3000,
  },
  expectedBrokerInstanceId: "broker-test",
  expectedImage: `registry.example.test/executor@sha256:${"a".repeat(64)}`,
  allocator: {
    allocate() {
      throw new Error("Synthetic allocation must not be called");
    },
    observe() {
      throw new Error("Synthetic observation must not be called");
    },
    renew() {
      throw new Error("Synthetic renewal must not be called");
    },
    release() {
      throw new Error("Synthetic release must not be called");
    },
  },
  connectTransport() {
    throw new Error("Synthetic transport must not be called");
  },
  createOperations: () => ({ operations: new Map(), revoke() {} }),
  clock: { now: () => 1000, ...createClockDeadlineTimer(new ManualMonotonicClock()) },
};

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("hosted executor session pool", () => {
  it("retains admission after bounded session close until underlying work settles", async () => {
    const first = sessionDouble();
    const second = sessionDouble();
    let creations = 0;
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => (++creations === 1 ? first : second).session,
    });
    assertEquals(pool.start(sessionOptions), first.session);
    first.closed.resolve({ reason: "canceled", release: "reaper-required" });
    await tick();
    assertEquals(pool.active, 1);
    assertThrows(() => pool.start(sessionOptions), Error, "capacity");
    assertEquals(creations, 1);
    first.settled.resolve();
    await tick();
    assertEquals(pool.active, 0);
    assertEquals(pool.start(sessionOptions), second.session);
    const closed = pool.shutdown();
    second.finish();
    assertEquals((await closed).release, "released");
    await pool.settled;
    assertEquals(pool.active, 0);
  });

  it("reserves capacity before a reentrant session factory starts another allocation", async () => {
    const fake = sessionDouble();
    let insideActive = 0;
    const pool: HostedExecutorSessionPool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => {
        insideActive = pool.active;
        assertThrows(() => pool.start(sessionOptions), Error, "capacity");
        return fake.session;
      },
    });
    pool.start(sessionOptions);
    assertEquals(insideActive, 1);
    fake.finish();
    await pool.shutdown();
    await pool.settled;
  });

  it("releases a failed constructor reservation and permits another start", async () => {
    const fake = sessionDouble();
    let fail = true;
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => {
        if (fail) throw new Error("Synthetic constructor failure");
        return fake.session;
      },
    });
    assertThrows(() => pool.start(sessionOptions), Error, "Synthetic constructor failure");
    assertEquals(pool.active, 0);
    fail = false;
    assertEquals(pool.start(sessionOptions), fake.session);
    fake.finish();
    await pool.shutdown();
    await pool.settled;
  });

  it("fences starts and closes a session returned during synchronous shutdown", async () => {
    const fake = sessionDouble();
    let shutdownResult: ReturnType<HostedExecutorSessionPool["shutdown"]> | undefined;
    const pool: HostedExecutorSessionPool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => {
        shutdownResult = pool.shutdown();
        assertEquals(pool.active, 1);
        assertThrows(() => pool.start(sessionOptions), Error, "shut down");
        return fake.session;
      },
    });
    assertThrows(() => pool.start(sessionOptions), Error, "shut down");
    assertEquals(fake.closeCalls, 1);
    assertEquals(fake.session.signal.aborted, true);
    assertEquals(pool.active, 1);
    fake.finish();
    assertEquals((await shutdownResult!).release, "released");
    await pool.settled;
    assertEquals(pool.active, 0);
  });

  it("releases a constructor that shuts down and then throws", async () => {
    const pool: HostedExecutorSessionPool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => {
        void pool.shutdown();
        throw new Error("Synthetic constructor failure");
      },
    });
    assertThrows(() => pool.start(sessionOptions), Error, "Synthetic constructor failure");
    assertEquals(await pool.closed, { release: "not-allocated", pending: 0 });
    await pool.settled;
  });

  it("bounds shutdown notification while retaining sessions with pending cleanup", async () => {
    const clock = new ManualMonotonicClock();
    const fake = sessionDouble();
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      shutdownTimeoutMs: 100,
      timer: createClockDeadlineTimer(clock),
      createSession: () => fake.session,
    });
    pool.start(sessionOptions);
    const closed = pool.shutdown();
    assertEquals(pool.shutdown(), closed);
    assertEquals(fake.closeCalls, 1);
    assertEquals(pool.signal.aborted, true);
    clock.advanceBy(100);
    assertEquals(await closed, { release: "reaper-required", pending: 1 });
    assertThrows(() => pool.start(sessionOptions), Error, "shut down");
    let retired = false;
    void pool.settled.then(() => {
      retired = true;
    });
    await tick();
    assertEquals(retired, false);
    fake.finish();
    await pool.settled;
    assertEquals(retired, true);
    assertEquals(pool.active, 0);
    assertEquals(clock.pendingWaitCount, 0);
    assertEquals(await pool.closed, { release: "reaper-required", pending: 1 });
  });

  it("reports acknowledged allocation release while still waiting for raw session work", async () => {
    const fake = sessionDouble();
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => fake.session,
    });
    pool.start(sessionOptions);
    const closed = pool.shutdown();
    fake.closed.resolve({ reason: "canceled", release: "released" });
    assertEquals(await closed, { release: "released", pending: 1 });
    assertEquals(pool.active, 1);
    fake.settled.resolve();
    await pool.settled;
  });

  it("preserves per-session ownership and adds an independent shutdown owner", async () => {
    const first = sessionDouble();
    const second = sessionDouble();
    const owner = new AbortController();
    const shutdown = new AbortController();
    const signals: AbortSignal[] = [];
    const pool = createHostedExecutorSessionPool({
      maxActive: 2,
      signal: shutdown.signal,
      createSession: (options) => {
        signals.push(options.ownerSignal!);
        return (signals.length === 1 ? first : second).session;
      },
    });
    pool.start({ ...sessionOptions, ownerSignal: owner.signal });
    pool.start(sessionOptions);
    owner.abort();
    assertEquals(signals.map((signal) => signal.aborted), [true, false]);
    assertEquals(pool.signal.aborted, false);
    shutdown.abort();
    assertEquals(signals.map((signal) => signal.aborted), [true, true]);
    assertEquals([first.closeCalls, second.closeCalls], [1, 1]);
    first.finish();
    second.finish();
    await pool.closed;
    await pool.settled;
  });

  it("never invokes the factory after shutdown was already requested", async () => {
    const shutdown = new AbortController();
    shutdown.abort();
    let calls = 0;
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      signal: shutdown.signal,
      createSession: () => {
        calls++;
        return sessionDouble().session;
      },
    });
    assertThrows(() => pool.start(sessionOptions), Error, "shut down");
    assertEquals(calls, 0);
    assertEquals(await pool.closed, { release: "not-allocated", pending: 0 });
    await pool.settled;
  });

  it("uses the real session by default and retires already canceled preparation", async () => {
    const preparation = new AbortController();
    preparation.abort();
    const pool = createHostedExecutorSessionPool({ maxActive: 1 });
    const session = pool.start({ ...sessionOptions, preparationSignal: preparation.signal });
    assertEquals((await session.closed).release, "not-allocated");
    await session.settled;
    await tick();
    assertEquals(pool.active, 0);
    assertEquals(await pool.shutdown(), { release: "not-allocated", pending: 0 });
    await pool.settled;
  });

  it("allows bounded reentrant creation while counting both constructor reservations", async () => {
    const first = sessionDouble();
    const second = sessionDouble();
    let creations = 0;
    const pool: HostedExecutorSessionPool = createHostedExecutorSessionPool({
      maxActive: 2,
      createSession: () => {
        if (++creations === 1) {
          assertEquals(pool.start(sessionOptions), second.session);
          return first.session;
        }
        assertEquals(pool.active, 2);
        assertThrows(() => pool.start(sessionOptions), Error, "capacity");
        return second.session;
      },
    });
    assertEquals(pool.start(sessionOptions), first.session);
    assertEquals(pool.active, 2);
    const closed = pool.shutdown();
    first.finish();
    second.finish("reaper-required");
    assertEquals((await closed).release, "reaper-required");
    await pool.settled;
  });

  it("closes a newly created session when its factory cancels the pool owner", async () => {
    const shutdown = new AbortController();
    const fake = sessionDouble();
    let factorySignal: AbortSignal | undefined;
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      signal: shutdown.signal,
      createSession: (options) => {
        factorySignal = options.ownerSignal;
        shutdown.abort();
        return fake.session;
      },
    });
    assertThrows(() => pool.start(sessionOptions), Error, "shut down");
    assertEquals(factorySignal?.aborted, true);
    assertEquals(fake.closeCalls, 1);
    assertEquals(pool.active, 1);
    fake.finish();
    await pool.closed;
    await pool.settled;
  });

  for (const failure of ["throw", "reject"] as const) {
    it(`contains a session close ${failure} while retaining its retirement slot`, async () => {
      const fake = sessionDouble();
      fake.session.close = () => {
        const error = new Error("Synthetic close error");
        if (failure === "throw") throw error;
        return Promise.reject(error);
      };
      const pool = createHostedExecutorSessionPool({
        maxActive: 1,
        createSession: () => fake.session,
      });
      pool.start(sessionOptions);
      assertEquals(await pool.shutdown(), { release: "reaper-required", pending: 1 });
      assertEquals(pool.active, 1);
      fake.finish();
      await pool.settled;
      assertEquals(pool.active, 0);
    });
  }

  it("fails closed on rejected retirement without recycling uncertain capacity", async () => {
    const fake = sessionDouble();
    const pool = createHostedExecutorSessionPool({
      maxActive: 1,
      createSession: () => fake.session,
    });
    pool.start(sessionOptions);
    const rejected = assertRejects(() => pool.settled, Error, "retirement failed");
    fake.settled.reject(new Error("Synthetic private retirement detail"));
    await rejected;
    assertEquals(await pool.closed, { release: "reaper-required", pending: 1 });
    assertEquals(pool.active, 1);
    assertThrows(() => pool.start(sessionOptions), Error, "shut down");
    fake.closed.resolve({ reason: "failed", release: "reaper-required" });
  });

  it("rejects unbounded admission and notification limits before any creation", () => {
    for (const maxActive of [0, -1, 1.5, Infinity, NaN, 257]) {
      assertThrows(() => createHostedExecutorSessionPool({ maxActive }), TypeError);
    }
    for (const shutdownTimeoutMs of [0, -1, 1.5, Infinity, NaN, 30_001]) {
      assertThrows(
        () => createHostedExecutorSessionPool({ maxActive: 1, shutdownTimeoutMs }),
        TypeError,
      );
    }
  });

  it("holds a real allocation through late cleanup and never allocates after shutdown", async () => {
    const clock = new ManualMonotonicClock();
    const timer = createClockDeadlineTimer(clock);
    const allocation = Promise.withResolvers<unknown>();
    let allocations = 0;
    const pool = createHostedExecutorSessionPool({ maxActive: 1, shutdownTimeoutMs: 100, timer });
    pool.start({
      ...sessionOptions,
      clock: { now: () => 1000 + clock.nowMs(), ...timer },
      cleanupTimeoutMs: 50,
      allocator: {
        ...sessionOptions.allocator,
        allocate() {
          allocations++;
          return allocation.promise;
        },
      },
    });
    assertEquals(allocations, 1);
    const closed = pool.shutdown();
    clock.advanceBy(50);
    assertEquals(await closed, { release: "reaper-required", pending: 1 });
    assertThrows(() => pool.start(sessionOptions), Error, "shut down");
    assertEquals(allocations, 1);
    allocation.resolve({
      binding: {
        allocationId: sessionOptions.request.allocationId,
        invocationId: sessionOptions.request.invocationId,
        projectId: sessionOptions.request.projectId,
        source: sessionOptions.request.source,
        generation: 1,
        brokerInstanceId: sessionOptions.expectedBrokerInstanceId,
      },
      phase: "preparing",
      expiresAt: 2000,
    });
    await pool.settled;
    assertEquals(pool.active, 0);
    assertEquals(allocations, 1);
    assertEquals(clock.pendingWaitCount, 0);
  });
});
