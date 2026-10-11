import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    const f = fixture(() => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      f.crash();
      await f.releaseEntered.promise;
      assertEquals(f.calls.includes("release:canceled"), true);
      // The crashed generation keeps its capacity until its release is confirmed.
      let served: string | undefined;
      for (let attempt = 0; attempt < 50 && served === undefined; attempt++) {
        served = await broker.fetch(new Request("https://app.example"), f.input).then(
          (response) => response.text(),
          (error) => {
            assertEquals(String(error).includes("capacity"), true);
            return new Promise<undefined>((resolve) => setTimeout(resolve, 20));
          },
        );
      }
      assertEquals(served, "served");
      assertEquals(count(f.calls, "allocate"), 2);
      assertEquals(count(f.calls, "install"), 2);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("retires an idle executor and releases its allocation", async () => {
    const f = fixture(() => new Response("served"));
    const broker = createHostedHttpBroker({ maxActive: 1, idleTimeoutMs: 10 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://app.example"), f.input)).text(),
        "served",
      );
      await f.releaseEntered.promise;
      assertEquals(f.calls, ["allocate", "install", "release:completed"]);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("bounds executor preparation by the allocation deadline", async () => {
    const f = fixture(() => new Response("unreachable"), () => new Promise<void>(() => {}));
    f.input.session.request.prepareDeadlineAt = Date.now() + 100;
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      await assertRejects(() => broker.fetch(new Request("https://app.example"), f.input));
      await f.releaseEntered.promise;
      assertEquals(f.calls.includes("release:canceled"), true);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("retries an unconfirmed retirement and keeps its capacity until release is confirmed", async () => {
    const a = fixture(() => new Response("a"));
    const release = a.input.session.allocator.release;
    a.input.session.allocator.release = () =>
      Promise.reject(new Error("synthetic allocator outage"));
    const b = fixture(() => new Response("b"), undefined, "project-b");
    const broker = createHostedHttpBroker({ maxActive: 1, idleTimeoutMs: 10 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), a.input)).text(),
        "a",
      );
      while (broker.generations > 0) await new Promise((resolve) => setTimeout(resolve, 10));
      await assertRejects(
        () => broker.fetch(new Request("https://b.example"), b.input),
        Error,
        "capacity",
      );
      assertEquals(b.calls, []);
      a.input.session.allocator.observe = (binding, signal) =>
        release(binding, "completed", signal);
      let served: string | undefined;
      for (let attempt = 0; attempt < 60 && served === undefined; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        served = await broker.fetch(new Request("https://b.example"), b.input).then(
          (response) => response.text(),
          () => undefined,
        );
      }
      assertEquals(served, "b");
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("stops retirement retries when its owner signal shuts the broker down", async () => {
    const f = fixture(() => new Response("a"));
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
      while (broker.generations > 0) await new Promise((resolve) => setTimeout(resolve, 10));
      owner.abort();
      await broker.settled;
      // Shutdown makes one bounded confirmation attempt; no retry follows it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const settledObservations = observations;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      assertEquals(observations, settledObservations);
    } finally {
      await broker.shutdown();
      await broker.settled;
    }
  });

  it("forgets an environment whose generation was not admitted", async () => {
    const a = fixture(() => new Response("a"));
    const broker = createHostedHttpBroker({ maxActive: 1 });
    try {
      assertEquals(
        await (await broker.fetch(new Request("https://a.example"), a.input)).text(),
        "a",
      );
      for (let index = 0; index < 5; index++) {
        const other = fixture(() => new Response("other"), undefined, `project-${index}`);
        await assertRejects(
          () => broker.fetch(new Request("https://other.example"), other.input),
          Error,
          "capacity",
        );
      }
      assertEquals(broker.generations, 1);
    } finally {
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
      f.input.session.allocator.observe = () => new Promise(() => {});
      await assertRejects(() => executor.stop(), Error, "unconfirmed");
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
