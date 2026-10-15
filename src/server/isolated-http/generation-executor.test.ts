import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ManualMonotonicClock } from "#veryfront/agent/streaming/lifecycle/testing.ts";
import { createHostedExecutorSessionClock } from "#veryfront/agent/hosted/executor-session.ts";
import { createHostedExecutorSessionPool } from "#veryfront/agent/hosted/executor-session-pool.ts";
import { createHostedHttpFixture as fixture } from "../../../tests/fixtures/hosted-http-broker.ts";
import { createHostedHttpBroker } from "./hosted-http-broker.ts";
import {
  createHostedHttpGenerationExecutor,
  hostedHttpInstallationKey,
  prepareHostedHttpInput,
} from "./generation-executor.ts";

const count = (calls: string[], name: string) => calls.filter((call) => call === name).length;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Keep allocation timestamps and session timers on the same controlled clock. */
function timedFixture(time: FakeTime, ...args: Parameters<typeof fixture>) {
  const f = fixture(...args);
  f.input.session.clock = {
    now: () => time.now,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
  return f;
}

/** A fixture whose handler signals when a request arrives and answers when told to. */
function heldFixture(projectId?: string) {
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<Response>();
  const f = fixture(
    () => {
      entered.resolve();
      return held.promise;
    },
    undefined,
    projectId,
  );
  return { ...f, entered: entered.promise, respond: held.resolve };
}

function configuration(variables: Record<string, string>) {
  return {
    projectId: "project-a",
    projectSlug: "project-a",
    releaseId: "release-a",
    environmentId: "environment-a",
    environmentName: "staging",
    configurationId: "config-a",
    variables,
  };
}

describe("hosted HTTP generation broker", () => {
  it("serves sequential and concurrent requests from one allocation and installation", async () => {
    let served = 0;
    const f = fixture(() => new Response(`response-${++served}`));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      for (let index = 1; index <= 3; index++) {
        const response = await broker.fetch(new Request("https://app.example/api"), f.input);
        assertEquals(await response.text(), `response-${index}`);
      }
      const concurrent = await Promise.all([
        broker.fetch(new Request("https://app.example/api"), f.input),
        broker.fetch(new Request("https://app.example/api"), f.input),
      ]);
      assertEquals((await Promise.all(concurrent.map((r) => r.text()))).length, 2);
      assertEquals(f.calls, ["allocate", "install"]);
      assertEquals(broker.active, 1);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
    assertEquals(count(f.calls, "release:canceled"), 1);
  });

  it("refuses global HTTP owners before allocation under the existing installation contract", async () => {
    const f = fixture(() => new Response("must not dispatch"));
    const owner = { scopeKind: "global" as const, serviceName: "service-a" };
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await assertRejects(
        () =>
          broker.fetch(new Request("https://app.example"), {
            ...f.input,
            session: { ...f.input.session, request: { ...f.input.session.request, owner } },
            installation: { ...f.input.installation, owner },
          }),
        TypeError,
        "Invalid executor installation",
      );
      assertEquals(f.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("keeps installations of different projects on separate allocations", async () => {
    const a = fixture(() => new Response("a"));
    const b = fixture(() => new Response("b"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      for (let round = 0; round < 2; round++) {
        assertEquals(
          await (await broker.fetch(new Request("https://a.example"), a.input)).text(),
          "a",
        );
        assertEquals(
          await (await broker.fetch(new Request("https://b.example"), b.input)).text(),
          "b",
        );
      }
      assertEquals(a.calls, ["allocate", "install"]);
      assertEquals(b.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses to rebind a warm executor to a different installation with the same identity", async () => {
    const f = fixture(() => new Response("installed"));
    f.input.configuration = configuration({ APP_VALUE: "first" });
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      const first = await broker.fetch(new Request("https://app.example"), f.input);
      assertEquals(await first.text(), "installed");
      await assertRejects(
        () =>
          broker.fetch(new Request("https://app.example"), {
            ...f.input,
            configuration: configuration({ APP_VALUE: "second" }),
          }),
        TypeError,
        "another installation",
      );
      const again = await broker.fetch(new Request("https://app.example"), f.input);
      assertEquals(await again.text(), "installed");
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses a different authenticated broker identity on a warm executor", async () => {
    let served = 0;
    const f = fixture(() => new Response(`response-${++served}`));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "response-1",
      );
      await assertRejects(
        () =>
          broker.fetch(new Request("https://app.example"), {
            ...f.input,
            session: { ...f.input.session, expectedBrokerInstanceId: "broker-b" },
          }),
        TypeError,
        "another installation",
      );
      assertEquals(served, 1);
      assertEquals(f.calls, ["allocate", "install"]);
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "response-2",
      );
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("drains the previous generation of an environment when its release changes", async () => {
    let finishOld: (() => void) | undefined;
    const old = fixture(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("old-"));
            finishOld = () => {
              controller.enqueue(new TextEncoder().encode("done"));
              controller.close();
            };
          },
        }),
      )
    );
    const next = fixture(() => new Response("new"));
    next.input.installation.configurationId = "config-b";
    // The previous release's request began authorization earlier.
    old.input.session.request.requestedAt -= 1_000;
    const broker = createHostedHttpBroker({ maxActive: 2, drainTimeoutMs: 10_000 });
    try {
      const pending = await broker.fetch(new Request("https://app.example/old"), old.input);
      const response = await broker.fetch(new Request("https://app.example/new"), next.input);
      assertEquals(await response.text(), "new");
      await tick();
      assertEquals(old.calls, ["allocate", "install"]);
      const text = pending.text();
      finishOld!();
      assertEquals(await text, "old-done");
      await old.releaseEntered.promise;
      assertEquals(old.calls, ["allocate", "install", "release:completed"]);
      assertEquals(next.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("does not let a request authorized earlier replace a newer generation", async () => {
    const stale = fixture(() => new Response("stale"));
    stale.input.session.request.requestedAt -= 1_000;
    const current = fixture(() => new Response("current"));
    current.input.installation.configurationId = "config-b";
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), current.input)).text(),
        "current",
      );
      await assertRejects(
        () => broker.fetch(new Request("https://app.example"), stale.input),
        Error,
        "newer generation",
      );
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), current.input)).text(),
        "current",
      );
      assertEquals(stale.calls, []);
      assertEquals(current.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("keeps the current generation when another begins authorization in the same millisecond", async () => {
    const current = fixture(() => new Response("current"));
    const other = fixture(() => new Response("other"));
    other.input.installation.configurationId = "config-b";
    other.input.session.request.requestedAt = current.input.session.request.requestedAt;
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), current.input)).text(),
        "current",
      );
      await assertRejects(
        () => broker.fetch(new Request("https://app.example"), other.input),
        Error,
        "newer generation",
      );
      assertEquals(other.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("does not restore an older generation after the newer one retires", async () => {
    const stale = fixture(() => new Response("stale"));
    stale.input.session.request.requestedAt -= 1_000;
    const current = fixture(() => new Response("current"));
    current.input.installation.configurationId = "config-b";
    const broker = createHostedHttpBroker({ maxActive: 1, idleTimeoutMs: 10 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), current.input)).text(),
        "current",
      );
      await current.releaseEntered.promise;
      assertEquals(broker.generations, 0);
      await assertRejects(
        () => broker.fetch(new Request("https://app.example"), stale.input),
        Error,
        "newer generation",
      );
      assertEquals(stale.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("releases a generation stopped with requests in flight as canceled", async () => {
    const old = fixture(() => new Response(new ReadableStream<Uint8Array>({})));
    const next = fixture(() => new Response("new"));
    next.input.installation.configurationId = "config-b";
    // The previous release's request began authorization earlier.
    old.input.session.request.requestedAt -= 1_000;
    const broker = createHostedHttpBroker({ maxActive: 2, drainTimeoutMs: 0 });
    try {
      const pending = await broker.fetch(new Request("https://app.example/old"), old.input);
      const outcome = pending.text().then(() => "completed", () => "failed");
      assertEquals(
        await (await broker.fetch(new Request("https://app.example/new"), next.input)).text(),
        "new",
      );
      await old.releaseEntered.promise;
      assertEquals(old.calls, ["allocate", "install", "release:canceled"]);
      assertEquals(await outcome, "failed");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("errors an unfinished response body when its request aborts", async () => {
    const f = fixture(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("prefix"));
          },
        }, { highWaterMark: 0 }),
      )
    );
    const broker = createHostedHttpBroker({ maxActive: 1 });
    const abort = new AbortController();
    try {
      const response = await broker.fetch(
        new Request("https://app.example", { signal: abort.signal }),
        f.input,
      );
      const reader = response.body!.getReader();
      assertEquals(new TextDecoder().decode((await reader.read()).value), "prefix");
      const pending = reader.read();
      abort.abort(new Error("Client disconnected"));
      await assertRejects(() => pending, Error, "Client disconnected");
    } finally {
      abort.abort();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("honors each caller's owner signal on a warm executor", async () => {
    const f = fixture(() => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      const owner = new AbortController();
      owner.abort(new Error("Owner stopped"));
      await assertRejects(
        () =>
          broker.fetch(new Request("https://app.example"), {
            ...f.input,
            session: { ...f.input.session, ownerSignal: owner.signal },
          }),
        Error,
        "Owner stopped",
      );
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("does not end other callers' requests when the first caller's owner signal aborts", async () => {
    const gate = Promise.withResolvers<void>();
    let arrived = 0;
    const both = Promise.withResolvers<void>();
    const f = fixture(async () => {
      if (++arrived === 2) both.resolve();
      await gate.promise;
      return new Response("served");
    });
    const owner = new AbortController();
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      // The first caller creates the executor under its own owner signal.
      const first = broker.fetch(new Request("https://app.example"), {
        ...f.input,
        session: { ...f.input.session, ownerSignal: owner.signal },
      });
      first.catch(() => {});
      const second = broker.fetch(new Request("https://app.example"), f.input);
      await both.promise;
      owner.abort(new Error("Owner stopped"));
      await assertRejects(() => first);
      gate.resolve();
      assertEquals(await (await second).text(), "served");
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      gate.resolve();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("ends a warm request at its own allocation deadline without retiring the executor", async () => {
    using time = new FakeTime(1_000_000);
    const gate = Promise.withResolvers<void>();
    let arrived = 0;
    const f = timedFixture(time, async () => {
      if (++arrived === 2) await gate.promise;
      return new Response("served");
    });
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      // This request's authority ends long before the allocation that created the executor.
      const now = Date.now();
      const rejected = assertRejects(() =>
        broker.fetch(new Request("https://app.example"), {
          ...f.input,
          session: {
            ...f.input.session,
            request: {
              ...f.input.session.request,
              requestedAt: now,
              prepareDeadlineAt: now + 100,
              hardDeadlineAt: now + 150,
            },
          },
        })
      );
      await time.tickAsync(150);
      await rejected;
      gate.resolve();
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      gate.resolve();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("checks deadlines against the session clock a caller configured", async () => {
    const time = new ManualMonotonicClock();
    const clock = createHostedExecutorSessionClock(1_000_000, time);
    const f = fixture(() => new Response("served"));
    f.input.session.clock = clock;
    // The fixture's allocator stamps expiry in wall time; restate it on the host clock.
    const allocator = f.input.session.allocator;
    const restamp = <T>(view: T): T => ({ ...(view as object), expiresAt: 1_030_000 }) as T;
    f.input.session.allocator = {
      allocate: async (...args) => restamp(await allocator.allocate(...args)),
      observe: async (...args) => restamp(await allocator.observe(...args)),
      renew: async (...args) => restamp(await allocator.renew(...args)),
      release: async (...args) => restamp(await allocator.release(...args)),
    };
    f.input.session.request.requestedAt = 1_000_000;
    f.input.session.request.prepareDeadlineAt = 1_005_000;
    f.input.session.request.hardDeadlineAt = 1_030_000;
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      for (let round = 0; round < 2; round++) {
        assertEquals(
          await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
          "served",
        );
      }
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("expires an in-flight request when the configured clock reaches its deadline", async () => {
    const time = new ManualMonotonicClock();
    const clock = createHostedExecutorSessionClock(1_000_000, time);
    const entered = Promise.withResolvers<void>();
    let calls = 0;
    const f = fixture(() => {
      if (++calls === 1) return new Response("warm");
      entered.resolve();
      return new Promise<Response>(() => {});
    });
    f.input.session.clock = clock;
    const allocator = f.input.session.allocator;
    const restamp = <T>(view: T): T => ({ ...(view as object), expiresAt: 1_030_000 }) as T;
    f.input.session.allocator = {
      allocate: async (...args) => restamp(await allocator.allocate(...args)),
      observe: async (...args) => restamp(await allocator.observe(...args)),
      renew: async (...args) => restamp(await allocator.renew(...args)),
      release: async (...args) => restamp(await allocator.release(...args)),
    };
    f.input.session.request.requestedAt = 1_000_000;
    f.input.session.request.prepareDeadlineAt = 1_005_000;
    f.input.session.request.hardDeadlineAt = 1_030_000;
    const broker = createHostedHttpBroker({ maxActive: 1, drainTimeoutMs: 0 });
    try {
      await (await broker.fetch(new Request("https://app.example"), f.input)).text();
      f.input.session.request.hardDeadlineAt = 1_020_000;
      const pending = broker.fetch(new Request("https://app.example"), f.input);
      const rejected = assertRejects(() => pending, Error, "cancelled");
      await entered.promise;
      let finished = false;
      void pending.then(() => {
        finished = true;
      }, () => {
        finished = true;
      });
      time.advanceBy(19_999);
      await tick();
      assertEquals(finished, false);
      time.advanceBy(1);
      await rejected;
      assertEquals(clock.now(), 1_020_000);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses a warm request stamped in the future without moving generation order", async () => {
    using time = new FakeTime(1_000_000);
    const f = timedFixture(time, () => new Response("served"));
    const next = timedFixture(time, () => new Response("next"));
    next.input.installation.configurationId = "config-b";
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      const now = Date.now();
      await assertRejects(
        () =>
          broker.fetch(new Request("https://app.example"), {
            ...f.input,
            session: {
              ...f.input.session,
              request: {
                ...f.input.session.request,
                requestedAt: now + 60_000,
                prepareDeadlineAt: now + 61_000,
                hardDeadlineAt: now + 62_000,
              },
            },
          }),
        TypeError,
        "expired or unbounded",
      );
      // A release change authorized now is still ordered after the warm generation.
      next.input.session.request.requestedAt = Date.now() + 1;
      time.tick(1);
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), next.input)).text(),
        "next",
      );
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("ends a cold request that is cancelled while it waits for a slot", async () => {
    const idle = fixture(() => new Response("idle"));
    idle.holdRelease();
    const cold = fixture(() => new Response("cold"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await (await broker.fetch(new Request("https://a.example"), idle.input)).text();
      const caller = new AbortController();
      const waiting = broker.fetch(
        new Request("https://b.example", { signal: caller.signal }),
        cold.input,
      );
      waiting.catch(() => {});
      await idle.releaseEntered.promise;
      caller.abort(new Error("caller left"));
      // The request ends now, although the retirement it waited for is still held.
      await assertRejects(() => waiting, Error, "caller left");
      assertEquals(cold.calls, []);
      idle.releaseAllowed.resolve();
    } finally {
      idle.releaseAllowed.resolve();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses a request whose own allocation deadline has passed, also on a warm executor", async () => {
    const f = fixture(() => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      const now = Date.now();
      await assertRejects(
        () =>
          broker.fetch(new Request("https://app.example"), {
            ...f.input,
            session: {
              ...f.input.session,
              request: {
                ...f.input.session.request,
                requestedAt: now - 3_000,
                prepareDeadlineAt: now - 2_000,
                hardDeadlineAt: now - 1_000,
              },
            },
          }),
        Error,
        "deadline",
      );
      // The executor keeps serving requests whose authority is current.
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("fails an aborted request without retiring its executor", async () => {
    const entered = Promise.withResolvers<void>();
    const f = fixture(async (request) => {
      if (new URL(request.url).pathname === "/wait") {
        entered.resolve();
        await new Promise<void>((resolve) =>
          request.signal.addEventListener("abort", () => resolve(), { once: true })
        );
        request.signal.throwIfAborted();
      }
      return new Response("served");
    });
    const broker = createHostedHttpBroker({ maxActive: 1 });
    const controller = new AbortController();
    try {
      const pending = broker.fetch(
        new Request("https://app.example/wait", { signal: controller.signal }),
        f.input,
      );
      const rejected = assertRejects(() => pending);
      await entered.promise;
      controller.abort();
      await rejected;
      const response = await broker.fetch(new Request("https://app.example/next"), f.input);
      assertEquals(await response.text(), "served");
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("replaces an executor whose channel closes", async () => {
    using time = new FakeTime(1_000_000);
    const f = timedFixture(time, () => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      f.crash();
      await f.releaseEntered.promise;
      assertEquals(f.calls.includes("release:canceled"), true);
      await time.runMicrotasks();
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      assertEquals(count(f.calls, "allocate"), 2);
      assertEquals(count(f.calls, "install"), 2);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("retires an idle executor and releases its allocation", async () => {
    using time = new FakeTime(1_000_000);
    const f = timedFixture(time, () => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1, idleTimeoutMs: 10 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      await time.tickAsync(10);
      await f.releaseEntered.promise;
      assertEquals(f.calls, ["allocate", "install", "release:completed"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("releases an invalid installation acknowledgement as canceled without dispatch", async () => {
    let served = 0;
    const f = fixture(
      () => {
        served++;
        return new Response("must not dispatch");
      },
      undefined,
      "project-a",
      { installed: false },
    );
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await assertRejects(
        () => broker.fetch(new Request("https://app.example"), f.input),
        Error,
        "acknowledgement is invalid",
      );
      await f.releaseEntered.promise;
      assertEquals(f.calls, ["allocate", "install", "release:canceled"]);
      assertEquals(served, 0);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("bounds executor preparation by the allocation deadline", async () => {
    using time = new FakeTime(1_000_000);
    const entered = Promise.withResolvers<void>();
    const f = timedFixture(time, () => new Response("unreachable"), () => {
      entered.resolve();
      return new Promise<void>(() => {});
    });
    f.input.session.request.prepareDeadlineAt = Date.now() + 100;
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const rejected = assertRejects(() =>
        broker.fetch(new Request("https://app.example"), f.input)
      );
      await entered.promise;
      await time.tickAsync(100);
      await rejected;
      await f.releaseEntered.promise;
      assertEquals(f.calls.includes("release:canceled"), true);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("retains broker settlement until generation release observation completes", async () => {
    const f = fixture(() => new Response("served"));
    const release = f.input.session.allocator.release;
    const entered = Promise.withResolvers<void>();
    const observed = Promise.withResolvers<Awaited<ReturnType<typeof release>>>();
    f.input.session.allocator.release = () => Promise.reject(new Error("allocator outage"));
    f.input.session.allocator.observe = () => {
      entered.resolve();
      return observed.promise;
    };
    const broker = createHostedHttpBroker({ maxActive: 1 });
    let settled = false;
    try {
      await (await broker.fetch(new Request("https://app.example"), f.input)).text();
      const settlement = broker.settled.then(() => {
        settled = true;
      });
      const shutdown = broker.shutdown();
      await entered.promise;
      await shutdown;
      await tick();
      assertEquals(settled, false, "generation observation still owns allocator work");
      observed.resolve(
        await release(
          {
            ...f.input.session.request,
            generation: 1,
            brokerInstanceId: "broker-a",
            executionProfile: "http",
          },
          "canceled",
          new AbortController().signal,
        ),
      );
      await settlement;
      assertEquals(settled, true);
    } finally {
      observed.resolve(
        await release(
          {
            ...f.input.session.request,
            generation: 1,
            brokerInstanceId: "broker-a",
            executionProfile: "http",
          },
          "canceled",
          new AbortController().signal,
        ),
      );
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("retries an unconfirmed retirement and keeps its capacity until release is confirmed", async () => {
    using time = new FakeTime(1_000_000);
    const a = timedFixture(time, () => new Response("a"));
    const release = a.input.session.allocator.release;
    a.input.session.allocator.release = () =>
      Promise.reject(new Error("synthetic allocator outage"));
    const b = timedFixture(time, () => new Response("b"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 1, idleTimeoutMs: 10 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), a.input)).text(),
        "a",
      );
      await time.tickAsync(10);
      await time.runMicrotasks();
      assertEquals(broker.generations, 0);
      await assertRejects(
        () => broker.fetch(new Request("https://b.example"), b.input),
        Error,
        "capacity",
      );
      assertEquals(b.calls, []);
      a.input.session.allocator.observe = (binding, signal) =>
        release(binding, "completed", signal);
      await time.tickAsync(1_000);
      await time.runMicrotasks();
      assertEquals(
        await (await broker.fetch(new Request("https://b.example"), b.input)).text(),
        "b",
      );
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("stops retirement retries when its owner signal shuts the broker down", async () => {
    using time = new FakeTime(1_000_000);
    const f = timedFixture(time, () => new Response("a"));
    f.input.session.allocator.release = () =>
      Promise.reject(new Error("synthetic allocator outage"));
    let observations = 0;
    const observe = f.input.session.allocator.observe;
    f.input.session.allocator.observe = (binding, signal) => {
      observations++;
      return observe(binding, signal);
    };
    const owner = new AbortController();
    const broker = createHostedHttpBroker({
      maxActive: 1,
      idleTimeoutMs: 10,
      signal: owner.signal,
    });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), f.input)).text(),
        "a",
      );
      await time.tickAsync(10);
      await time.runMicrotasks();
      assertEquals(broker.generations, 0);
      owner.abort();
      await assertRejects(() => broker.settled, AggregateError, "cleanup failed");
      // Shutdown makes one bounded confirmation attempt; no retry follows it.
      const settledObservations = observations;
      await time.tickAsync(2_500);
      await time.runMicrotasks();
      assertEquals(observations, settledObservations);
    } finally {
      await broker.shutdown();
      await assertRejects(() => broker.settled, AggregateError, "cleanup failed");
    }
  });

  it("forgets an environment whose generation was not admitted", async () => {
    // A request in flight keeps its executor, so nothing can be retired to make room.
    const busy = heldFixture();
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      const inFlight = broker.fetch(new Request("https://a.example"), busy.input);
      await busy.entered;
      for (let index = 0; index < 5; index++) {
        const other = fixture(() => new Response("other"), undefined, `project-${index}`);
        await assertRejects(
          () => broker.fetch(new Request("https://other.example"), other.input),
          Error,
          "capacity",
        );
        assertEquals(other.calls, []);
      }
      assertEquals(broker.generations, 1);
      assertEquals(
        count(busy.calls, "release:completed") + count(busy.calls, "release:canceled"),
        0,
      );
      busy.respond(new Response("a"));
      assertEquals(await (await inFlight).text(), "a");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("retires the least recently used idle executor to admit a cold project at capacity", async () => {
    const first = fixture(() => new Response("first"));
    const second = fixture(() => new Response("second"));
    second.input.installation.environmentId = "environment-b";
    const cold = fixture(() => new Response("cold"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 2 });
    try {
      for (const warm of [first, second]) {
        await (await broker.fetch(new Request("https://a.example"), warm.input)).text();
      }
      // Using `first` again makes `second` the least recently used.
      await (await broker.fetch(new Request("https://a.example"), first.input)).text();
      assertEquals(
        await (await broker.fetch(new Request("https://b.example"), cold.input)).text(),
        "cold",
      );
      assertEquals(count(second.calls, "release:completed"), 1);
      assertEquals(count(first.calls, "release:completed"), 0);
      assertEquals(cold.calls, ["allocate", "install"]);
      assertEquals(broker.generations, 2);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("allocates for a cold request only after the retired executor's release is confirmed", async () => {
    using time = new FakeTime(1_000_000);
    const idle = timedFixture(time, () => new Response("idle"));
    idle.holdRelease();
    const cold = timedFixture(time, () => new Response("cold"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await (await broker.fetch(new Request("https://a.example"), idle.input)).text();
      const admitted = broker.fetch(new Request("https://b.example"), cold.input);
      await idle.releaseEntered.promise;
      await time.runMicrotasks();
      assertEquals(cold.calls, []);
      idle.releaseAllowed.resolve();
      assertEquals(await (await admitted).text(), "cold");
      assertEquals(count(idle.calls, "release:completed"), 1);
      assertEquals(cold.calls, ["allocate", "install"]);
    } finally {
      idle.releaseAllowed.resolve();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("does not retire a slot that a concurrent cold request has just reserved", async () => {
    using time = new FakeTime(1_000_000);
    const idle = timedFixture(time, () => new Response("idle"));
    idle.holdRelease();
    const colds = [heldFixture("project-b"), heldFixture("project-c")];
    const next = timedFixture(time, () => new Response("next"), undefined, "project-d");
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await (await broker.fetch(new Request("https://a.example"), idle.input)).text();
      const outcomes = colds.map((f) =>
        broker.fetch(new Request("https://cold.example"), f.input).then(
          (response) => response.text(),
          (error) => error as Error,
        )
      );
      // Hold the retirement until both cold requests wait on it, so both resume together
      // and only one can take the freed slot.
      await idle.releaseEntered.promise;
      await time.runMicrotasks();
      idle.releaseAllowed.resolve();
      const winner = await Promise.race(colds.map((f, index) => f.entered.then(() => index)));
      const loser = 1 - winner;
      // The loser is refused; it must not reach its own executor by retiring the winner's.
      const refused = await Promise.race([
        outcomes[loser]!,
        colds[loser]!.entered.then(() => "served"),
      ]);
      assertEquals(refused instanceof Error && /capacity/.test(refused.message), true);
      assertEquals(colds[loser]!.calls, []);
      colds[winner]!.respond(new Response("cold"));
      assertEquals(await outcomes[winner], "cold");
      assertEquals(colds[winner]!.calls, ["allocate", "install"]);
      assertEquals(broker.generations, 1);
      // The winner's executor is tracked: a later cold request retires it and is admitted.
      assertEquals(
        await (await broker.fetch(new Request("https://d.example"), next.input)).text(),
        "next",
      );
      assertEquals(count(colds[winner]!.calls, "release:completed"), 1);
    } finally {
      idle.releaseAllowed.resolve();
      for (const f of colds) f.respond(new Response("late"));
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses a cold request and keeps the slot when the retired executor's release is unconfirmed", async () => {
    using time = new FakeTime(1_000_000);
    const idle = timedFixture(time, () => new Response("idle"));
    const release = idle.input.session.allocator.release;
    idle.input.session.allocator.release = () =>
      Promise.reject(new Error("synthetic allocator outage"));
    const cold = timedFixture(time, () => new Response("cold"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await (await broker.fetch(new Request("https://a.example"), idle.input)).text();
      for (let attempt = 0; attempt < 2; attempt++) {
        await assertRejects(
          () => broker.fetch(new Request("https://b.example"), cold.input),
          Error,
          "capacity",
        );
      }
      // No second allocation while the first is not known to be released.
      assertEquals(cold.calls, []);
      idle.input.session.allocator.observe = (binding, signal) =>
        release(binding, "completed", signal);
      await time.tickAsync(1_000);
      await time.runMicrotasks();
      assertEquals(
        await (await broker.fetch(new Request("https://b.example"), cold.input)).text(),
        "cold",
      );
      assertEquals(cold.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("bounds one project's warm executors and retires its own before another project's", async () => {
    const other = fixture(() => new Response("other"), undefined, "project-b");
    const environments = ["environment-a", "environment-b", "environment-c"].map((id) => {
      const f = fixture(() => new Response(id));
      f.input.installation.environmentId = id;
      return f;
    });
    const broker = createHostedHttpBroker({ maxActive: 4, maxWarmGenerationsPerProject: 2 });
    try {
      // The other project's executor is the least recently used of all.
      await (await broker.fetch(new Request("https://b.example"), other.input)).text();
      for (const f of environments.slice(0, 2)) {
        await (await broker.fetch(new Request("https://a.example"), f.input)).text();
      }
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), environments[2]!.input)).text(),
        "environment-c",
      );
      assertEquals(count(environments[0]!.calls, "release:completed"), 1);
      assertEquals(count(environments[1]!.calls, "release:completed"), 0);
      assertEquals(count(other.calls, "release:completed"), 0);
      assertEquals(broker.generations, 3);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses a project at its bound whose executors are all serving, without taking another project's", async () => {
    const other = fixture(() => new Response("other"), undefined, "project-b");
    const busy = [heldFixture(), heldFixture()];
    busy[1]!.input.installation.environmentId = "environment-b";
    const third = fixture(() => new Response("third"));
    third.input.installation.environmentId = "environment-c";
    const broker = createHostedHttpBroker({ maxActive: 4, maxWarmGenerationsPerProject: 2 });
    try {
      await (await broker.fetch(new Request("https://b.example"), other.input)).text();
      const inFlight = busy.map((f) => broker.fetch(new Request("https://a.example"), f.input));
      await Promise.all(busy.map((f) => f.entered));
      await assertRejects(
        () => broker.fetch(new Request("https://a.example"), third.input),
        Error,
        "capacity",
      );
      assertEquals(third.calls, []);
      assertEquals(count(other.calls, "release:completed"), 0);
      // The other project is unaffected by this project's bound.
      assertEquals(
        await (await broker.fetch(new Request("https://b.example"), other.input)).text(),
        "other",
      );
      for (const f of busy) f.respond(new Response("done"));
      for (const response of await Promise.all(inFlight)) await response.text();
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("admits a new release for an environment of a project at its bound while the old one drains", async () => {
    const other = fixture(() => new Response("other"), undefined, "project-b");
    const old = heldFixture();
    old.input.session.request.requestedAt -= 1_000;
    const sibling = fixture(() => new Response("sibling"));
    sibling.input.installation.environmentId = "environment-b";
    const next = fixture(() => new Response("next"));
    next.input.installation.configurationId = "config-b";
    const broker = createHostedHttpBroker({ maxActive: 4, maxWarmGenerationsPerProject: 2 });
    try {
      await (await broker.fetch(new Request("https://b.example"), other.input)).text();
      await (await broker.fetch(new Request("https://a.example"), sibling.input)).text();
      const inFlight = broker.fetch(new Request("https://a.example"), old.input);
      await old.entered;
      // The project holds two executors, and the old generation is still serving.
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), next.input)).text(),
        "next",
      );
      old.respond(new Response("old"));
      assertEquals(await (await inFlight).text(), "old");
      await old.releaseEntered.promise;
      assertEquals(count(old.calls, "release:completed"), 1);
      assertEquals(count(sibling.calls, "release:completed"), 0);
      assertEquals(count(other.calls, "release:completed"), 0);
      assertEquals(next.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("refuses a second release change while the environment's previous generation still drains", async () => {
    const first = heldFixture();
    first.input.session.request.requestedAt -= 2_000;
    const second = heldFixture();
    second.input.installation.configurationId = "config-b";
    second.input.session.request.requestedAt -= 1_000;
    const third = fixture(() => new Response("third"));
    third.input.installation.configurationId = "config-c";
    const other = fixture(() => new Response("other"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 4, maxWarmGenerationsPerProject: 1 });
    try {
      await (await broker.fetch(new Request("https://b.example"), other.input)).text();
      const firstInFlight = broker.fetch(new Request("https://a.example"), first.input);
      await first.entered;
      const secondInFlight = broker.fetch(new Request("https://a.example"), second.input);
      await second.entered;
      // Two generations of the environment are live; a third is not admitted.
      await assertRejects(
        () => broker.fetch(new Request("https://a.example"), third.input),
        Error,
        "capacity",
      );
      assertEquals(third.calls, []);
      assertEquals(count(other.calls, "release:completed"), 0);
      first.respond(new Response("first"));
      second.respond(new Response("second"));
      assertEquals(await (await firstInFlight).text(), "first");
      assertEquals(await (await secondInFlight).text(), "second");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("leaves no untracked executor when two releases of an environment start together", async () => {
    using time = new FakeTime(1_000_000);
    const old = timedFixture(time, () => new Response("old"));
    old.input.session.request.requestedAt -= 1_000;
    const next = timedFixture(time, () => new Response("next"));
    next.input.installation.configurationId = "config-b";
    const broker = createHostedHttpBroker({ maxActive: 2, idleTimeoutMs: 60_000 });
    try {
      const outcomes = await Promise.allSettled([
        broker.fetch(new Request("https://a.example"), old.input).then((r) => r.text()),
        broker.fetch(new Request("https://a.example"), next.input).then((r) => r.text()),
      ]);
      // Whatever order the two were admitted in, the newer release is served.
      assertEquals(outcomes[1], { status: "fulfilled", value: "next" });
      // The older release either was refused or drains; it never stays allocated unseen.
      await time.runMicrotasks();
      assertEquals(count(old.calls, "allocate"), count(old.calls, "release:completed"));
      assertEquals(broker.generations, 1);
      assertEquals(broker.active, 1);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("keeps generation order for an environment whose executor was retired to make room", async () => {
    const current = fixture(() => new Response("current"));
    current.input.installation.configurationId = "config-b";
    const stale = fixture(() => new Response("stale"));
    stale.input.session.request.requestedAt = current.input.session.request.requestedAt - 1_000;
    const cold = fixture(() => new Response("cold"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await (await broker.fetch(new Request("https://a.example"), current.input)).text();
      await (await broker.fetch(new Request("https://b.example"), cold.input)).text();
      assertEquals(count(current.calls, "release:completed"), 1);
      await assertRejects(
        () => broker.fetch(new Request("https://a.example"), stale.input),
        Error,
        "newer generation",
      );
      assertEquals(stale.calls, []);
      // The same generation is admitted again, retiring the idle cold executor.
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), current.input)).text(),
        "current",
      );
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("keeps generation order for an environment that is no longer tracked", async () => {
    const current = fixture(() => new Response("current"));
    current.input.installation.configurationId = "config-b";
    const at = current.input.session.request.requestedAt -= 1_000;
    const stale = fixture(() => new Response("stale"));
    stale.input.session.request.requestedAt = at - 1_000;
    // Authorized after `current`, at this fixture's own creation time.
    const later = fixture(() => new Response("later"));
    const other = fixture(() => new Response("other"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 2, maxTrackedEnvironments: 1 });
    try {
      await (await broker.fetch(new Request("https://a.example"), current.input)).text();
      // Tracking the other environment drops the first one's order record.
      await (await broker.fetch(new Request("https://b.example"), other.input)).text();
      await assertRejects(
        () => broker.fetch(new Request("https://a.example"), stale.input),
        Error,
        "newer generation",
      );
      assertEquals(stale.calls, []);
      // An authorization that began after the dropped record is still admitted.
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), later.input)).text(),
        "later",
      );
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("shares an executor between equivalent header policies", async () => {
    const f = fixture(() => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      for (const denyHeaders of [["X-Internal", "x-other"], ["x-other", "x-internal", "X-OTHER"]]) {
        const response = await broker.fetch(new Request("https://app.example"), {
          ...f.input,
          headers: { denyHeaders },
        });
        assertEquals(await response.text(), "served");
      }
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("keeps an invalid header policy apart from the valid policy it repeats", () => {
    const f = fixture(() => new Response("unused"));
    const valid = prepareHostedHttpInput({ ...f.input, headers: { denyHeaders: ["X-Internal"] } });
    const invalid = prepareHostedHttpInput({
      ...f.input,
      headers: { denyHeaders: Array.from({ length: 33 }, () => "X-Internal") },
    });
    assertEquals(hostedHttpInstallationKey(valid) === hostedHttpInstallationKey(invalid), false);
  });

  it("does not allocate an executor inside its retirement window", async () => {
    const f = fixture(() => new Response("unreachable"));
    // Four seconds remain of a thirty-second allocation; the window is ten.
    f.input.session.request.requestedAt = Date.now() - 26_000;
    f.input.session.request.prepareDeadlineAt = Date.now() + 3_000;
    f.input.session.request.hardDeadlineAt = Date.now() + 4_000;
    const broker = createHostedHttpBroker({ maxActive: 1, drainTimeoutMs: 10_000 });
    try {
      await assertRejects(
        () => broker.fetch(new Request("https://app.example"), f.input),
        Error,
        "retirement window",
      );
      assertEquals(f.calls, []);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("serves an allocation whose whole lifetime is shorter than the drain window", async () => {
    // The fixture's allocation lives thirty seconds; the drain window is sixty.
    const f = fixture(() => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1, drainTimeoutMs: 60_000 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      assertEquals(f.calls, ["allocate", "install"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("preserves the current generation's order when a newer generation is refused at capacity", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const current = fixture(async () => {
      entered.resolve();
      await release.promise;
      return new Response("current");
    });
    current.input.session.request.requestedAt -= 1_000;
    const next = fixture(() => new Response("next"));
    next.input.installation.configurationId = "config-b";
    const broker = createHostedHttpBroker({ maxActive: 1 });
    const first = broker.fetch(new Request("https://app.example/first"), current.input);
    first.catch(() => {});
    try {
      await entered.promise;
      await assertRejects(
        () => broker.fetch(new Request("https://app.example/next"), next.input),
        Error,
        "capacity",
      );
      const again = broker.fetch(new Request("https://app.example/again"), current.input);
      again.catch(() => {});
      release.resolve();
      assertEquals(await (await first).text(), "current");
      assertEquals(await (await again).text(), "current");
      assertEquals(next.calls, []);
      assertEquals(current.calls, ["allocate", "install"]);
    } finally {
      release.resolve();
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("requires bounded generation limits", () => {
    for (
      const options of [
        { idleTimeoutMs: 0 },
        { idleTimeoutMs: 3_600_001 },
        { drainTimeoutMs: -1 },
        { drainTimeoutMs: 300_001 },
        { maxConcurrentRequestsPerExecutor: 0 },
        { maxConcurrentRequestsPerExecutor: 17 },
        { executionPolicyId: "" },
        { maxWarmGenerationsPerProject: 0 },
        { maxWarmGenerationsPerProject: 2 },
        { maxTrackedEnvironments: 0 },
      ]
    ) {
      assertThrows(() => createHostedHttpBroker({ maxActive: 1, ...options }), TypeError);
    }
  });
});

describe("hosted HTTP generation executor", () => {
  function executorFor(f: ReturnType<typeof fixture>) {
    const sessions = createHostedExecutorSessionPool({ maxActive: 1 });
    const input = prepareHostedHttpInput(f.input);
    const key = hostedHttpInstallationKey(input);
    const executor = createHostedHttpGenerationExecutor({
      input,
      sessions,
      context: () => ({ key }),
      idleTimeoutMs: 60_000,
      retireBeforeDeadlineMs: 0,
    });
    return { executor, sessions };
  }

  it("settles stop only after the allocator acknowledges release", async () => {
    const f = fixture(() => new Response("served"));
    const { executor, sessions } = executorFor(f);
    try {
      assertEquals(
        await (await executor.render(new Request("https://app.example"))).text(),
        "served",
      );
      f.holdRelease();
      let stopped = false;
      const stopping = executor.stop().then(() => {
        stopped = true;
      });
      await f.releaseEntered.promise;
      await tick();
      assertEquals(stopped, false);
      f.releaseAllowed.resolve();
      await stopping;
      assertEquals(f.calls, ["allocate", "install", "release:completed"]);
      await executor.ended;
      await assertRejects(() => executor.render(new Request("https://app.example")));
    } finally {
      f.releaseAllowed.resolve();
      await sessions.shutdown();
      await sessions.settled;
    }
  });

  it("leaves no deadline timer behind when its session starts already stopped", async () => {
    const f = fixture(() => new Response("served"));
    const { executor, sessions } = executorFor(f);
    try {
      // Stop lands between the first request and the session start it scheduled.
      const rendering = executor.render(new Request("https://app.example"));
      rendering.catch(() => {});
      await executor.stop();
      await assertRejects(() => rendering);
      await executor.ended;
      assertEquals(f.calls, []);
      // The test runner fails this case if a timer armed by the executor is still pending.
    } finally {
      await sessions.shutdown();
      await sessions.settled;
    }
  });

  it("refuses a warm request inside the retirement window before its timer has run", async () => {
    const f = fixture(() => new Response("served"));
    const time = new ManualMonotonicClock();
    f.input.session.clock = createHostedExecutorSessionClock(
      f.input.session.request.requestedAt,
      time,
    );
    // A long allocation, so the window below is not shortened to half its lifetime.
    f.input.session.request.requestedAt -= 60_000;
    const sessions = createHostedExecutorSessionPool({ maxActive: 1 });
    const input = prepareHostedHttpInput(f.input);
    const key = hostedHttpInstallationKey(input);
    const retireBeforeDeadlineMs = input.allocation.hardDeadlineAt - f.input.session.clock.now() -
      300;
    const executor = createHostedHttpGenerationExecutor({
      input,
      sessions,
      context: () => ({ key }),
      idleTimeoutMs: 60_000,
      retireBeforeDeadlineMs,
    });
    try {
      assertEquals(
        await (await executor.render(new Request("https://app.example"))).text(),
        "served",
      );
      // Pass the boundary without yielding, as a busy event loop would delay the timer.
      time.advanceBy(300);
      await assertRejects(
        () => executor.render(new Request("https://app.example")),
        Error,
        "retirement window",
      );
      await executor.ended;
      await executor.stop();
    } finally {
      await sessions.shutdown();
      await sessions.settled;
    }
  });

  it("rejects stop until the allocator confirms release, then succeeds on retry", async () => {
    const f = fixture(() => new Response("served"));
    const release = f.input.session.allocator.release;
    f.input.session.allocator.release = () =>
      Promise.reject(new Error("synthetic allocator outage"));
    const { executor, sessions } = executorFor(f);
    try {
      await (await executor.render(new Request("https://app.example"))).text();
      await assertRejects(() => executor.stop(), Error, "unconfirmed");
      f.input.session.allocator.observe = (binding, signal) =>
        release(binding, "completed", signal);
      await executor.stop();
      await executor.stop();
    } finally {
      await sessions.shutdown();
      await sessions.settled;
    }
  });

  it("bounds release confirmation when the allocator never answers", async () => {
    const f = fixture(() => new Response("served"));
    f.input.session.allocator.release = () =>
      Promise.reject(new Error("synthetic allocator outage"));
    const { executor, sessions } = executorFor(f);
    try {
      await (await executor.render(new Request("https://app.example"))).text();
      let observations = 0;
      f.input.session.allocator.observe = () => {
        observations++;
        return new Promise(() => {});
      };
      await assertRejects(() => executor.stop(), Error, "unconfirmed");
      await assertRejects(() => executor.stop(), Error, "unconfirmed");
      assertEquals(observations, 1);
    } finally {
      await sessions.shutdown();
      await sessions.settled;
    }
  });

  it("retires a generation that never receives a request", async () => {
    const f = fixture(() => new Response("unused"));
    const sessions = createHostedExecutorSessionPool({ maxActive: 1 });
    const executor = createHostedHttpGenerationExecutor({
      input: prepareHostedHttpInput(f.input),
      sessions,
      context: () => undefined,
      idleTimeoutMs: 10,
      retireBeforeDeadlineMs: 0,
    });
    try {
      await executor.ended;
      await executor.stop();
      assertEquals(f.calls, []);
    } finally {
      await sessions.shutdown();
      await sessions.settled;
    }
  });

  it("refuses a request whose installation differs from its own", async () => {
    const f = fixture(() => new Response("must not run"));
    const sessions = createHostedExecutorSessionPool({ maxActive: 1 });
    const executor = createHostedHttpGenerationExecutor({
      input: prepareHostedHttpInput(f.input),
      sessions,
      context: () => ({ key: "another installation" }),
      idleTimeoutMs: 60_000,
      retireBeforeDeadlineMs: 0,
    });
    try {
      await assertRejects(
        () => executor.render(new Request("https://app.example")),
        TypeError,
        "another installation",
      );
      assertEquals(f.calls, []);
      await executor.stop();
    } finally {
      await sessions.shutdown();
      await sessions.settled;
    }
  });
});
